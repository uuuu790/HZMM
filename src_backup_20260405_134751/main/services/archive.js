import StreamZip from 'node-stream-zip'
import { createExtractorFromFile } from 'node-unrar-js'
import https from 'https'
import http from 'http'
import fs from 'fs'
import path from 'path'

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

  if (hasGameStructure) {
    return { type: 'game-structure', pakFiles, luaFiles, dllFiles }
  }

  if (pakFiles.length > 0 && !luaFiles.length && !dllFiles.length && !hasModManifest) {
    return { type: 'pak-only', pakFiles, luaFiles, dllFiles }
  }

  // UE4SS mod 偵測：
  // 1. 有 enabled.txt + lua 腳本
  // 2. 有 Scripts/main.lua 或 main.lua 結構（常見 UE4SS mod 不附 enabled.txt）
  // 3. 有 dll 但無 pak（UE4SS C++ mod）
  const hasScriptsMain = entryNames.some(n => n.replace(/\\/g, '/').match(/Scripts\/main\.lua$/i))
  const hasMainLua = entryNames.some(n => path.basename(n) === 'main.lua')
  const isUe4ssMod = !hasGameStructure && (
    (luaFiles.length > 0 && hasEnabledTxt) ||
    hasScriptsMain ||
    (hasMainLua && luaFiles.length > 0) ||
    (dllFiles.length > 0 && pakFiles.length === 0 && luaFiles.length === 0)
  )

  if (isUe4ssMod) {
    return { type: 'ue4ss-mod', pakFiles, luaFiles, dllFiles }
  }

  // 複合型 mod（含 dll/manifest 等）
  return { type: 'complex', pakFiles, luaFiles, dllFiles }
}

async function extractZip(zipPath, destDir, analyzeOnly = false) {
  const zip = new StreamZip.async({ file: zipPath })
  try {
    const entries = await zip.entries()
    const entryNames = Object.values(entries).map(e => e.name)
    const analysis = analyzeArchiveStructure(entryNames)

    if (analyzeOnly) return analysis

    fs.mkdirSync(destDir, { recursive: true })

    if (analysis.type === 'pak-only') {
      for (const pakFile of analysis.pakFiles) {
        const fileName = path.basename(pakFile)
        await zip.extract(pakFile, path.join(destDir, fileName))
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

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const doRequest = (downloadUrl) => {
      const protocol = downloadUrl.startsWith('https') ? https : http
      protocol.get(downloadUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doRequest(res.headers.location)
          return
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume()
          reject(new Error(`Download failed with HTTP ${res.statusCode}`))
          return
        }

        const totalSize = parseInt(res.headers['content-length'], 10)
        let downloaded = 0
        const file = fs.createWriteStream(destPath)

        res.on('data', (chunk) => {
          downloaded += chunk.length
          file.write(chunk)
          if (onProgress && totalSize) {
            onProgress(Math.round((downloaded / totalSize) * 100))
          }
        })

        res.on('end', () => {
          file.end(() => resolve(destPath))
        })

        res.on('error', (err) => {
          file.end()
          if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
          reject(err)
        })

        file.on('error', (err) => {
          if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
          reject(err)
        })
      }).on('error', reject)
    }

    doRequest(url)
  })
}

async function extractRar(rarPath, destDir, analyzeOnly = false) {
  const extractor = await createExtractorFromFile({ filepath: rarPath })

  const list = extractor.getFileList()
  const fileHeaders = [...list.fileHeaders]
  const entryNames = fileHeaders.map(h => h.name)

  const analysis = analyzeArchiveStructure(entryNames)

  if (analyzeOnly) return analysis

  fs.mkdirSync(destDir, { recursive: true })

  // 重新建立 extractor 來解壓（getFileList 後需重建）
  const extractor2 = await createExtractorFromFile({ filepath: rarPath, targetPath: destDir })

  if (analysis.type === 'pak-only') {
    const extracted = extractor2.extract({ files: analysis.pakFiles })
    const files = [...extracted.files]
    // node-unrar-js extract 到 targetPath，但保留子目錄結構
    // 將深層 .pak 移到 destDir 根目錄
    for (const f of files) {
      if (f.fileHeader.flags.directory) continue
      const extractedPath = path.join(destDir, f.fileHeader.name)
      const targetPath = path.join(destDir, path.basename(f.fileHeader.name))
      if (extractedPath !== targetPath && fs.existsSync(extractedPath)) {
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

async function extractZipRaw(zipPath, destDir) {
  const zip = new StreamZip.async({ file: zipPath })
  try {
    fs.mkdirSync(destDir, { recursive: true })
    await zip.extract(null, destDir)
    return true
  } finally {
    await zip.close()
  }
}

export { extractZip, extractZipRaw, extractRar, copyFile, downloadFile }
