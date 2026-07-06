import StreamZip from 'node-stream-zip'
import { createExtractorFromFile } from 'node-unrar-js'
import Seven from 'node-7z'
import { path7za } from '7zip-bin'
import https from 'https'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { isPathWithin } from './path-safety.js'

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

// Zip Slip 防護：檢查解壓路徑是否超出目標目錄
function isSafePath(entryName, destDir) {
  return isPathWithin(destDir, path.resolve(destDir, entryName))
}

function validateEntries(entryNames, destDir) {
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
function buildEntryNameMap(rawNames) {
  const entryNames = []
  const originalByNormalized = new Map()
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
function validateArchiveLimits(sizes) {
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
function resolveCollisionFreePath(destPath) {
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

// 分析壓縮檔內部結構，判斷 mod 類型與安裝方式
function analyzeArchiveStructure(entryNames) {
  const pakFiles = entryNames.filter(n => n.endsWith('.pak') || n.endsWith('.ucas') || n.endsWith('.utoc'))
  const luaFiles = entryNames.filter(n => n.endsWith('.lua'))
  const dllFiles = entryNames.filter(n => n.endsWith('.dll'))
  const hasEnabledTxt = entryNames.some(n => path.basename(n) === 'enabled.txt')
  const hasModManifest = entryNames.some(n => path.basename(n) === 'modManifest.json')

  // 偵測是否有遊戲目錄結構（如 HumanitZ/Content/Paks/ 或 HumanitZ/Binaries/）
  const hasGameStructure = entryNames.some(n =>
    n.match(/^HumanitZ\/(Content|Binaries)\//i)
  )

  // UE4SS mod 偵測：
  // 1. 有 enabled.txt + lua 腳本
  // 2. 有 Scripts/main.lua 或 main.lua 結構（常見 UE4SS mod 不附 enabled.txt）
  // 3. 有 dll 但無 pak（UE4SS C++ mod）
  const hasScriptsMain = entryNames.some(n => n.replace(/\\/g, '/').match(/Scripts\/main\.lua$/i))
  const hasMainLua = entryNames.some(n => path.basename(n) === 'main.lua')
  const isUe4ssMod =
    (luaFiles.length > 0 && hasEnabledTxt) ||
    hasScriptsMain ||
    (hasMainLua && luaFiles.length > 0) ||
    (dllFiles.length > 0 && pakFiles.length === 0 && luaFiles.length === 0)

  // Find readme files in the archive
  const readmeNames = new Set(['readme.md', 'readme.txt', 'readme', 'description.txt', 'info.txt'])
  const readmeFiles = entryNames.filter(n => readmeNames.has(path.basename(n).toLowerCase()))

  // Build mod summary list for preview display
  const mods = []
  for (const p of pakFiles) {
    const name = path.basename(p).replace(/\.(pak|ucas|utoc)$/i, '').replace(/_P$/, '')
    mods.push({ name, modType: 'PAK' })
  }
  // UE4SS mod folders: find folder containing Scripts/main.lua or main.lua
  const ue4ssFolders = new Set()
  for (const l of luaFiles) {
    const parts = l.replace(/\\/g, '/').split('/')
    const idx = parts.findIndex(p => p.toLowerCase() === 'scripts')
    if (idx > 0) ue4ssFolders.add(parts[idx - 1])
    else if (parts.length >= 2) ue4ssFolders.add(parts[parts.length - 2])
  }
  for (const d of dllFiles) {
    const parts = d.replace(/\\/g, '/').split('/')
    // Cppmod standard layout is `<Mod>/dlls/main.dll`. The parent of `dlls/`
    // is the mod folder name; without stepping up an extra level we'd record
    // `'dlls'` and downstream rotate/restore would look at the wrong path.
    const dllsIdx = parts.findIndex(p => p.toLowerCase() === 'dlls')
    if (dllsIdx > 0) ue4ssFolders.add(parts[dllsIdx - 1])
    else if (parts.length >= 2) ue4ssFolders.add(parts[parts.length - 2])
  }
  for (const folder of ue4ssFolders) {
    mods.push({ name: folder, modType: 'UE4SS' })
  }

  // 混合型：同時有 PAK + UE4SS
  if (isUe4ssMod && pakFiles.length > 0) {
    return { type: 'hybrid', hasGameStructure, pakFiles, luaFiles, dllFiles, mods, readmeFiles }
  }

  // UE4SS 優先：即使包在遊戲目錄結構裡，有 UE4SS 特徵就判定為 UE4SS mod
  if (isUe4ssMod) {
    return { type: 'ue4ss-mod', hasGameStructure, pakFiles, luaFiles, dllFiles, mods, readmeFiles }
  }

  if (hasGameStructure) {
    return { type: 'game-structure', pakFiles, luaFiles, dllFiles, mods, readmeFiles }
  }

  if (pakFiles.length > 0 && !luaFiles.length && !dllFiles.length && !hasModManifest) {
    return { type: 'pak-only', pakFiles, luaFiles, dllFiles, mods, readmeFiles }
  }

  // 複合型 mod（含 dll/manifest 等）
  return { type: 'complex', pakFiles, luaFiles, dllFiles, mods, readmeFiles }
}

// Sniff the real archive format from magic bytes. A downloaded file's
// extension can't be trusted: Nexus's newer CDN serves GUID paths with no
// extension at all, and the download flow falls back to naming those .zip —
// feeding a RAR/7z payload to the zip extractor ("Bad archive").
// Returns 'zip' | 'rar' | '7z' | 'unknown'; any read failure is 'unknown'.
function detectArchiveFormat(filePath) {
  let fd
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

async function extractZip(zipPath, destDir, analyzeOnly = false) {
  // skipEntryNameValidation: some zip tools (e.g. Windows built-in) produce backslash paths
  // which node-stream-zip rejects as "Malicious entry"
  const zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true })
  try {
    const entries = await zip.entries()
    const entryList = Object.values(entries)
    const { entryNames, originalByNormalized } = buildEntryNameMap(entryList.map(e => e.name))
    const analysis = analyzeArchiveStructure(entryNames)

    if (analyzeOnly) return { ...analysis, entryNames }

    // validateEntries MUST run before any write — it is the sole zip-slip guard
    // (skipEntryNameValidation is on so node-stream-zip won't reject the
    // backslash paths we normalize ourselves). validateArchiveLimits likewise
    // rejects decompression bombs before the first byte hits disk.
    validateEntries(entryNames, destDir)
    validateArchiveLimits(entryList.map(e => e.size))
    fs.mkdirSync(destDir, { recursive: true })

    if (analysis.type === 'pak-only') {
      for (const pakFile of analysis.pakFiles) {
        const fileName = path.basename(pakFile)
        const target = resolveCollisionFreePath(path.join(destDir, fileName))
        // pakFile is a normalized name; node-stream-zip keys entries by the
        // original (backslashes preserved), so hand it the raw name or the
        // lookup misses and zero files get written.
        await zip.extract(originalByNormalized.get(pakFile) ?? pakFile, target)
      }
    } else {
      await zip.extract(null, destDir)
    }

    return analysis
  } finally {
    await zip.close()
  }
}

function copyFile(src, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  const destPath = path.join(destDir, path.basename(src))
  fs.copyFileSync(src, destPath)
  return destPath
}

// Kill the download if no bytes flow for this long. setTimeout on the
// underlying request is an idle timeout: it resets on every chunk, so big
// downloads won't trip it as long as the server is sending data.
const DOWNLOAD_IDLE_TIMEOUT_MS = 60000

// `allowedHosts` (optional) enforces the host allowlist on EVERY hop of a
// redirect chain. Without this the initial-URL check at the caller is moot:
// a 302 to an arbitrary host would be followed unconditionally. Callers that
// already trust the user-supplied URL (mods:download-url, nexus) pass null.
function downloadFile(url, destPath, onProgress, allowedHosts = null) {
  return new Promise((resolve, reject) => {
    const isAllowed = (target) => {
      if (!allowedHosts) return true
      try {
        const u = new URL(target)
        if (u.protocol !== 'https:') return false
        return allowedHosts.some(h => u.hostname === h || u.hostname.endsWith('.' + h))
      } catch {
        return false
      }
    }
    const MAX_REDIRECTS = 5
    const doRequest = (downloadUrl, redirectsLeft = MAX_REDIRECTS) => {
      if (!isAllowed(downloadUrl)) {
        reject(new Error(`Download blocked: ${downloadUrl} is not in the allowed host list`))
        return
      }
      const protocol = downloadUrl.startsWith('https') ? https : http
      const req = protocol.get(downloadUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume() // drain the redirect body so the underlying socket is freed
          if (redirectsLeft <= 0) {
            reject(new Error('Download failed: too many redirects'))
            return
          }
          // Location may be relative ('/path'); resolve it against the current
          // URL so relative hops work and the allowlist sees an absolute URL.
          let next
          try {
            next = new URL(res.headers.location, downloadUrl).toString()
          } catch {
            reject(new Error(`Download failed: invalid redirect target "${res.headers.location}"`))
            return
          }
          doRequest(next, redirectsLeft - 1)
          return
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume()
          reject(new Error(`Download failed with HTTP ${res.statusCode}`))
          return
        }

        // Detect HTML responses (mod page URLs instead of direct download links)
        const contentType = res.headers['content-type'] || ''
        if (contentType.includes('text/html')) {
          res.resume()
          reject(new Error('URL is a web page, not a direct download link. Please use a direct .zip/.rar/.7z/.pak file URL.'))
          return
        }

        const totalSize = parseInt(res.headers['content-length'], 10)
        let downloaded = 0
        if (onProgress) {
          if (totalSize) {
            res.on('data', (chunk) => {
              downloaded += chunk.length
              // Clamp: a server that over-sends past content-length must not
              // push the bar above 100%.
              onProgress(Math.min(100, Math.round((downloaded / totalSize) * 100)))
            })
          } else {
            // No usable content-length: emit an indeterminate signal once so the
            // renderer can show a spinner instead of a bar stuck at 0%.
            onProgress(-1)
          }
        }

        const file = fs.createWriteStream(destPath)
        // pipeline() handles back-pressure, wires up errors on both streams,
        // and avoids double-unlink races from manual .on('error') handlers.
        pipeline(res, file)
          .then(() => resolve(destPath))
          .catch((err) => {
            try {
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
            } catch {
              // best-effort cleanup — ignore if the partial file can't be removed
            }
            reject(err)
          })
      })
      req.on('error', reject)
      req.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () => {
        req.destroy()
        reject(new Error('Download stalled (no data for 60s)'))
      })
    }

    doRequest(url)
  })
}

async function extractRar(rarPath, destDir, analyzeOnly = false) {
  const extractor = await createExtractorFromFile({ filepath: rarPath })

  const list = extractor.getFileList()
  const fileHeaders = [...list.fileHeaders]
  // Normalize `\`→`/` for validation/analysis the same way extractZip does, but
  // keep the mapping so extract() below still gets the ORIGINAL header names.
  const { entryNames, originalByNormalized } = buildEntryNameMap(fileHeaders.map(h => h.name))

  const analysis = analyzeArchiveStructure(entryNames)

  if (analyzeOnly) return { ...analysis, entryNames }

  // validateEntries MUST run before any write — it is the sole zip-slip guard.
  // validateArchiveLimits rejects decompression bombs before the first byte
  // hits disk (node-unrar-js exposes uncompressed size as `.unpSize`).
  validateEntries(entryNames, destDir)
  validateArchiveLimits(fileHeaders.map(h => h.unpSize))
  fs.mkdirSync(destDir, { recursive: true })

  // 重新建立 extractor 來解壓（getFileList 後需重建）
  const extractor2 = await createExtractorFromFile({ filepath: rarPath, targetPath: destDir })

  if (analysis.type === 'pak-only') {
    // analysis.pakFiles are normalized names; node-unrar-js selects entries by
    // the raw header name, so map them back before requesting extraction.
    const rawPakFiles = analysis.pakFiles.map(p => originalByNormalized.get(p) ?? p)
    const extracted = extractor2.extract({ files: rawPakFiles })
    const files = [...extracted.files]
    // node-unrar-js extract 到 targetPath，但保留子目錄結構
    // 將深層 .pak 移到 destDir 根目錄
    for (const f of files) {
      if (f.fileHeader.flags.directory) continue
      const extractedPath = path.join(destDir, f.fileHeader.name)
      const rootPath = path.join(destDir, path.basename(f.fileHeader.name))
      // Only deep paks need moving to the root; a pak already at the root is
      // left in place (rootPath === extractedPath).
      if (extractedPath !== rootPath && fs.existsSync(extractedPath)) {
        // Disambiguate same-basename paks from different subfolders instead of
        // letting the second rename silently overwrite the first.
        const targetPath = resolveCollisionFreePath(rootPath)
        fs.renameSync(extractedPath, targetPath)
      }
    }
  } else {
    const extracted = extractor2.extract()
    // 必須迭代 generator 才會實際解壓檔案
    ;[...extracted.files]
  }

  return analysis
}

// node-7z spawns the bundled 7za binary and reports entries/progress as
// stream events; resolve when the child exits cleanly.
function sevenStreamDone(stream) {
  return new Promise((resolve, reject) => {
    stream.on('end', resolve)
    stream.on('error', reject)
  })
}

async function extract7z(archivePath, destDir, analyzeOnly = false) {
  const rawEntries = []
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
  const analysis = analyzeArchiveStructure(entryNames)

  if (analyzeOnly) return { ...analysis, entryNames }

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
      const moveDeepPaks = (dir) => {
        for (const entry of fs.readdirSync(dir)) {
          const full = path.join(dir, entry)
          if (fs.statSync(full).isDirectory()) {
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
    await sevenStreamDone(Seven.extractFull(archivePath, destDir, { $bin: SEVEN_BIN }))
  }

  return analysis
}

async function extractZipRaw(zipPath, destDir) {
  const zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true })
  try {
    const entries = await zip.entries()
    const entryList = Object.values(entries)
    const { entryNames } = buildEntryNameMap(entryList.map(e => e.name))
    // validateEntries MUST run before any write — it is the sole zip-slip guard.
    validateEntries(entryNames, destDir)
    validateArchiveLimits(entryList.map(e => e.size))
    fs.mkdirSync(destDir, { recursive: true })
    await zip.extract(null, destDir)
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
  analyzeArchiveStructure,
  buildEntryNameMap,
  isSafePath,
  validateEntries,
  validateArchiveLimits,
  resolveCollisionFreePath,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  MAX_ENTRY_COUNT,
}
