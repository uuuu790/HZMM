import fs from 'fs'
import logger from './logger.js'
import {
  FOOTER_READ_SIZE,
  MAX_INDEX_SIZE,
  parseFooter,
  parseLegacyIndex,
  parsePrimaryIndexHeader,
  parseFullDirectoryIndex,
} from './pak-index.js'

// Read a .pak's index and return the list of resource paths it contains, used
// for cross-mod conflict detection. All byte parsing lives in pak-index.js (a
// pure, unit-tested module); this file only does the fs reads and picks the
// layout by version. Anything unexpected degrades to [] (fail-safe: never a
// false conflict).
function readPakIndex(filePath) {
  try {
    const stat = fs.statSync(filePath)
    const fileSize = stat.size
    if (fileSize < FOOTER_READ_SIZE) return []

    const fd = fs.openSync(filePath, 'r')
    try {
      // Read the footer region and locate the index.
      const footerBuf = Buffer.alloc(FOOTER_READ_SIZE)
      fs.readSync(fd, footerBuf, 0, FOOTER_READ_SIZE, fileSize - FOOTER_READ_SIZE)

      const footer = parseFooter(footerBuf, fileSize)
      if (!footer) return []
      if (footer.version < 7 || footer.version > 11) return []
      if (footer.bEncryptedIndex) return []
      if (footer.indexSize > MAX_INDEX_SIZE) {
        logger.warn(`PAK index too large (${footer.indexSize} bytes), skipping: ${filePath}`)
        return []
      }

      // Read the primary index.
      const indexBuf = Buffer.alloc(footer.indexSize)
      fs.readSync(fd, indexBuf, 0, footer.indexSize, footer.indexOffset)

      // v7-8: filenames are stored inline in the primary index.
      if (footer.version <= 8) {
        return parseLegacyIndex(indexBuf)
      }

      // v10-11 (and v9, which fails safe): path-hash index v2. The primary index
      // no longer holds filenames — it points at a separate FullDirectoryIndex
      // that does. Read + parse that. This is the modern UnrealPak default, so
      // without it conflict detection saw zero files for most current mod PAKs.
      const header = parsePrimaryIndexHeader(indexBuf)
      if (!header || header.fullDirIndexOffset === null) return []

      const { fullDirIndexOffset, fullDirIndexSize, mountPoint } = header
      if (fullDirIndexOffset < 0 || fullDirIndexOffset >= fileSize) return []
      if (!(fullDirIndexSize > 0) || fullDirIndexSize > MAX_INDEX_SIZE) return []
      if (fullDirIndexOffset + fullDirIndexSize > fileSize) return []

      const dirBuf = Buffer.alloc(fullDirIndexSize)
      fs.readSync(fd, dirBuf, 0, fullDirIndexSize, fullDirIndexOffset)
      return parseFullDirectoryIndex(dirBuf, mountPoint)
    } finally {
      fs.closeSync(fd)
    }
  } catch (err) {
    logger.warn(`Failed to parse PAK: ${filePath} — ${err.message}`)
    return []
  }
}

export { readPakIndex }
