export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// Round first, then pick the precision, so 9,999 reads '10k' (not '10.0k').
function compactCount(n, div, unit) {
  const v = n / div
  const oneDecimal = Math.round(v * 10) / 10
  return oneDecimal < 10 ? `${oneDecimal.toFixed(1)}${unit}` : `${Math.round(v)}${unit}`
}

// Format large numbers as "1.2k" / "3.4M" / "567"
export function formatCount(n) {
  if (n == null || isNaN(n)) return '—'
  // 999,500+ would round to '1000k'; promote it to the M unit instead.
  if (n >= 1_000_000 || Math.round(n / 1_000) >= 1_000) return compactCount(n, 1_000_000, 'M')
  if (n >= 1_000) return compactCount(n, 1_000, 'k')
  return String(n)
}

export function formatDate(unixSeconds) {
  if (!unixSeconds) return '—'
  return new Date(unixSeconds * 1000).toLocaleDateString()
}

// Download progress events carry 0–100, or -1 when the total size is unknown.
// Returns null for anything that is not a known percentage (render as
// indeterminate instead of '-1%').
export function knownPercent(p) {
  return typeof p === 'number' && Number.isFinite(p) && p >= 0 ? Math.min(p, 100) : null
}

// GitHub release tags already carry the 'v' ('v1.8.0'); add one only if missing.
export function formatVersionTag(version) {
  const s = version == null ? '' : String(version).trim()
  return s ? `v${s.replace(/^v/i, '')}` : ''
}

// Backup timestamps are filename-safe ISO ('2026-01-02T03-04-05', 'auto_'
// prefixed for auto backups without metadata) -> '2026/01/02 03:04:05'.
export function formatBackupTimestamp(ts, dateOnly = false) {
  if (typeof ts !== 'string') return ''
  const m = /(\d{4})-(\d{2})-(\d{2})(?:T(\d{2})-(\d{2})-(\d{2}))?/.exec(ts)
  if (!m) return ts
  const date = `${m[1]}/${m[2]}/${m[3]}`
  return dateOnly || !m[4] ? date : `${date} ${m[4]}:${m[5]}:${m[6]}`
}
