import type { AppState } from '../core/types'
import { isKnownLemma, lemmatize } from '../lang/lemmatize'
import { FUNC_SET, LEX } from '../lang/lexicon'
import { piecesOfLemma } from '../learn/pieces'
import { COMMON, EXACT, LIB, type Decomp, type Morpheme, type MorphType, type Part } from './data'
import { dictPeek, firstSense, primaryPos, sensesOf } from '../lang/lexdict'
import { sensesOfWord } from '../lang/senses'
import { classOf, etymOf, indexWords, localSeg, type Etym, type WordCls } from './local'

export interface FamilyItem extends Decomp {
  w: string
  src?: string
  ext?: boolean
}

export interface SourceState {
  lib: Morpheme[]
  decomp: Record<string, Decomp>
  family: Record<string, FamilyItem[]>
  vx: Record<string, string[]>
  ety: Record<string, Etym>
}

export interface MorphCtx {
  docId?: string
  doc: string
  pid?: string | null
  wi?: number | null
  s: string
}

export interface MorphWord {
  parts: Part[]
  layer: 'exact' | 'basic' | 'ai'
  tags: Record<string, string>
  ctx: MorphCtx[]
  at: string
}

export interface MorphState {
  words: Record<string, MorphWord>
  src: SourceState
}

export const emptyMorph = (): MorphState => ({ words: {}, src: { lib: [], decomp: {}, family: {}, vx: {}, ety: {} } })

const clone = <T,>(x: T): T => structuredClone(x)

const splitPart = (p: Part): Part => {
  if (p[1] === 'able' && p[0] === 'ible') return ['ible', 'ible']
  if (p[1] === 'ence' && (p[0] === 'ance' || p[0] === 'ancy')) return [p[0], 'ance']
  if (p[1] === 'er' && p[0] === 'or') return ['or', 'or']
  return p
}

const splitParts = (ps: Part[]): Part[] => ps.map(splitPart)

const SPLIT_INDEX: Record<string, [string, (w: string) => boolean]> = {
  able: ['able', (w) => !/(?:ible|ibly)$/.test(w)],
  ible: ['able', (w) => /(?:ible|ibly)$/.test(w)],
  ence: ['ence', (w) => !/(?:ance|ancy)$/.test(w)],
  ance: ['ence', (w) => /(?:ance|ancy)$/.test(w)],
  er: ['er', (w) => !/(?:or|ors)$/.test(w)],
  or: ['er', (w) => /(?:or|ors)$/.test(w)],
}

export class MorphEngine {
  ms: MorphState
  private lib: Morpheme[]
  private data: AppState

  constructor(state: MorphState | null | undefined, data: AppState) {
    this.ms = clone(state && state.words ? { words: state.words, src: { ...emptyMorph().src, ...(state.src || {}) } } : emptyMorph())
    Object.values(this.ms.words).forEach((x) => {
      if (x.parts) x.parts = splitParts(x.parts)
    })
    this.data = data
    this.lib = clone(LIB)
    const used = new Set(Object.entries(this.ms.words).flatMap(([w, x]) => [...x.parts, ...(this.ms.src.decomp[w]?.parts || [])].map((p) => p[1])))
    this.ms.src.lib = this.ms.src.lib.filter((m) => used.has(m.id))
    this.ms.src.family = Object.fromEntries(Object.entries(this.ms.src.family).map(([k, v]) => [k, v.filter((f) => f.src !== 'ai')]).filter(([, v]) => v.length))
    Object.entries(this.ms.src.vx).forEach(([id, vs]) => {
      const m = this.lib.find((x) => x.id === id)
      if (m) vs.forEach((v) => !m.vars.includes(v) && m.vars.push(v))
    })
  }

  get U() {
    return this.ms.src
  }

  private addVar(m: Morpheme, v: string) {
    if (!v || m.vars.includes(v)) return
    m.vars.push(v)
    if (!m.ai) (this.U.vx[m.id] = this.U.vx[m.id] || []).push(v)
  }

  morphemes = (): Morpheme[] => [...this.lib, ...this.U.lib]

  relatedMorphemes(mid: string): Morpheme[] {
    const m = this.morpheme(mid)
    if (!m) return []
    const ids = new Set([...(m.rel || []), ...this.morphemes().filter((o) => o.rel?.includes(mid)).map((o) => o.id)])
    ids.delete(mid)
    return [...ids].map((id) => this.morpheme(id)).filter((x): x is Morpheme => !!x)
  }

  bases(): Morpheme[] {
    const seen = new Set<string>()
    const out: Morpheme[] = []
    for (const w of Object.values(this.ms.words)) {
      for (const p of w.parts || []) {
        if (p[1] !== 'base') continue
        const baseWord = p[2] || p[0]
        if (!baseWord || seen.has(baseWord)) continue
        seen.add(baseWord)
        out.push({ id: `base:${baseWord}`, t: 'base', main: baseWord, zh: this.lookupWord(baseWord)?.z || '', vars: [baseWord] })
      }
    }
    return out
  }

  morpheme = (id: string | null | undefined): Morpheme | null => {
    if (!id) return null
    if (id.startsWith('base:')) {
      const baseWord = id.slice(5)
      return baseWord ? { id, t: 'base', main: baseWord, zh: this.lookupWord(baseWord)?.z || '', vars: [baseWord] } : null
    }
    return this.morphemes().find((m) => m.id === id) || null
  }

  decomposition(w: string): (Decomp & { layer: 'exact' | 'ai' | 'basic' }) | null {
    if (EXACT[w]) return { ...EXACT[w], layer: 'exact' }
    if (this.U.decomp[w]) return { ...this.U.decomp[w], parts: splitParts(this.U.decomp[w].parts), layer: 'ai' }
    const f = Object.values(this.U.family)
      .flat()
      .find((x) => x.w === w)
    if (f) return { ...f, parts: splitParts(f.parts), layer: 'ai' }
    const l = localSeg(w)
    if (!l) return null
    const z = firstSense(sensesOf(dictPeek(w))[0]?.text || '')
    return { z, p: primaryPos(dictPeek(w)) || '', parts: splitParts(l), layer: 'basic' }
  }

  family(mid: string): FamilyItem[] {
    const base = mid.startsWith('base:') ? mid.slice(5) : null
    const hasPart = (parts: Part[]) => (base ? parts.some((p) => p[1] === 'base' && (p[2] || p[0]) === base) : parts.some((p) => p[1] === mid))
    const out = new Map<string, FamilyItem>()
    Object.entries(EXACT).forEach(([w, e]) => {
      if (hasPart(e.parts)) out.set(w, { w, ...e, src: 'seed' })
    })
    Object.entries(this.U.decomp).forEach(([w, e]) => {
      const parts = splitParts(e.parts)
      if (!out.has(w) && hasPart(parts)) out.set(w, { w, ...e, parts, src: 'ai' })
    })
    ;(this.U.family[mid] || []).forEach((x) => !out.has(x.w) && out.set(x.w, { ...x, parts: splitParts(x.parts) }))
    if (!base) {
      const sp = SPLIT_INDEX[mid]
      const rows = sp
        ? sp[0] === mid
          ? indexWords(mid).filter(([w]) => sp[1](w))
          : [...indexWords(mid), ...indexWords(sp[0]).filter(([w]) => sp[1](w))]
        : indexWords(mid)
      rows.forEach(([w, z]) => !out.has(w) && out.set(w, { w, z, p: '', parts: splitParts(localSeg(w) || []), src: 'local' }))
    }
    return [...out.values()].map((f) => ({ ...f, ext: this.cls(f.w, f.parts) === 'x' }))
  }

  etym = (w: string): Etym | undefined => this.U.ety[w] || etymOf(w)
  cls = (w: string, parts?: Part[] | null): WordCls => classOf(w, parts, (id) => this.morpheme(id) || undefined, this.U.ety[w])

  lookupWord(w: string): { z: string; p: string; parts?: Part[] } | null {
    const d = this.decomposition(w)
    if (d) return { z: d.z, p: d.p, parts: d.parts }
    if (LEX[w]) return { z: LEX[w][3], p: LEX[w][1] }
    const id = piecesOfLemma(this.data, w)[0]
    if (id) return { z: this.data.pieces[id]?.tile || '', p: this.data.pieces[id]?.pos || '' }
    const sr = sensesOfWord(w)[0]
    if (sr) return { z: sr[3], p: sr[1] }
    const de = dictPeek(w)
    if (de) {
      const ss = sensesOf(de)
      const verbFirst = ss.find((x) => x.pos === 'v.') || ss[0]
      return { z: firstSense(verbFirst?.text || ''), p: verbFirst?.pos || primaryPos(de) || '' }
    }
    return null
  }

  addMorpheme({ t, m, s, zh }: { t: Exclude<MorphType, 'base'>; m: string; s: string; zh?: string }) {
    const key = String(m || s)
      .toLowerCase()
      .replace(/[^a-z]/g, '')
    const hit = this.morphemes().find((x) => x.t === t && (x.vars.includes(key) || x.vars.includes(s)))
    if (hit) {
      this.addVar(hit, s)
      return hit.id
    }
    const id = `u_${t}_${key}`
    const main = t === 'pre' ? `${key}-` : t === 'suf' ? `-${key}` : key
    this.U.lib.push({ id, t, main, zh: zh || '', vars: [...new Set([key, s])], ai: true })
    return id
  }

  removeMorpheme(id: string) {
    this.U.lib = this.U.lib.filter((m) => m.id !== id)
    Object.values(this.ms.words).forEach((x) =>
      x.parts.forEach((p, i) => {
        if (p[1] === id) x.parts[i] = [p[0], 'base', p[0]]
      }),
    )
  }

  mergeMorpheme(from: string, to: string) {
    const a = this.morpheme(from)
    const b = this.morpheme(to)
    if (!a || !b || !a.ai) return
    a.vars.forEach((v) => this.addVar(b, v))
    this.U.lib = this.U.lib.filter((m) => m.id !== from)
    const swap = (parts: Part[]) => parts.forEach((p) => p[1] === from && (p[1] = to))
    Object.values(this.U.decomp).forEach((e) => swap(e.parts))
    Object.values(this.U.family)
      .flat()
      .forEach((e) => swap(e.parts))
    if (this.U.family[from]) {
      this.U.family[to] = [...(this.U.family[to] || []), ...this.U.family[from]]
      delete this.U.family[from]
    }
    Object.values(this.ms.words).forEach((x) => swap(x.parts))
  }

  isWord = (w: string) => w.length >= 3 && (isKnownLemma(w) || !!LEX[w] || !!EXACT[w] || COMMON.includes(w) || !!this.decomposition(w))

  varsByType = (t: MorphType) =>
    this.morphemes()
      .filter((m) => m.t === t)
      .flatMap((m) => m.vars.map((v) => ({ v, id: m.id })))
      .sort((a, b) => b.v.length - a.v.length)

  partsOf = (w: string) => this.ms.words[w]?.parts || null
  myWords = () => Object.keys(this.ms.words).filter((w) => this.ms.words[w].parts)
  relatedWords = (mid: string) => {
    if (mid.startsWith('base:')) {
      const base = mid.slice(5)
      return this.myWords().filter((w) => (this.partsOf(w) || []).some((p) => p[1] === 'base' && (p[2] || p[0]) === base))
    }
    return this.myWords().filter((w) => (this.partsOf(w) || []).some((p) => p[1] === mid))
  }
  rootOf = (parts: Part[]) => {
    const root = parts.find((p) => this.morpheme(p[1])?.t === 'root')
    if (root) return root[1]
    const base = parts.find((p) => p[1] === 'base')
    if (base) return `base:${base[2] || base[0]}`
    return (parts.find((p) => this.morpheme(p[1])) || [])[1] || null
  }

  tagsFor(parts: Part[], self: string) {
    const tags: Record<string, string> = {}
    parts.forEach(([, id]) => {
      if (!this.morpheme(id) || tags[id]) return
      const n = this.relatedWords(id).filter((x) => x !== self).length
      tags[id] = n ? `已收集 · 第 ${n + 1} 个关联词` : '新解锁'
    })
    return tags
  }

  suffixSplit(w: string): Part[] | null {
    for (const { v, id } of this.varsByType('suf')) {
      if (!w.endsWith(v) || w.length - v.length < 3) continue
      const stem = w.slice(0, -v.length)
      const cands = [stem, `${stem}e`, stem.replace(/i$/, 'y'), /(.)\1$/.test(stem) ? stem.slice(0, -1) : null].filter(Boolean) as string[]
      const base = cands.find(this.isWord)
      if (base) {
        const e = EXACT[base]
        return [...(e && stem === base ? e.parts : [[stem, 'base', base] as Part]), [v, id]]
      }
    }
    return null
  }

  wordSplit(w: string): Part[] | null {
    for (const { v, id } of this.varsByType('pre')) {
      if (!w.startsWith(v)) continue
      const rest = w.slice(v.length)
      if (rest.length < 3) continue
      if (this.isWord(rest)) return [[v, id], ...(this.suffixSplit(rest) || [[rest, 'base', rest] as Part])]
      const sp = this.suffixSplit(rest)
      if (sp) return [[v, id], ...sp]
    }
    return this.suffixSplit(w)
  }

  rootSplit(w: string): Part[] | null {
    const pres = [{ v: '', id: '' }, ...this.varsByType('pre')]
    const sufs = this.varsByType('suf')
    const roots = this.varsByType('root').filter((x) => x.v.length >= 3)
    const tails: { v: string; id: string }[][] = [[]]
    sufs.forEach((a) => {
      if (w.endsWith(a.v)) {
        tails.push([a])
        sufs.forEach((b) => w.endsWith(b.v + a.v) && tails.push([b, a]))
      }
    })
    let best: Part[] | null = null
    for (const p of pres) {
      if (!w.startsWith(p.v)) continue
      for (const t of tails) {
        if (!p.v && !t.length) continue
        const tl = t.reduce((n, x) => n + x.v.length, 0)
        const mid = w.slice(p.v.length, w.length - tl)
        const r = roots.find((x) => x.v === mid)
        if (!r) continue
        const parts: Part[] = [...(p.v ? [[p.v, p.id] as Part] : []), [mid, r.id], ...t.map((x) => [x.v, x.id] as Part)]
        if (!best || parts.length < best.length) best = parts
      }
    }
    return best
  }

  morphLemma(w0: string) {
    const l = lemmatize(w0)
    if (l !== w0) return l
    const c: string[] = []
    if (/ied$|ies$/.test(w0)) c.push(`${w0.slice(0, -3)}y`)
    if (/ed$/.test(w0)) {
      const b = w0.slice(0, -2)
      c.push(b, `${b}e`, /(.)\1$/.test(b) ? b.slice(0, -1) : '')
    }
    if (/ing$/.test(w0)) {
      const b = w0.slice(0, -3)
      c.push(b, `${b}e`, /(.)\1$/.test(b) ? b.slice(0, -1) : '')
    }
    if (/es$/.test(w0)) c.push(w0.slice(0, -2))
    if (/[^s]s$/.test(w0)) c.push(w0.slice(0, -1))
    return c.find((x) => x && x.length >= 3 && (this.decomposition(x) || this.isWord(x))) || w0
  }

  analyze(raw: string): Analysis {
    const w0 = norm(raw)
    if (!w0) return { kind: 'none' }
    if (/\s|…/.test(w0) || this.data.pieces[w0]?.pos === 'phrase') return { kind: 'refuse', note: '短语按整体记忆，不拆词根' }
    if (FUNC_SET.has(w0)) return { kind: 'refuse', note: '虚词不拆' }
    const w = EXACT[w0] || this.etym(w0) || this.decomposition(w0) ? w0 : this.morphLemma(w0)
    const ety = this.etym(w)
    if (ety?.[0] === 'o') return { kind: 'opaque', word: w, ety: ety[1] || '' }
    if (w.length <= 4) return { kind: 'refuse', word: w, note: '词太短，不拆词根' }
    const d = this.decomposition(w)
    if (d) return { kind: 'ok', word: w, layer: d.layer, parts: d.parts }
    const b = this.wordSplit(w) || this.rootSplit(w)
    if (b) return { kind: 'ok', word: w, layer: 'basic', parts: b }
    return { kind: 'unknown', word: w, note: '本地没有可靠拆解' }
  }

  refreshBasic(): number {
    let n = 0
    for (const [w, x] of Object.entries(this.ms.words)) {
      if (x.layer !== 'basic') continue
      const a = this.analyze(w)
      if (a.kind !== 'ok' || a.word !== w || a.layer === 'ai' || JSON.stringify(a.parts) === JSON.stringify(x.parts)) continue
      this.ms.words[w] = { ...x, parts: a.parts, layer: a.layer, tags: this.tagsFor(a.parts, w) }
      n++
    }
    return n
  }

  validateParts(w: string, parts: unknown): { s: string; t: MorphType; m: string; zh: string }[] | null {
    if (!Array.isArray(parts) || !parts.length) return null
    const AI_TYPE: Record<string, MorphType> = { prefix: 'pre', root: 'root', suffix: 'suf', base: 'base' }
    const ps = parts.map((p: { s?: string; type?: string; m?: string; zh?: string }) => ({
      s: norm(p.s),
      t: AI_TYPE[norm(p.type)] || null,
      m: norm(p.m || p.s).replace(/[^a-z]/g, ''),
      zh: p.zh || '',
    }))
    if (ps.some((p) => !p.s || !p.t)) return null
    if (ps.map((p) => p.s).join('') !== w) return null
    if (!ps.some((p) => p.t === 'root' || p.t === 'base')) return null
    if (ps.some((p) => p.t === 'root' && p.s.length < 2)) return null
    return ps as { s: string; t: MorphType; m: string; zh: string }[]
  }

  toParts = (ps: { s: string; t: MorphType; m: string; zh: string }[]): Part[] =>
    ps.map((p) => (p.t === 'base' ? ([p.s, 'base', p.m || p.s] as Part) : ([p.s, this.addMorpheme({ t: p.t, m: p.m, s: p.s, zh: p.zh })] as Part)))

  applyAISplit(w: string, r: { pos?: string; zh?: string; parts?: unknown; drift?: boolean; ety?: string; ety_en?: string }, day: string): 'ok' | 'opaque' | 'bad' {
    const ety = typeof r.ety === 'string' && r.ety.trim() ? r.ety.trim() : ''
    if (Array.isArray(r.parts) && !r.parts.length && ety) {
      this.U.ety[w] = ['o', ety, r.ety_en || '']
      return 'opaque'
    }
    const ps = this.validateParts(w, r.parts)
    if (!ps) return 'bad'
    const parts = this.toParts(ps)
    this.U.decomp[w] = { z: r.zh || '', p: r.pos || '', parts }
    if (ety) this.U.ety[w] = [r.drift ? 'x' : 't', ety, r.ety_en || '']
    this.ms.words[w] = { ...(this.ms.words[w] || { ctx: [], at: day }), parts, layer: 'ai', tags: this.tagsFor(parts, w) }
    return 'ok'
  }

  rulesOf = (parts: Part[]) =>
    parts
      .map(([s, id]) => {
        const r = this.morpheme(id)?.rules?.[s]
        return r ? { s, r } : null
      })
      .filter((x): x is { s: string; r: string } => !!x)

  snapshot(): MorphState {
    return clone(this.ms)
  }
}

export type Analysis =
  | { kind: 'none' }
  | { kind: 'refuse'; word?: string; note: string }
  | { kind: 'opaque'; word: string; ety: string }
  | { kind: 'unknown'; word: string; note: string }
  | { kind: 'ok'; word: string; layer: 'exact' | 'basic' | 'ai'; parts: Part[] }


export const norm = (w: unknown) =>
  String(w || '')
    .toLowerCase()
    .trim()

export function seedMorph(day: string, ctx: MorphCtx): MorphState {
  const st = emptyMorph()
  st.words.patience = { parts: EXACT.patience.parts, layer: 'exact', tags: { pati: '新解锁', ence: '新解锁' }, ctx: [ctx], at: day }
  return st
}
