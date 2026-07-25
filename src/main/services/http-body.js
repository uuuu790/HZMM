// Shared helpers for reading an HTTP response body.
//
// Two bugs these exist to prevent, both of which were present in several
// clients at once:
//
//  1. `data += chunk` decodes every TCP chunk independently, so any multi-byte
//     UTF-8 character straddling a chunk boundary becomes U+FFFD. Concatenate
//     the raw buffers and decode once instead.
//  2. Buffering with no ceiling: a hostile or malfunctioning server can stream
//     until the main process runs out of memory. Every response we read fully
//     into memory is a small JSON document, so a low cap is free insurance.

// 8 MiB. The largest thing any of these endpoints legitimately returns is a
// Nexus mod list page measured in tens of KB.
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024

// Concatenate raw response chunks THEN decode once.
export function decodeUtf8Chunks(chunks) {
  return Buffer.concat(chunks).toString('utf8')
}

// Collect `res` into a UTF-8 string, rejecting if it exceeds `limit`.
// Resolves with the decoded body.
export function readJsonBody(res, { limit = MAX_RESPONSE_BYTES, onError } = {}) {
  return new Promise((resolve, reject) => {
    const fail = (err) => {
      res.destroy()
      if (onError) onError(err)
      reject(err)
    }
    const chunks = []
    let total = 0
    res.on('data', (chunk) => {
      total += chunk.length
      if (total > limit) {
        fail(new Error(`Response exceeded ${limit} bytes`))
        return
      }
      chunks.push(chunk)
    })
    res.on('error', fail)
    res.on('end', () => resolve(decodeUtf8Chunks(chunks)))
  })
}
