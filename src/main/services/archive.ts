import StreamZip from 'node-stream-zip'
import { createExtractorFromFile } from 'node-unrar-js'
import Seven, { type SevenEntry, type SevenStream } from 'node-7z'
import { path7za } from '7zip-bin'
import { net, type ClientRequest, type IncomingMessage } from 'electron'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { Readable, Transform, Writable } from 'stream'
import { pipeline } from 'stream/promises'
import { assertSafeSegment, isPathWithin } from './path-safety'
import type { LocalModRef } from '../ipc/types'

// In a packaged app the 7za binary lives inside app.asar, which the OS cannot
// execute — electron-builder unpacks it (asarUnpack in electron-builder.yml)
// and the runnable copy lives under app.asar.unpacked. In dev this is a no-op.
const SEVEN_BIN = path7za.replace('app.asar', 'app.asar.unpacked')

// Decompression-bomb guard. A few-KB archive can declare entries that expand
// to tens of GB and fill the disk, so we reject before writing the first byte
// when the declared totals blow past these ceilings.
//   - 8 GiB total uncompressed: high enough not to false-positive on big but
//     legit mod packs (full Content/Paks bundles), low enough to stop a bomb.
//   - 100000 entries: guards against the "millions of tiny files" inode/handle
//     exhaustion variant that a size cap alone wouldn't catch.
const MAX_TOTAL_UNCOMPRESSED_BYTES = 8 * 1024 * 1024 * 1024
const MAX_ENTRY_COUNT = 100000

// Hard ceiling on a single download's byte count. A compressed mod archive is
// always smaller than its extracted size, so mirroring the uncompressed cap
// never false-positives on a legit download but stops an unbounded hostile
// stream (absent/lying content-length) from filling the disk.
const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024 * 1024

// Zip Slip 防護：檢查解壓路徑是否超出目標目錄
function isSafePath(entryName: string, destDir: string): boolean {
  return isPathWithin(destDir, path.resolve(destDir, entryName))
}

function validateEntries(entryNames: string[], destDir: string): void {
  for (const name of entryNames) {
    if (!isSafePath(name, destDir)) {
      throw new Error(`Blocked path traversal in archive: ${name}`)
    }
  }
}

// node-stream-zip / node-unrar-js key their entries by the RAW header name
// (backslashes preserved with skipEntryNameValidation). We validate and analyze
// with `\`→`/` normalized names, so before asking the extractor for a specific
// entry we must map the normalized name back to its original — otherwise the
// lookup misses and nothing is written. Returns the normalized `entryNames`
// (for validation/analysis) plus `originalByNormalized` for that reverse lookup.
function buildEntryNameMap(rawNames: string[]): { entryNames: string[]; originalByNormalized: Map<string, string> } {
  const entryNames: string[] = []
  const originalByNormalized = new Map<string, string>()
  for (const raw of rawNames) {
    const normalized = raw.replace(/\\/g, '/')
    entryNames.push(normalized)
    // First writer wins so a later duplicate can't hijack an existing mapping.
    if (!originalByNormalized.has(normalized)) originalByNormalized.set(normalized, raw)
  }
  return { entryNames, originalByNormalized }
}

// Reject before extraction if the archive's declared uncompressed size or entry
// count exceeds the ceilings above. `sizes` are the per-entry uncompressed byte
// counts pulled from the central directory / RAR headers (callers pass the
// field name appropriate to their lib: node-stream-zip `.size`, node-unrar-js
// `.unpSize`). Throwing here keeps the disk-fill bomb from ever touching disk.
function validateArchiveLimits(sizes: unknown[]): void {
  if (sizes.length > MAX_ENTRY_COUNT) {
    throw new Error(
      `Archive rejected: ${sizes.length} entries exceeds the ${MAX_ENTRY_COUNT} entry limit (possible decompression bomb)`
    )
  }
  let total = 0
  for (const size of sizes) {
    total += Number(size) || 0
    if (total > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error(
        `Archive rejected: uncompressed size exceeds the ${MAX_TOTAL_UNCOMPRESSED_BYTES} byte limit (possible decompression bomb)`
      )
    }
  }
}

// Pick a destination path that does not clobber an existing file. When the
// preferred path is taken, append a numeric suffix before the extension —
// `mod.pak` -> `mod (2).pak` -> `mod (3).pak` — so two paks that share a
// basename under different subfolders both survive instead of one silently
// overwriting the other.
function resolveCollisionFreePath(destPath: string): string {
  if (!fs.existsSync(destPath)) return destPath
  const dir = path.dirname(destPath)
  const ext = path.extname(destPath)
  const base = path.basename(destPath, ext)
  for (let i = 2; i < 10000; i++) {
    const candidate = path.join(dir, `${base} (${i})${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  // Astronomically unlikely; fail loudly rather than overwrite.
  throw new Error(`Could not find a non-colliding destination for ${destPath}`)
}

// Walk an extracted tree and reject any symlink. 7za restores symlink entries
// from the archive, and validateEntries only checks each entry's own path — not
// a symlink's target — so a `link -> C:\` entry followed by `link/x` could write
// outside the tree. lstat does NOT follow links. Both extract7z branches run
// this on a TEMP dir and only move content into the live destination after the
// walk passes, so a detected link never lands in the game folders. Residual: on
// symlink-capable systems (the Linux fork; Windows with dev mode/elevation) 7za
// can still write THROUGH a link during extraction into the temp dir — this
// walk is containment + detection, not prevention. On default Windows, link
// creation itself fails without elevation.
function assertNoSymlinks(dir: string): void {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry)
    const st = fs.lstatSync(full)
    if (st.isSymbolicLink()) {
      // Delete the link before throwing so nothing that later walks or cleans
      // the tree can follow it.
      try { fs.unlinkSync(full) } catch { /* best-effort */ }
      throw new Error(`Blocked symlink entry in archive: ${entry}`)
    }
    if (st.isDirectory()) assertNoSymlinks(full)
  }
}

/** A mod an archive would install, for the preview list. */
export type ArchiveMod = LocalModRef

/** A UE4SS mod folder in an archive; `dir` is archive-relative ('' = the archive root). */
export interface Ue4ssModDir {
  name: string
  dir: string
}

export interface ArchiveAnalysis {
  type: 'hybrid' | 'ue4ss-mod' | 'game-structure' | 'pak-only' | 'complex'
  /** Set for 'hybrid' / 'ue4ss-mod'. */
  hasGameStructure?: boolean
  /** Set when the archive mirrors the game folder: '' or the wrapper folder ('MyMod v1.0/') before HumanitZ/. */
  gameStructurePrefix?: string
  pakFiles: string[]
  luaFiles: string[]
  dllFiles: string[]
  mods: ArchiveMod[]
  /** The UE4SS mod folders behind the 'UE4SS' entries of `mods`. */
  ue4ssModDirs: Ue4ssModDir[]
  readmeFiles: string[]
  /** Added by an analyzeOnly extract. */
  entryNames?: string[]
}

export type ArchiveFormat = 'zip' | 'rar' | '7z' | 'unknown'

/** Download progress: a percentage, or -1 once when the total size is unknown. */
export type ProgressCallback = (percent: number) => void

function isSafeModName(name: string): boolean {
  try {
    assertSafeSegment('modName', name)
    return true
  } catch {
    return false
  }
}

// Browsers save a repeat download as 'name (1).zip' / 'name(1).zip'.
const DOWNLOAD_COPY_SUFFIX_RE = /\s*\(\d+\)$/
// Nexus names files '<name>-<mod id>-<version, dots as dashes>-<upload time>'
// ('CoolMod-56-1-0-1700000000.zip'). Version parts that look like one
// ('1', '0b', 'v2') are tried first so a dash-number inside the name
// ('HZ-2077-Mod-56-...') stays; any parts ('beta') as a fallback.
const NEXUS_FILE_SUFFIX_RES = [/-\d+(?:-v?\d\w*)*-\d{9,}$/i, /-\d+(?:-[\w.]*)*-\d{9,}$/]

// The mod name for an archive whose root IS the mod folder: the archive's
// file name without extension and without what download tools add to it, so
// the next version of the same mod gets the same name (rotation, the registry
// and Nexus updates all match mods by name). Trailing dots/spaces are dropped,
// as Windows would. A strip that would leave nothing usable is skipped.
function archiveModName(archivePath: string): string {
  const trim = (s: string): string => s.replace(/[. ]+$/, '')
  let name = trim(path.basename(archivePath, path.extname(archivePath)))
  const strip = (re: RegExp): void => {
    const stripped = trim(name.replace(re, ''))
    if (stripped && isSafeModName(stripped)) name = stripped
  }
  strip(DOWNLOAD_COPY_SUFFIX_RE)
  const nexus = NEXUS_FILE_SUFFIX_RES.find(re => re.test(name))
  if (nexus) strip(nexus)
  return name
}

interface EntryDir {
  name: string
  path: string
  files: Set<string>
  dirs: Map<string, EntryDir>
}

// Folder tree of the entry names, keyed case-insensitively like Windows.
function buildEntryTree(entryNames: string[]): EntryDir {
  const root: EntryDir = { name: '', path: '', files: new Set(), dirs: new Map() }
  for (const entry of entryNames) {
    const parts = entry.split('/').filter(p => p && p !== '.')
    if (parts.includes('..')) continue
    const file = entry.endsWith('/') ? undefined : parts.pop()
    let node = root
    for (const part of parts) {
      let child = node.dirs.get(part.toLowerCase())
      if (!child) {
        child = { name: part, path: node.path ? `${node.path}/${part}` : part, files: new Set(), dirs: new Map() }
        node.dirs.set(part.toLowerCase(), child)
      }
      node = child
    }
    if (file) node.files.add(file.toLowerCase())
  }
  return root
}

// UE4SS's own loader DLLs, and folders that are never a mod themselves: a
// bundled loader must not make Win64/ or ue4ss/ look like a C++ mod.
const UE4SS_LOADER_DLLS = new Set(['dwmapi.dll', 'xinput1_3.dll', 'ue4ss.dll'])
const NON_MOD_DIR_NAMES = new Set(['win64', 'ue4ss', 'scripts', 'dlls'])

function hasUe4ssEntryPoint(dir: EntryDir): boolean {
  return dir.files.has('main.lua')
    || !!dir.dirs.get('scripts')?.files.has('main.lua')
    || !!dir.dirs.get('dlls')?.files.has('main.dll')
}

// The UE4SS mod folders the installer copies into Mods/. Walks down from the
// root and stops at the first folder with an entry point (Scripts/main.lua,
// main.lua, dlls/main.dll) or, for odd packaging, a non-loader .dll — so files
// deeper inside a mod (Scripts/lib/socket/core.dll) never become mods of
// their own. An archive whose root is the mod folder is named after the file.
function findUe4ssModDirs(entryNames: string[], rootName?: string): Ue4ssModDir[] {
  const root = buildEntryTree(entryNames)
  const found: Ue4ssModDir[] = []
  if (hasUe4ssEntryPoint(root)) {
    if (rootName && isSafeModName(rootName)) found.push({ name: rootName, dir: '' })
    return found
  }
  const walk = (dir: EntryDir): void => {
    for (const child of dir.dirs.values()) {
      const hasModDll = !NON_MOD_DIR_NAMES.has(child.name.toLowerCase())
        && [...child.files].some(f => f.endsWith('.dll') && !UE4SS_LOADER_DLLS.has(f))
      if (hasUe4ssEntryPoint(child) || hasModDll) {
        if (isSafeModName(child.name)) found.push({ name: child.name, dir: child.path })
      } else {
        walk(child)
      }
    }
  }
  walk(root)
  return found
}

// '' when the archive mirrors the game folder (HumanitZ/Content|Binaries/...),
// the wrapper folder when that whole tree sits in one ('MyMod v1.0/HumanitZ/...'),
// undefined otherwise.
function findGameStructurePrefix(entryNames: string[]): string | undefined {
  if (entryNames.some(n => /^HumanitZ\/(Content|Binaries)\//i.test(n))) return ''
  for (const n of entryNames) {
    const m = /^(.*?\/)HumanitZ\/(Content|Binaries)\//i.exec(n)
    if (!m) continue
    const prefix = m[1]
    if (prefix.slice(0, -1).split('/').some(p => !p || p === '.' || p === '..')) return undefined
    // Every entry must sit under that one wrapper (its parent dirs included).
    const lower = prefix.toLowerCase()
    const shared = entryNames.every((e) => {
      const l = e.toLowerCase()
      return l.startsWith(lower) || (l.endsWith('/') && lower.startsWith(l))
    })
    return shared ? prefix : undefined
  }
  return undefined
}

// 分析壓縮檔內部結構，判斷 mod 類型與安裝方式
// `archiveName` names a mod whose files sit at the archive root (see archiveModName).
function analyzeArchiveStructure(entryNames: string[], archiveName?: string): ArchiveAnalysis {
  // Case-insensitive extension matching: an archive whose only payload is
  // `Mod.PAK` (uppercase) must still be recognized as pak-only, else it falls
  // through to 'complex' and the whole archive is dumped into the game root.
  const pakFiles = entryNames.filter(n => /\.(pak|ucas|utoc)$/i.test(n))
  const luaFiles = entryNames.filter(n => /\.lua$/i.test(n))
  const dllFiles = entryNames.filter(n => /\.dll$/i.test(n))
  const hasEnabledTxt = entryNames.some(n => path.basename(n).toLowerCase() === 'enabled.txt')
  const hasModManifest = entryNames.some(n => path.basename(n).toLowerCase() === 'modmanifest.json')

  // 偵測是否有遊戲目錄結構（如 HumanitZ/Content/Paks/ 或 HumanitZ/Binaries/）
  const gameStructurePrefix = findGameStructurePrefix(entryNames)
  const hasGameStructure = gameStructurePrefix !== undefined

  // UE4SS mod 偵測：
  // 1. 有 enabled.txt + lua 腳本
  // 2. 有 Scripts/main.lua 或 main.lua 結構（常見 UE4SS mod 不附 enabled.txt）
  // 3. 有 <Mod>/dlls/main.dll（UE4SS C++ mod，可與 pak 同捆）
  // 4. 有 dll 但無 pak（UE4SS C++ mod）
  const hasScriptsMain = entryNames.some(n => n.replace(/\\/g, '/').match(/Scripts\/main\.lua$/i))
  const hasMainLua = entryNames.some(n => path.basename(n) === 'main.lua')
  const hasCppMod = entryNames.some(n => /(^|\/)dlls\/main\.dll$/i.test(n))
  const isUe4ssMod =
    (luaFiles.length > 0 && hasEnabledTxt) ||
    hasScriptsMain ||
    (hasMainLua && luaFiles.length > 0) ||
    hasCppMod ||
    (dllFiles.length > 0 && pakFiles.length === 0 && luaFiles.length === 0)

  // Find readme files in the archive
  const readmeNames = new Set(['readme.md', 'readme.txt', 'readme', 'description.txt', 'info.txt'])
  const readmeFiles = entryNames.filter(n => readmeNames.has(path.basename(n).toLowerCase()))

  // Build mod summary list for preview display. One entry per mod: an IoStore
  // pak/ucas/utoc triplet (or same-named paks in variant folders) is one mod.
  const mods: ArchiveMod[] = []
  const seen = new Set<string>()
  const addMod = (name: string, modType: ArchiveMod['modType']): void => {
    const key = `${modType}:${name.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    mods.push({ name, modType })
  }
  for (const p of pakFiles) {
    addMod(path.basename(p).replace(/\.(pak|ucas|utoc)$/i, '').replace(/_P$/, ''), 'PAK')
  }
  // Names come only from real mod folders, so they match what the install
  // copies (and what rotation moves aside / the registry enables).
  const ue4ssModDirs = findUe4ssModDirs(entryNames, archiveName)
  for (const { name } of ue4ssModDirs) addMod(name, 'UE4SS')

  const base = { pakFiles, luaFiles, dllFiles, mods, ue4ssModDirs, readmeFiles }

  // 混合型：同時有 PAK + UE4SS
  if (isUe4ssMod && pakFiles.length > 0) {
    return { type: 'hybrid', hasGameStructure, gameStructurePrefix, ...base }
  }

  // UE4SS 優先：即使包在遊戲目錄結構裡，有 UE4SS 特徵就判定為 UE4SS mod
  if (isUe4ssMod) {
    return { type: 'ue4ss-mod', hasGameStructure, gameStructurePrefix, ...base }
  }

  if (hasGameStructure) {
    return { type: 'game-structure', gameStructurePrefix, ...base }
  }

  if (pakFiles.length > 0 && !luaFiles.length && !dllFiles.length && !hasModManifest) {
    return { type: 'pak-only', ...base }
  }

  // 複合型 mod（含 dll/manifest 等）
  return { type: 'complex', ...base }
}

// Sniff the real archive format from magic bytes. A downloaded file's
// extension can't be trusted: Nexus's newer CDN serves GUID paths with no
// extension at all, and the download flow falls back to naming those .zip —
// feeding a RAR/7z payload to the zip extractor ("Bad archive").
// Returns 'zip' | 'rar' | '7z' | 'unknown'; any read failure is 'unknown'.
function detectArchiveFormat(filePath: string): ArchiveFormat {
  let fd: number | undefined
  try {
    fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(8)
    const read = fs.readSync(fd, buf, 0, 8, 0)
    if (read >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) {
      // Local file header (03 04), empty-archive EOCD (05 06), spanned (07 08).
      const pair = (buf[2] << 8) | buf[3]
      if (pair === 0x0304 || pair === 0x0506 || pair === 0x0708) return 'zip'
    }
    if (read >= 7 && buf.subarray(0, 6).equals(Buffer.from('Rar!\x1a\x07', 'latin1'))
      && (buf[6] === 0x00 || (read >= 8 && buf[6] === 0x01 && buf[7] === 0x00))) {
      return 'rar' // v4 ends 0x00; v5 ends 0x01 0x00
    }
    if (read >= 6 && buf.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) {
      return '7z'
    }
    return 'unknown'
  } catch {
    return 'unknown'
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd) } catch { /* best-effort */ }
    }
  }
}

const ZIP_LOCAL_HEADER_SIZE = 30
const ZIP_LOCAL_HEADER_SIG = 0x04034b50

// One file entry's inflated bytes, read with its own file stream so a
// pipeline() abort closes it cleanly (node-stream-zip's entry stream shares the
// archive fd and its reader has no error listener, so aborting it mid-read
// could race zip.close()). Offsets/sizes come from the central directory.
async function zipEntrySource(zipPath: string, entry: StreamZip.ZipEntry): Promise<Readable[]> {
  if (entry.encrypted) throw new Error(`Entry encrypted: ${entry.name}`)
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`Unknown compression method: ${entry.method}`)
  const header = Buffer.alloc(ZIP_LOCAL_HEADER_SIZE)
  const fh = await fs.promises.open(zipPath, 'r')
  try {
    await fh.read(header, 0, ZIP_LOCAL_HEADER_SIZE, entry.offset)
  } finally {
    await fh.close()
  }
  if (header.readUInt32LE(0) !== ZIP_LOCAL_HEADER_SIG) throw new Error(`Invalid local header: ${entry.name}`)
  const start = entry.offset + ZIP_LOCAL_HEADER_SIZE + header.readUInt16LE(26) + header.readUInt16LE(28)
  const raw = entry.compressedSize > 0
    ? fs.createReadStream(zipPath, { start, end: start + entry.compressedSize - 1 })
    : Readable.from([])
  return entry.method === 8 ? [raw, zlib.createInflateRaw()] : [raw]
}

// Write one zip entry to `target`, checking the bytes actually produced
// against the central-directory size and CRC. Neither zip header can be
// trusted for the bomb guard: validateArchiveLimits summed the declared
// sizes, so an entry that inflates past its own is aborted right there
// instead of filling the disk. The partial file is removed on failure.
async function extractZipEntryTo(zipPath: string, entry: StreamZip.ZipEntry, target: string): Promise<void> {
  const { size, crc, name } = entry
  let written = 0
  let actualCrc = 0
  const check = new Transform({
    transform(chunk: Buffer, _enc, done) {
      written += chunk.length
      if (written > size) {
        done(new Error(`Archive rejected: ${name} expands past its declared size (possible decompression bomb)`))
        return
      }
      actualCrc = zlib.crc32(chunk, actualCrc)
      done(null, chunk)
    },
    flush(done) {
      done(written !== size || actualCrc !== crc ? new Error(`Archive entry is corrupt (size/CRC mismatch): ${name}`) : null)
    },
  })
  try {
    await pipeline([...await zipEntrySource(zipPath, entry), check, fs.createWriteStream(target)])
  } catch (err) {
    try { fs.rmSync(target, { force: true }) } catch { /* best-effort */ }
    throw err
  }
}

// Bounded equivalent of zip.extract(null, destDir). `entryNames[i]` is the
// normalized name of `entryList[i]` (validated against destDir by the caller).
async function extractZipEntries(zipPath: string, entryList: StreamZip.ZipEntry[], entryNames: string[], destDir: string): Promise<void> {
  for (let i = 0; i < entryList.length; i++) {
    const target = path.join(destDir, entryNames[i])
    if (entryList[i].isDirectory) {
      fs.mkdirSync(target, { recursive: true })
      continue
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    await extractZipEntryTo(zipPath, entryList[i], target)
  }
}

// Read at most `maxBytes` of the entry with this normalized name, without
// inflating the rest (a readme only needs its head, and sizes can lie).
// Resolves null when the archive has no such file entry.
async function readZipEntryHead(zipPath: string, entryName: string, maxBytes: number): Promise<Buffer | null> {
  const zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true })
  let entry: StreamZip.ZipEntry | undefined
  try {
    entry = Object.values(await zip.entries()).find(e => e.isFile && e.name.replace(/\\/g, '/') === entryName)
  } finally {
    await zip.close()
  }
  if (!entry) return null
  const chunks: Buffer[] = []
  let total = 0
  const enough = new Error('enough')
  const sink = new Writable({
    write(chunk: Buffer, _enc, done) {
      chunks.push(chunk)
      total += chunk.length
      done(total >= maxBytes ? enough : null)
    },
  })
  try {
    await pipeline([...await zipEntrySource(zipPath, entry), sink])
  } catch (err) {
    if (err !== enough) throw err
  }
  return Buffer.concat(chunks).subarray(0, maxBytes)
}

function extractZip(zipPath: string, destDir: string | null, analyzeOnly: true): Promise<ArchiveAnalysis>
function extractZip(zipPath: string, destDir: string, analyzeOnly?: boolean): Promise<ArchiveAnalysis>
async function extractZip(zipPath: string, destDir: string | null, analyzeOnly = false): Promise<ArchiveAnalysis> {
  // skipEntryNameValidation: some zip tools (e.g. Windows built-in) produce backslash paths
  // which node-stream-zip rejects as "Malicious entry"
  const zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true })
  try {
    const entries = await zip.entries()
    const entryList = Object.values(entries)
    const { entryNames, originalByNormalized } = buildEntryNameMap(entryList.map(e => e.name))
    const analysis = analyzeArchiveStructure(entryNames, archiveModName(zipPath))

    if (analyzeOnly) return { ...analysis, entryNames }

    // Past the analyzeOnly return a destination is always given (see the overloads).
    destDir = destDir as string

    // validateEntries MUST run before any write — it is the sole zip-slip guard
    // (skipEntryNameValidation is on so node-stream-zip won't reject the
    // backslash paths we normalize ourselves). validateArchiveLimits likewise
    // rejects decompression bombs before the first byte hits disk.
    validateEntries(entryNames, destDir)
    validateArchiveLimits(entryList.map(e => e.size))
    fs.mkdirSync(destDir, { recursive: true })

    if (analysis.type === 'pak-only') {
      for (const pakFile of analysis.pakFiles) {
        // pakFile is a normalized name; node-stream-zip keys entries by the
        // original (backslashes preserved), so look it up by the raw name.
        const entry = entries[originalByNormalized.get(pakFile) ?? pakFile]
        if (!entry) continue
        const target = resolveCollisionFreePath(path.join(destDir, path.basename(pakFile)))
        await extractZipEntryTo(zipPath, entry, target)
      }
    } else {
      await extractZipEntries(zipPath, entryList, entryNames, destDir)
    }

    return analysis
  } finally {
    await zip.close()
  }
}

// Returns the copied file's path.
function copyFile(src: string, destDir: string): string {
  fs.mkdirSync(destDir, { recursive: true })
  const destPath = path.join(destDir, path.basename(src))
  fs.copyFileSync(src, destPath)
  return destPath
}

// Kill the download if no bytes flow for this long. The timer is idle-based:
// it re-arms on every chunk, so big downloads won't trip it as long as the
// server keeps sending data.
const DOWNLOAD_IDLE_TIMEOUT_MS = 60000

// Transient failures (stall, connection reset, HTTP 5xx/429) are retried up
// to this many total attempts, resuming from the partial file via a Range
// request when the server honors it. Policy refusals (blocked host, 4xx,
// HTML page, size cap) never retry.
const DOWNLOAD_MAX_ATTEMPTS = 3
const DOWNLOAD_RETRY_BASE_DELAY_MS = 2000

// Host allowlist matcher for downloadFile. EXACT hostname match by default —
// an entry only matches subdomains when it opts in with an explicit `*.`
// prefix (`*.githubusercontent.com` matches any subdomain, never the bare
// domain). Implicit subdomain matching used to let a redirect hop reach e.g.
// gist.github.com when only github.com was listed — the exact-match rule the
// callers' allowlists document (and test) now holds on every hop.
function isHostAllowed(hostname: string, allowedHosts: unknown): boolean {
  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) return false
  return allowedHosts.some(h => {
    if (typeof h !== 'string' || !h) return false
    if (h.startsWith('*.')) return hostname.endsWith(h.slice(1))
    return hostname === h
  })
}

// Electron net response headers may hold string or string[] values.
function headerValue(headers: Record<string, string | string[]> | undefined, name: string): string | undefined {
  const value = headers ? headers[name] : undefined
  return Array.isArray(value) ? value[0] : value
}

// Tag an error as safe to retry (network-level hiccup, not a policy refusal).
interface RetriableError extends Error {
  downloadRetriable?: boolean
}

function asRetriable(err: Error): RetriableError {
  const tagged: RetriableError = err
  tagged.downloadRetriable = true
  return tagged
}

// One download attempt over Electron's net module. net rides Chromium's
// network stack, so it honors the OS proxy/PAC configuration that Node's
// https module ignores — users whose only route to GitHub goes through a
// system proxy used to stall for 60s here even though their browser worked.
// `resumeFrom` > 0 sends a Range header; a 206 appends to the existing
// partial file, a 200 (server ignored the range) restarts it from scratch.
function downloadFileOnce(
  url: string,
  destPath: string,
  onProgress: ProgressCallback | null | undefined,
  allowedHosts: readonly string[] | null | undefined,
  resumeFrom = 0
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const isAllowed = (target: string): boolean => {
      // Fail closed: no allow-list means deny (every caller passes one). Stops a
      // future caller that forgets the argument from silently getting an
      // unrestricted SSRF + cleartext-http download primitive.
      try {
        const u = new URL(target)
        if (u.protocol !== 'https:') return false
        return isHostAllowed(u.hostname, allowedHosts)
      } catch {
        return false
      }
    }
    const blockedError = (target: string): Error => {
      // Report only the host — a Nexus CDN URL carries a short-lived signed
      // auth token in its query string that must not leak to the renderer/log.
      let blockedHost = target
      try { blockedHost = new URL(target).hostname } catch { /* keep raw */ }
      return new Error(`Download blocked: host "${blockedHost}" is not in the allowed list`)
    }

    // Initial-URL check runs BEFORE net.request so a disallowed URL never
    // opens a connection (and the check stays testable outside Electron).
    if (!isAllowed(url)) {
      reject(blockedError(url))
      return
    }

    let settled = false
    let idleTimer: NodeJS.Timeout | undefined
    // Electron types IncomingMessage as a plain EventEmitter, but at runtime it
    // is a stream.Readable — destroy() and pipeline() below rely on that.
    let response: (IncomingMessage & Readable) | null = null
    let request: ClientRequest

    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(idleTimer)
      try { request.abort() } catch { /* already closed */ }
      // Tear the response down too so pipeline() releases the file handle —
      // on Windows an open fd would block the partial file's later cleanup.
      // destroy() WITHOUT an error: before pipeline() attaches, the stream has
      // no 'error' listener and destroy(err) would crash the process with an
      // uncaught exception; an active pipeline still rejects (premature close)
      // and that rejection is absorbed by the settled guard.
      try { response?.destroy() } catch { /* already destroyed */ }
      reject(err)
    }
    const armIdleTimer = (): void => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        fail(asRetriable(new Error(`Download stalled (no data for ${DOWNLOAD_IDLE_TIMEOUT_MS / 1000}s)`)))
      }, DOWNLOAD_IDLE_TIMEOUT_MS)
    }

    try {
      request = net.request({ url, redirect: 'manual' })
    } catch (err) {
      reject(err)
      return
    }
    if (resumeFrom > 0) request.setHeader('Range', `bytes=${resumeFrom}-`)
    armIdleTimer()

    // Same allowlist on EVERY hop of the redirect chain. Without this the
    // initial-URL check is moot: a 302 to an arbitrary host would be followed
    // unconditionally.
    let redirectsLeft = 5
    request.on('redirect', (_statusCode, _method, redirectUrl) => {
      if (settled) return
      if (redirectsLeft-- <= 0) {
        fail(new Error('Download failed: too many redirects'))
        return
      }
      if (!isAllowed(redirectUrl)) {
        fail(blockedError(redirectUrl))
        return
      }
      armIdleTimer()
      request.followRedirect()
    })

    request.on('error', (err) => fail(asRetriable(new Error(`Download failed: ${err.message}`))))

    request.on('response', (incoming) => {
      if (settled) return
      const res = incoming as IncomingMessage & Readable
      response = res
      armIdleTimer()

      if (res.statusCode < 200 || res.statusCode >= 300) {
        const err = new Error(`Download failed with HTTP ${res.statusCode}`)
        // Server-side transients are worth retrying; 4xx refusals are not.
        if (res.statusCode >= 500 || res.statusCode === 429) asRetriable(err)
        fail(err)
        return
      }

      // Detect HTML responses (mod page URLs instead of direct download links)
      const contentType = headerValue(res.headers, 'content-type') || ''
      if (contentType.includes('text/html')) {
        fail(new Error('URL is a web page, not a direct download link. Please use a direct .zip/.rar/.7z/.pak file URL.'))
        return
      }

      const resumed = res.statusCode === 206 && resumeFrom > 0
      let downloaded = resumed ? resumeFrom : 0
      let totalSize = 0
      if (resumed) {
        // Content-Range: bytes <start>-<end>/<total>
        const match = /\/(\d+)\s*$/.exec(headerValue(res.headers, 'content-range') || '')
        totalSize = match ? parseInt(match[1], 10) : 0
      } else {
        totalSize = parseInt(headerValue(res.headers, 'content-length') as string, 10) || 0
      }
      // No usable total: emit an indeterminate signal once so the renderer
      // can show a spinner instead of a bar stuck at 0%.
      if (onProgress && !totalSize) onProgress(-1)

      res.on('data', (chunk: Buffer) => {
        armIdleTimer()
        downloaded += chunk.length
        // Hard byte cap independent of content-length: a hostile or hijacked
        // stream with an absent/lying length would otherwise fill the disk
        // (the idle timeout only catches stalls, not a steady stream).
        if (downloaded > MAX_DOWNLOAD_BYTES) {
          fail(new Error('Download aborted: exceeds the maximum allowed size'))
          return
        }
        // Clamp: a server that over-sends past content-length must not push
        // the progress bar above 100%.
        if (onProgress && totalSize) {
          onProgress(Math.min(100, Math.round((downloaded / totalSize) * 100)))
        }
      })

      const file = fs.createWriteStream(destPath, { flags: resumed ? 'a' : 'w' })
      // pipeline() handles back-pressure, wires up errors on both streams,
      // and avoids double-unlink races from manual .on('error') handlers.
      pipeline(res, file)
        .then(() => {
          if (settled) return
          settled = true
          clearTimeout(idleTimer)
          resolve(destPath)
        })
        .catch((err) => {
          // Keep the partial file — a retriable failure resumes from it; the
          // outer downloadFile removes it once retries are exhausted.
          fail(asRetriable(err instanceof Error ? err : new Error(String(err))))
        })
    })

    request.end()
  })
}

// `allowedHosts` (optional) enforces the host allowlist on EVERY hop of a
// redirect chain. The list is REQUIRED — a missing/empty list denies every
// request (fail closed), so each caller must pass the allow-list for its own
// trust boundary. Entries match exactly unless prefixed with `*.` (see
// isHostAllowed above). Transient failures retry with resume; callers never
// see a torn file — on final failure the partial is removed before throwing.
async function downloadFile(
  url: string,
  destPath: string,
  onProgress: ProgressCallback | null | undefined,
  allowedHosts: readonly string[] | null | undefined
): Promise<string> {
  // Never resume leftovers from an unrelated earlier download.
  try { fs.rmSync(destPath, { force: true }) } catch { /* best-effort */ }

  let lastErr: unknown = null
  for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt++) {
    let resumeFrom = 0
    try { resumeFrom = fs.statSync(destPath).size } catch { resumeFrom = 0 }
    try {
      return await downloadFileOnce(url, destPath, onProgress, allowedHosts, resumeFrom)
    } catch (err) {
      lastErr = err
      if (!(err as RetriableError | null)?.downloadRetriable || attempt === DOWNLOAD_MAX_ATTEMPTS) break
      await new Promise(r => { setTimeout(r, DOWNLOAD_RETRY_BASE_DELAY_MS * attempt) })
    }
  }
  try { fs.rmSync(destPath, { force: true }) } catch { /* best-effort */ }
  throw lastErr
}

function extractRar(rarPath: string, destDir: string | null, analyzeOnly: true): Promise<ArchiveAnalysis>
function extractRar(rarPath: string, destDir: string, analyzeOnly?: boolean): Promise<ArchiveAnalysis>
async function extractRar(rarPath: string, destDir: string | null, analyzeOnly = false): Promise<ArchiveAnalysis> {
  const extractor = await createExtractorFromFile({ filepath: rarPath })

  const list = extractor.getFileList()
  const fileHeaders = [...list.fileHeaders]
  // Normalize `\`→`/` for validation/analysis the same way extractZip does, but
  // keep the mapping so extract() below still gets the ORIGINAL header names.
  const { entryNames, originalByNormalized } = buildEntryNameMap(fileHeaders.map(h => h.name))

  const analysis = analyzeArchiveStructure(entryNames, archiveModName(rarPath))

  if (analyzeOnly) return { ...analysis, entryNames }

  // Past the analyzeOnly return a destination is always given (see the overloads).
  destDir = destDir as string

  // validateEntries MUST run before any write — it is the sole zip-slip guard.
  // validateArchiveLimits rejects decompression bombs before the first byte
  // hits disk (node-unrar-js exposes uncompressed size as `.unpSize`).
  validateEntries(entryNames, destDir)
  validateArchiveLimits(fileHeaders.map(h => h.unpSize))
  fs.mkdirSync(destDir, { recursive: true })

  if (analysis.type === 'pak-only') {
    // node-unrar-js recreates each pak's sub-folders under its targetPath, and
    // destDir is the live Paks folder — so extract into a temp subdir (same
    // volume, cheap renames) and move only the paks to the root, like extract7z.
    const tempDir = path.join(destDir, `_hzmm_rar_temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
    try {
      const extractor2 = await createExtractorFromFile({ filepath: rarPath, targetPath: tempDir })
      // analysis.pakFiles are normalized names; node-unrar-js selects entries by
      // the raw header name, so map them back before requesting extraction.
      const rawPakFiles = analysis.pakFiles.map(p => originalByNormalized.get(p) ?? p)
      for (const f of [...extractor2.extract({ files: rawPakFiles }).files]) {
        if (f.fileHeader.flags.directory) continue
        const extractedPath = path.join(tempDir, f.fileHeader.name)
        if (!fs.existsSync(extractedPath)) continue
        // Disambiguate same-basename paks from different subfolders instead of
        // letting the second rename silently overwrite the first.
        fs.renameSync(extractedPath, resolveCollisionFreePath(path.join(destDir, path.basename(extractedPath))))
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  } else {
    // 重新建立 extractor 來解壓（getFileList 後需重建）
    const extractor2 = await createExtractorFromFile({ filepath: rarPath, targetPath: destDir })
    const extracted = extractor2.extract()
    // 必須迭代 generator 才會實際解壓檔案
    Array.from(extracted.files)
  }

  return analysis
}

// node-7z spawns the bundled 7za binary and reports entries/progress as
// stream events; resolve when the child exits cleanly.
function sevenStreamDone(stream: SevenStream): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stream.on('end', resolve)
    stream.on('error', reject)
  })
}

function extract7z(archivePath: string, destDir: string | null, analyzeOnly: true): Promise<ArchiveAnalysis>
function extract7z(archivePath: string, destDir: string, analyzeOnly?: boolean): Promise<ArchiveAnalysis>
async function extract7z(archivePath: string, destDir: string | null, analyzeOnly = false): Promise<ArchiveAnalysis> {
  const rawEntries: SevenEntry[] = []
  const listStream = Seven.list(archivePath, { $bin: SEVEN_BIN })
  listStream.on('data', (entry) => rawEntries.push(entry))
  await sevenStreamDone(listStream)

  // 7z lists directories as plain entries (attribute 'D', no trailing slash);
  // normalize to the zip convention — forward slashes, dirs end with '/' — so
  // analyzeArchiveStructure and callers treat all three formats identically.
  const entryNames = rawEntries.map((e) => {
    const name = String(e.file || '').replace(/\\/g, '/')
    const isDir = typeof e.attributes === 'string' && e.attributes.includes('D')
    return isDir && !name.endsWith('/') ? `${name}/` : name
  })
  const analysis = analyzeArchiveStructure(entryNames, archiveModName(archivePath))

  if (analyzeOnly) return { ...analysis, entryNames }

  // Past the analyzeOnly return a destination is always given (see the overloads).
  destDir = destDir as string

  // validateEntries MUST run before any write — same zip-slip guard as the
  // zip/rar paths. validateArchiveLimits rejects decompression bombs first
  // (7z list exposes per-entry uncompressed size as `.size`).
  validateEntries(entryNames, destDir)
  validateArchiveLimits(rawEntries.map((e) => e.size))
  fs.mkdirSync(destDir, { recursive: true })

  if (analysis.type === 'pak-only') {
    // destDir is the live Paks folder — readmes/screenshots inside the archive
    // must not land there. extractZip/extractRar cherry-pick via their libs;
    // 7za's include-mask semantics are fiddly enough that extracting to a temp
    // subdir and moving only the pak-family files over is the safer equivalent.
    const tempDir = path.join(destDir, '_hzmm_7z_temp')
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
      await sevenStreamDone(Seven.extractFull(archivePath, tempDir, { $bin: SEVEN_BIN }))
      assertNoSymlinks(tempDir)
      const moveDeepPaks = (dir: string): void => {
        for (const entry of fs.readdirSync(dir)) {
          const full = path.join(dir, entry)
          if (fs.lstatSync(full).isDirectory()) {
            moveDeepPaks(full)
          } else if (/\.(pak|ucas|utoc)$/i.test(entry)) {
            fs.renameSync(full, resolveCollisionFreePath(path.join(destDir, entry)))
          }
        }
      }
      moveDeepPaks(tempDir)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  } else {
    // Extract to a temp subdir (inside destDir, so renames stay on one volume),
    // reject symlinks, and only then merge the tree into the live destination.
    // Extracting straight into destDir would mean a malicious link is already
    // in the game folder by the time the walk finds it — and the partial
    // extraction would be left behind by the throw. Unique suffix so an archive
    // can't plausibly contain an entry with the same name.
    const tempDir = path.join(destDir, `_hzmm_7z_extract_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
    try {
      await sevenStreamDone(Seven.extractFull(archivePath, tempDir, { $bin: SEVEN_BIN }))
      assertNoSymlinks(tempDir)
      // Merge-move preserving structure. renameSync replaces existing files,
      // matching 7za's previous overwrite-on-extract (-y) behavior into destDir.
      const mergeMove = (srcDir: string, targetDir: string): void => {
        fs.mkdirSync(targetDir, { recursive: true })
        for (const entry of fs.readdirSync(srcDir)) {
          const from = path.join(srcDir, entry)
          const to = path.join(targetDir, entry)
          if (fs.lstatSync(from).isDirectory()) {
            mergeMove(from, to)
          } else {
            fs.renameSync(from, to)
          }
        }
      }
      mergeMove(tempDir, destDir)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }

  return analysis
}

async function extractZipRaw(zipPath: string, destDir: string): Promise<boolean> {
  const zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true })
  try {
    const entries = await zip.entries()
    const entryList = Object.values(entries)
    const { entryNames } = buildEntryNameMap(entryList.map(e => e.name))
    // validateEntries MUST run before any write — it is the sole zip-slip guard.
    validateEntries(entryNames, destDir)
    validateArchiveLimits(entryList.map(e => e.size))
    fs.mkdirSync(destDir, { recursive: true })
    await extractZipEntries(zipPath, entryList, entryNames, destDir)
    return true
  } finally {
    await zip.close()
  }
}

export {
  extractZip,
  extractZipRaw,
  extractRar,
  extract7z,
  detectArchiveFormat,
  copyFile,
  downloadFile,
  isHostAllowed,
  analyzeArchiveStructure,
  readZipEntryHead,
  buildEntryNameMap,
  isSafePath,
  validateEntries,
  validateArchiveLimits,
  resolveCollisionFreePath,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  MAX_ENTRY_COUNT,
}
