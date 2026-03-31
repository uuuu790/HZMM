import fs from 'fs'
import logger from './logger.js'

const PAK_MAGIC = 0x5A6F12E1
const FOOTER_READ_SIZE = 221

function readFString(buffer, offset) {
  if (offset + 4 > buffer.length) return { str: '', bytesRead: 4 }

  let strLen = buffer.readInt32LE(offset)
  if (strLen === 0) return { str: '', bytesRead: 4 }

  const isUnicode = strLen < 0
  if (isUnicode) {
    strLen = -strLen
    const byteLen = strLen * 2
    if (offset + 4 + byteLen > buffer.length) return { str: '', bytesRead: 4 + byteLen }
    const str = buffer.toString('utf16le', offset + 4, offset + 4 + byteLen - 2)
    return { str, bytesRead: 4 + byteLen }
  }

  if (offset + 4 + strLen > buffer.length) return { str: '', bytesRead: 4 + strLen }
  const str = buffer.toString('utf-8', offset + 4, offset + 4 + strLen - 1)
  return { str, bytesRead: 4 + strLen }
}

function parseFooter(buffer, fileSize) {
  for (let i = buffer.length - 4; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === PAK_MAGIC) {
      const magicOffset = i

      if (magicOffset + 8 > buffer.length) continue
      const version = buffer.readInt32LE(magicOffset + 4)
      if (version < 1 || version > 11) continue

      if (magicOffset + 16 > buffer.length) continue
      const indexOffset = Number(buffer.readBigInt64LE(magicOffset + 8))

      if (magicOffset + 24 > buffer.length) continue
      const indexSize = Number(buffer.readBigInt64LE(magicOffset + 16))

      const bEncryptedIndex = magicOffset > 0 ? buffer.readUInt8(magicOffset - 1) : 0

      if (indexOffset >= 0 && indexOffset < fileSize && indexSize > 0 && indexSize < fileSize) {
        return { version, indexOffset, indexSize, bEncryptedIndex }
      }
    }
  }

  return null
}

function readPakIndex(filePath) {
  try {
    const stat = fs.statSync(filePath)
    const fileSize = stat.size
    if (fileSize < FOOTER_READ_SIZE) return []

    const fd = fs.openSync(filePath, 'r')

    try {
      // Read footer area
      const footerBuf = Buffer.alloc(FOOTER_READ_SIZE)
      fs.readSync(fd, footerBuf, 0, FOOTER_READ_SIZE, fileSize - FOOTER_READ_SIZE)

      const footer = parseFooter(footerBuf, fileSize)
      if (!footer) return []

      if (footer.version < 7 || footer.version > 11) return []
      if (footer.bEncryptedIndex) return []

      // Read index
      const indexBuf = Buffer.alloc(footer.indexSize)
      fs.readSync(fd, indexBuf, 0, footer.indexSize, footer.indexOffset)

      // Parse index: mount point string, then entry count, then entries
      let offset = 0
      const { str: mountPoint, bytesRead: mpBytes } = readFString(indexBuf, offset)
      offset += mpBytes

      if (offset + 4 > indexBuf.length) return []
      const entryCount = indexBuf.readInt32LE(offset)
      offset += 4

      if (entryCount <= 0 || entryCount > 1000000) return []

      const entries = []
      for (let i = 0; i < entryCount; i++) {
        if (offset >= indexBuf.length) break
        const { str: fileName, bytesRead } = readFString(indexBuf, offset)
        offset += bytesRead

        if (fileName) {
          entries.push(mountPoint + fileName)
        }

        // Skip entry metadata (variable size depending on version)
        if (offset + 4 <= indexBuf.length) {
          if (footer.version <= 8) {
            // v7-v8: offset(8) + size(8) + uncompressed(8) + compressionMethod(4) + hash(20) = 48
            offset += 48
            if (offset + 4 <= indexBuf.length) {
              const compressionBlockCount = indexBuf.readUInt32LE(offset)
              offset += 4
              offset += compressionBlockCount * 16
            }
            offset += 1 // bEncrypted
            offset += 4 // compressionBlockSize
          } else {
            // v9+ encoded entry
            offset += 12
          }
        }
      }

      return entries
    } finally {
      fs.closeSync(fd)
    }
  } catch (err) {
    logger.warn(`Failed to parse PAK: ${filePath} — ${err.message}`)
    return []
  }
}

export { readPakIndex }
