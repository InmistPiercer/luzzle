export const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function highlightParts(s: string, form: string, nth = 0): [string, string, string] | null {
  const hits = [...s.matchAll(new RegExp(`\\b${escRe(form)}\\b`, 'gi'))]
  const m = hits[nth] || hits[0]
  if (!m || m.index == null) return null
  return [s.slice(0, m.index), m[0], s.slice(m.index + m[0].length)]
}
