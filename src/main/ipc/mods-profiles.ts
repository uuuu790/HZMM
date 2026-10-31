// Profile snapshot / restore IPC. Uses the same scanConfigDir / resolve
// helpers as mods-config.ts so that "take a snapshot of every UE4SS mod's
// config" and "replay a snapshot" share the same traversal-safe path
// resolution logic.
//
// Split out of mods.js as part of the 651-line refactor.

import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import fs from 'fs'
import path from 'path'
import luaparse from 'luaparse'
import configStore from '../services/config-store'
import { getUe4ssModsPath } from '../services/steam-detector'
import { assertSafeSegment } from '../services/path-safety'
import logger from '../services/logger'
import { BUILTIN_MODS, CONFIG_EXTENSIONS } from './constants'
import { invalidateCache } from './mods-scan'
import { scanConfigDir, resolveModConfigPath, isSnapshotConfigFile, SNAPSHOT_EXCLUDE_FILES } from './mods-config'
import type { ConfigSnapshot } from './types'

const BUILTIN_MODS_LOWER: ReadonlySet<string> = new Set([...BUILTIN_MODS].map(n => n.toLowerCase()))

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

interface LuaNode {
  type: string
  range: [number, number]
  [field: string]: unknown
}

const LUA_LITERALS = new Set(['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NilLiteral'])
const LUA_CALLS = new Set(['CallExpression', 'StringCallExpression', 'TableCallExpression'])
// UE4SS's key-code tables: `Key = Key.F5` in a config is a value, not code.
const LUA_KEY_TABLES = ['Key', 'ModifierKey']

// A node's syntax tree without positions: comments and layout never reach it,
// and literals keep their exact source text (`raw`).
const luaCanon = (node: LuaNode): string => JSON.stringify(node, (key, value) => (key === 'range' ? undefined : value))

function luaWalk(node: unknown, visit: (n: LuaNode, parent: LuaNode | null, field: string) => void, parent: LuaNode | null = null, field = ''): void {
  if (Array.isArray(node)) {
    for (const child of node) luaWalk(child, visit, parent, field)
  } else if (node && typeof node === 'object' && typeof (node as LuaNode).type === 'string') {
    const n = node as LuaNode
    visit(n, parent, field)
    for (const [key, value] of Object.entries(n)) if (key !== 'range') luaWalk(value, visit, n, key)
  }
}

// True when evaluating `node` calls something right away (a function's body only runs later).
function luaRunsNow(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(luaRunsNow)
  if (!node || typeof node !== 'object') return false
  const n = node as LuaNode
  if (n.type === 'FunctionDeclaration') return false
  if (LUA_CALLS.has(n.type)) return true
  return Object.entries(n).some(([key, value]) => key !== 'range' && luaRunsNow(value))
}

// The parts of a Lua file that are not plain data, keyed by where they sit
// (the assignment target / table key path, or 'chunk' for a statement) plus
// their syntax tree; null when the file doesn't parse. Data is literals,
// tables of them, operators on them, UE4SS Key.X / ModifierKey.X values and
// names this file bound to data or to a table it built, earlier at chunk
// level. Everything else (calls, functions, loops, reads of outside globals
// such as os.execute, writes into tables like package.path) is a fragment.
// Values map each key to readable source for the log.
function luaCodeFragments(text: string): Map<string, string> | null {
  // Lua 5.4's <const> is valid in config.lua but unknown to luaparse's 5.3
  // grammar: blank it out. (<close> runs a metamethod, so it stays an error.)
  const src = text.replace(/^\uFEFF/, '').replace(/<\s*const\s*>/g, m => ' '.repeat(m.length))
  let chunk: LuaNode
  try {
    chunk = luaparse.parse(src, { luaVersion: '5.3', comments: false, scope: false, locations: false, ranges: true }) as LuaNode
  } catch {
    return null
  }
  // Key / ModifierKey stay UE4SS's tables only if the file never uses the
  // name any other way (binding it, passing it around) and never touches _ENV.
  const keyTables = new Set(LUA_KEY_TABLES)
  luaWalk(chunk, (n, parent, field) => {
    if (n.type !== 'Identifier' || !parent) return
    if ((parent.type === 'MemberExpression' && field === 'identifier') || (parent.type === 'TableKeyString' && field === 'key')) return
    if (n.name === '_ENV') keyTables.clear()
    else if (!(parent.type === 'MemberExpression' && field === 'base' && parent.indexer === '.')) keyTables.delete(n.name as string)
  })

  const fragments = new Map<string, string>()
  const dataNames = new Set<string>()
  let ranNow = false
  const record = (node: LuaNode, at: string): void => {
    if (luaRunsNow(node)) ranNow = true
    fragments.set(`${at}\n${luaCanon(node)}`, src.slice(node.range[0], node.range[1]).replace(/\s+/g, ' ').trim())
  }
  // Records every non-data part of an expression found at `at`; returns true when it had none.
  const collect = (node: LuaNode, at: string): boolean => {
    if (LUA_LITERALS.has(node.type)) return true
    if (node.type === 'Identifier' && dataNames.has(node.name as string)) return true
    const base = node.base as LuaNode | undefined
    if (node.type === 'MemberExpression' && node.indexer === '.' && base?.type === 'Identifier' && keyTables.has(base.name as string)) return true
    if (node.type === 'TableConstructorExpression') {
      let pure = true
      let position = 0
      for (const field of node.fields as LuaNode[]) {
        let where: string
        if (field.type === 'TableKeyString') {
          where = `${at}.${(field.key as LuaNode).name as string}`
        } else if (field.type === 'TableKey') {
          if (!collect(field.key as LuaNode, `${at}[]`)) pure = false
          where = `${at}[${luaCanon(field.key as LuaNode)}]`
        } else {
          where = `${at}#${++position}`
        }
        if (!collect(field.value as LuaNode, where)) pure = false
      }
      return pure
    }
    if (node.type === 'UnaryExpression') return collect(node.argument as LuaNode, `${at} ${node.operator as string}`)
    if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression') {
      const left = collect(node.left as LuaNode, `${at} ${node.operator as string}<`)
      return collect(node.right as LuaNode, `${at} ${node.operator as string}>`) && left
    }
    record(node, at)
    return false
  }
  const rootName = (node: LuaNode): string | null => {
    let n = node
    while (n.type === 'MemberExpression' || n.type === 'IndexExpression') n = n.base as LuaNode
    return n.type === 'Identifier' ? (n.name as string) : null
  }
  for (const stmt of chunk.body as LuaNode[]) {
    ranNow = false
    if (stmt.type === 'ReturnStatement') {
      (stmt.arguments as LuaNode[]).forEach((arg, i) => collect(arg, `return#${i + 1}`))
    } else if (stmt.type === 'LocalStatement' || stmt.type === 'AssignmentStatement') {
      const targets = stmt.variables as LuaNode[]
      // Writing a field is data only into a table this file itself built (no
      // metatable, so nothing runs). Anything else, e.g. package.path, is code.
      if (targets.some(t => t.type !== 'Identifier' && !dataNames.has(rootName(t) ?? ''))) {
        record(stmt, 'chunk')
        dataNames.clear()
        continue
      }
      const local = stmt.type === 'LocalStatement' ? 'local ' : ''
      const where = targets.map(t => local + luaCanon(t))
      targets.forEach((t, i) => {
        // Every [key] along the target's chain is evaluated too: Config[f()].x = 1.
        for (let n = t; n.type === 'MemberExpression' || n.type === 'IndexExpression'; n = n.base as LuaNode) {
          if (n.type === 'IndexExpression') collect(n.index as LuaNode, `${where[i]}[]`)
        }
      })
      const init = stmt.init as LuaNode[]
      // A table this file builds stays its own even with code in a field
      // (that code sits at a known key): writes into it are still plain.
      const owned = init.map((value, i) => collect(value, where[i] ?? `${local}#${i + 1}`) || value.type === 'TableConstructorExpression')
      // Something just ran and may have rebound any name: trust none of them.
      if (ranNow) dataNames.clear()
      targets.forEach((t, i) => {
        if (t.type !== 'Identifier') return
        // Extra names take nil, unless the last value is a (multi-value) call.
        if (i < init.length ? owned[i] : init.length === 0 || owned[init.length - 1]) dataNames.add(t.name as string)
        else dataNames.delete(t.name as string)
      })
    } else if (stmt.type === 'FunctionDeclaration') {
      // Defining a function runs nothing (its body runs when called); it only
      // binds the name, or writes a field of its table.
      record(stmt, 'chunk')
      const id = stmt.identifier as LuaNode
      if (id.type === 'Identifier') dataNames.delete(id.name as string)
      else if (!dataNames.has(rootName(id) ?? '')) dataNames.clear()
    } else {
      record(stmt, 'chunk')
      dataNames.clear()
    }
  }
  return fragments
}

// config.lua is require()'d by the mod's main.lua, so a restored .lua must not
// bring in code: every non-data part has to exist in the installed copy
// already, at the same place (a legit snapshot of the same mod version always
// passes; only values differ).
function assertNoNewLuaCode(content: string, current: string | null): void {
  const incoming = luaCodeFragments(content)
  if (!incoming) throw new Error('not valid Lua')
  if (incoming.size === 0) return
  const known = (current !== null && luaCodeFragments(current)) || new Map<string, string>()
  for (const [key, text] of incoming) {
    if (!known.has(key)) throw new Error(`adds Lua code the installed file doesn't have: ${text.slice(0, 80)}`)
  }
}

function restoreConfigFile(ue4ssModsPath: string, modName: string, relativePath: string, content: unknown): void {
  if (typeof content !== 'string') throw new Error('content is not text')
  // Plain names only: no "."/"..", empty segments, NTFS streams (":"), or
  // trailing dots/spaces that Windows would strip.
  for (const segment of relativePath.split(/[\\/]/)) assertSafeSegment('relativePath', segment)
  if (!isSnapshotConfigFile(relativePath)) throw new Error('not a config file a profile snapshot holds')
  const resolved = resolveModConfigPath(ue4ssModsPath, modName, relativePath)

  let stat: fs.Stats | null = null
  try { stat = fs.lstatSync(resolved) } catch { /* not there yet */ }
  if (stat && !stat.isFile()) throw new Error('target is not a regular file')
  if (/\.lua$/i.test(relativePath)) {
    assertNoNewLuaCode(content, stat ? fs.readFileSync(resolved, 'utf-8') : null)
  }

  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  // Atomic write: tmp + rename. A crash / power-loss mid-write would
  // otherwise leave a truncated, corrupt config file. The tmp sits next
  // to the target (same dir/volume) so renameSync never hits EXDEV.
  const tmp = `${resolved}.tmp`
  try {
    fs.writeFileSync(tmp, content, 'utf-8')
    fs.renameSync(tmp, resolved)
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }) } catch { /* best-effort */ }
    throw err
  }
}

export function registerModsProfilesIpc(): void {
  ipcMain.handle('profiles:snapshot-configs', (): ConfigSnapshot => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return {}

    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) return {}

    const configExts = new Set(CONFIG_EXTENSIONS)
    const snapshot: ConfigSnapshot = {}

    const dirs = fs.readdirSync(ue4ssModsPath)
    for (const dir of dirs) {
      if (BUILTIN_MODS.has(dir)) continue
      const modDir = path.join(ue4ssModsPath, dir)
      if (!fs.statSync(modDir).isDirectory()) continue

      const modConfigs: Record<string, string> = {}

      scanConfigDir(modDir, '', configExts, SNAPSHOT_EXCLUDE_FILES, (relPath, fullPath) => {
        try {
          modConfigs[relPath] = fs.readFileSync(fullPath, 'utf-8')
        } catch {
          // 讀不到就跳過
        }
      })
      if (Object.keys(modConfigs).length > 0) {
        snapshot[dir] = modConfigs
      }
    }

    return snapshot
  })

  // configSnapshot: a saved profile's snapshot from profiles:snapshot-configs,
  // or one that came in with an imported (shared) profile, so it is untrusted.
  // Only files the snapshot side would capture are written, never into
  // UE4SS's builtin mods, and one bad entry never stops the rest.
  ipcMain.handle('profiles:restore-configs', (_: IpcMainInvokeEvent, configSnapshot: ConfigSnapshot | null | undefined) => {
    if (!isPlainObject(configSnapshot)) return false

    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found')

    // Look names up among the real folder names: case-insensitive like the
    // Windows fs, and an 8.3 alias (BPMODL~1) matches nothing.
    const installed = new Map<string, string>()
    for (const name of fs.readdirSync(ue4ssModsPath)) installed.set(name.toLowerCase(), name)

    for (const [modName, configs] of Object.entries(configSnapshot)) {
      if (!modName) continue
      try {
        assertSafeSegment('modName', modName)
      } catch (err) {
        logger.warn(`Skipping unsafe mod name in profile restore: ${modName} — ${(err as Error).message}`)
        continue
      }
      const realName = installed.get(modName.toLowerCase())
      if (!realName || BUILTIN_MODS_LOWER.has(realName.toLowerCase())) continue
      if (!isPlainObject(configs)) continue
      try {
        if (!fs.statSync(path.join(ue4ssModsPath, realName)).isDirectory()) continue
      } catch {
        continue
      }

      for (const [relativePath, content] of Object.entries(configs)) {
        try {
          restoreConfigFile(ue4ssModsPath, realName, relativePath, content)
        } catch (err) {
          logger.warn(`Skipping profile config ${modName}/${relativePath}: ${(err as Error).message}`)
        }
      }
    }

    invalidateCache()
    return true
  })
}
