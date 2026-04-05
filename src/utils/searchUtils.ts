/**
 * Match text against a glob pattern.
 * - If pattern contains no '*': substring match (case-insensitive)
 * - If pattern contains '*': glob match where '*' = any sequence of chars
 *   e.g. "STARLINK*" = starts with STARLINK, "*spy*" = contains spy
 */
export function matchesGlob(text: string, pattern: string): boolean {
  if (!pattern) return true
  const lower = text.toLowerCase()
  const pat   = pattern.toLowerCase().trim()
  if (!pat.includes('*')) return lower.includes(pat)
  const regexStr = pat
    .split('*')
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${regexStr}$`).test(lower)
}
