import path from 'path'

// Check whether `candidate` resolves to a location inside `parent`.
// Handles: trailing separators, mixed separators on Windows,
// symlink-like `..` escapes, and the candidate === parent boundary case.
export function isPathWithin(parent, candidate) {
  if (typeof parent !== 'string' || typeof candidate !== 'string') return false
  if (!parent || !candidate) return false

  const resolvedParent = path.resolve(parent)
  const resolvedCandidate = path.resolve(candidate)

  if (resolvedCandidate === resolvedParent) return true

  const parentWithSep = resolvedParent.endsWith(path.sep)
    ? resolvedParent
    : resolvedParent + path.sep

  return resolvedCandidate.startsWith(parentWithSep)
}

// Join segments under `parent` and return the absolute path only if the
// result stays inside `parent`. Otherwise throw. Use this instead of
// path.join + manual validation everywhere a renderer-supplied name or
// relative path is used to build a filesystem target.
export function resolveWithin(parent, ...segments) {
  if (typeof parent !== 'string' || !parent) {
    throw new Error('resolveWithin: parent must be a non-empty string')
  }
  for (const seg of segments) {
    if (typeof seg !== 'string') {
      throw new Error('resolveWithin: all segments must be strings')
    }
  }

  const joined = path.join(parent, ...segments)
  const resolved = path.resolve(joined)

  if (!isPathWithin(parent, resolved)) {
    throw new Error(`Path traversal blocked: ${segments.join('/')} escapes ${parent}`)
  }

  return resolved
}
