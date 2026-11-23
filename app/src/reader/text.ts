import type { AppState, Entry, Para, PosTag } from '../core/types'
import { occurrenceAt, piecesOfLemma } from '../learn/pieces'
import { lemmatize, posGuess } from '../lang/lemmatize'

export type Tok = { w: string; sep?: undefined; cite?: undefined } | { sep: string; w?: undefined; cite?: boolean }

function tokenizePlain(t: string, out: Tok[]) {
  let last = 0
  t.replace(/[A-Za-z][A-Za-z’'-]*/g, (m, off: number) => {
    if (off > last) out.push({ sep: t.slice(last, off) })
    out.push({ w: m })
    last = off + m.length
    return m
  })
  if (last < t.length) out.push({ sep: t.slice(last) })
}

export const stripCites = (t = '') => t.replace(/\s*⟦[^⟧]*⟧/g, '').replace(/\s+([,.;:!?])/g, '$1')

const ABBR = /(?:\b(?:e\.g|i\.e|et al|etc|vs|cf|approx|Fig|Figs|Eq|Eqs|No|Nos|Vol|pp|Dr|Mr|Mrs|Ms|Prof|St|Inc|Ltd|Co|Jr|Sr)|\b[A-Z])\.$/

export function splitSentences(t: string): string[] {
  const out: string[] = []
  for (const part of t.split(/(?<=[.?!;])\s+/)) {
    if (out.length && ABBR.test(out[out.length - 1])) out[out.length - 1] += ` ${part}`
    else out.push(part)
  }
  return out
}

export function tokenize(t: string): Tok[] {
  const out: Tok[] = []
  let last = 0
  t.replace(/⟦([^⟧]*)⟧/g, (m, inner: string, off: number) => {
    if (off > last) tokenizePlain(t.slice(last, off), out)
    out.push({ sep: inner, cite: true })
    last = off + m.length
    return m
  })
  if (last < t.length) tokenizePlain(t.slice(last), out)
  return out
}

export function alignRaw(rawToks: Tok[], normWords: string[]): number[] {
  const map: number[] = []
  let j = 0
  const rw = rawToks.filter((x) => x.w).map((x) => x.w as string)
  for (let i = 0; i < rw.length; i++) {
    const a = rw[i]
    if (/-$/.test(a) && rw[i + 1] && (a.slice(0, -1) + rw[i + 1]).toLowerCase() === (normWords[j] || '').toLowerCase()) {
      map.push(j, j)
      i++
      j++
    } else {
      map.push(j)
      j++
    }
  }
  return map
}

export const posOf = (data: AppState, id: string): string => data.pieces[id]?.pos || 'v.'

const POSS_WORD = /^(?:my|your|his|her|its|our|their|one's|someone's)$/i
const REFL_WORD = /^(?:myself|yourself|himself|herself|itself|ourselves|yourselves|themselves|oneself)$/i

export function phraseGaps(lemma: string, fallbackMembers?: string[]): { raw: string[]; lem: string[]; gaps: number[] } {
  const raw: string[] = []
  const gaps: number[] = []
  let gap = false
  for (const part of lemma.toLowerCase().replace(/’/g, "'").trim().split(/\s+/)) {
    if (/^(?:…|\.{2,})$/.test(part)) {
      gap = true
      continue
    }
    const w = part.replace(/[^a-z0-9'-]/g, '')
    if (!w) continue
    gaps.push(raw.length === 0 ? 0 : gap ? 4 : 0)
    raw.push(w)
    gap = false
  }
  if (!raw.length && fallbackMembers?.length) {
    return { raw: fallbackMembers.map((x) => x.toLowerCase().replace(/’/g, "'")), lem: fallbackMembers.map((x) => lemmatize(x.replace(/’/g, "'"))), gaps: fallbackMembers.map((_, i) => (i ? 3 : 0)) }
  }
  return { raw, lem: raw.map(lemmatize), gaps }
}

export function spansFor(entries: [string, Entry][], normWords: string[], accept?: (id: string, hit: number[]) => boolean, strictGap = false): Record<number, string> {
  const lw = normWords.map((w) => w.toLowerCase().replace(/’/g, "'"))
  const lem = lw.map(lemmatize)
  const own: Record<number, string> = {}
  for (const [id, e] of entries) {
    const spec = phraseGaps(e.lemma || '', e.members)
    const n = spec.raw.length
    if (!n) continue
    const fits = (wi: number, m: number) => {
      const r = spec.raw[m]
      const w = lw[wi]
      if (r === "one's") return POSS_WORD.test(w) || w.endsWith("'s") || w.endsWith("s'")
      if (r === 'oneself') return REFL_WORD.test(w)
      return strictGap && r !== spec.lem[m] ? w === r : w === r || lem[wi] === spec.lem[m]
    }
    for (let i = 0; i < lem.length; i++) {
      if (!fits(i, 0)) continue
      const hit = [i]
      let p = i
      for (let m = 1; m < n; m++) {
        const maxJump = strictGap ? spec.gaps[m] + 1 : Math.max(4, spec.gaps[m] + 1)
        let q = -1
        for (let k = p + 1; k <= Math.min(lem.length - 1, p + maxJump); k++)
          if (fits(k, m)) {
            q = k
            break
          }
        if (q < 0) break
        hit.push(q)
        p = q
      }
      if (hit.length === n && (!accept || accept(id, hit))) hit.forEach((x) => (own[x] = own[x] || id))
    }
  }
  return own
}

export const phraseSpans = (data: AppState, normWords: string[], pid: string | undefined, sentences: string[]) =>
  spansFor(
    Object.keys(data.learn)
      .filter((id) => data.pieces[id]?.pos === 'phrase' && data.pieces[id]?.members)
      .map((id) => [id, data.pieces[id]]),
    normWords,
    (id, hit) => hit.every((wi) => sentences[wi] === sentences[hit[0]]) &&
      hit.some((wi) => data.learn[id].occ.some((o) => occurrenceAt(o, pid, wi, sentences[wi] || ''))),
  )

export function wordOwner(data: AppState, pid: string | undefined, w: string, wi: number, s: string): string | null {
  const ids = piecesOfLemma(data, lemmatize(w))
  return ids.find((id) => data.learn[id].occ.some((o) => occurrenceAt(o, pid, wi, s))) || null
}

export const sentencesByWord = (text: string) =>
  splitSentences(stripCites(text)).flatMap((s) => tokenize(s).filter((token) => token.w).map(() => s))

export interface WordSpan {
  kind: 'w'
  text: string
  wi: number
  lw: string
  pc: string | null
  pos: string
  stage: number
}

export interface SepSpan {
  kind: 'sep'
  text: string
  cite?: boolean
}

export interface AnnGroup {
  kind: 'ann'
  hl: string
  items: (WordSpan | SepSpan)[]
}

export type ParaNode = WordSpan | SepSpan | AnnGroup

export function paraNodes(data: AppState, p: Para, rebuilt: boolean): ParaNode[] {
  const norm = tokenize(p.t || '')
  const normWords = norm.filter((x) => x.w).map((x) => x.w as string)
  const showRaw = !rebuilt && !!p.raw
  const toks = showRaw ? tokenize(p.raw as string) : norm
  const wiMap = showRaw ? alignRaw(toks, normWords) : normWords.map((_, i) => i)
  const sentences = sentencesByWord(p.t || '')
  const own = phraseSpans(data, normWords, p.id, sentences)
  const sig = (wi: number) => data.marks[`${p.id}:${wi}`]?.hl || ''
  const out: ParaNode[] = []
  let group: AnnGroup | null = null
  const push = (n: WordSpan | SepSpan) => (group ? group.items.push(n) : out.push(n))
  let k = 0
  toks.forEach((tk, i) => {
    if (tk.w) {
      const wi = wiMap[k++]
      const word = normWords[wi] || tk.w
      const s = sig(wi)
      if (s !== (group?.hl || '')) {
        group = s ? { kind: 'ann', hl: s, items: [] } : null
        if (group) out.push(group)
      }
      const lw = word.toLowerCase()
      const pc = own[wi] || wordOwner(data, p.id, lw, wi, sentences[wi] || '')
      const cands = pc ? [] : piecesOfLemma(data, lemmatize(lw))
      const pos: PosTag | string = pc ? posOf(data, pc) : cands.length ? posOf(data, cands[0]) : posGuess(lw)
      const stage = pc ? data.learn[pc].stage : cands.length ? Math.max(...cands.map((id) => data.learn[id]?.stage || 0)) : 0
      push({ kind: 'w', text: tk.w, wi, lw, pc, pos, stage })
    } else {
      const next = toks.slice(i + 1).findIndex((x) => x.w)
      const nextSig = next >= 0 ? sig(wiMap[k]) : ''
      if (group && group.hl !== nextSig) group = null
      push({ kind: 'sep', text: tk.sep as string, cite: tk.cite })
    }
  })
  return out
}
