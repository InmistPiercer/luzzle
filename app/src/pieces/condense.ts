import { lemmatize } from '../lang/lemmatize'
import { stripCites } from '../reader/text'

export interface Condensed {
  parts: { t: string; hit?: boolean }[]
  cutL: boolean
  cutR: boolean
}

const core = (tok: string) => tok.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '')

export function condense(sentence: string, targets: string[], forms: string[] = [], around = 7, max = 20): Condensed {
  const toks = stripCites(sentence).split(/\s+/).filter(Boolean)
  const lems = new Set(targets.map((x) => lemmatize(x.toLowerCase())))
  const fs = new Set(forms.map((x) => x.toLowerCase()))
  const hits = toks.map((t) => {
    const c = core(t).toLowerCase()
    return !!c && (fs.has(c) || lems.has(lemmatize(c)))
  })
  const first = hits.indexOf(true)
  const last = hits.lastIndexOf(true)
  let lo = 0
  let hi = toks.length
  if (toks.length > max) {
    const mid = first < 0 ? 0 : first
    const end = first < 0 ? max - around : Math.min(last, first + max) + 1
    lo = Math.max(0, mid - around)
    hi = Math.min(toks.length, end + around)
  }
  const parts: Condensed['parts'] = []
  for (let i = lo; i < hi; i++) {
    const t = toks[i] + (i < hi - 1 ? ' ' : '')
    if (!hits[i]) {
      const prev = parts[parts.length - 1]
      if (prev && !prev.hit) prev.t += t
      else parts.push({ t })
      continue
    }
    const c = core(toks[i])
    const at = toks[i].indexOf(c)
    const before = toks[i].slice(0, at)
    const after = toks[i].slice(at + c.length) + (i < hi - 1 ? ' ' : '')
    if (before) parts.push({ t: before })
    parts.push({ t: c, hit: true })
    if (after) parts.push({ t: after })
  }
  return { parts, cutL: lo > 0, cutR: hi < toks.length }
}
