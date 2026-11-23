import { shardStore, useDataSeq } from '../core/shards'
import type { Morpheme, Part } from './data'

export type IndexRow = [string, string]
export type Group = [number, number, string]
export type EtymCls = 't' | 'x' | 'o'
export type Etym = [EtymCls, string?, string?]
export type WordCls = 'T' | 'x' | 'o'
type Row = Part[] | [Part[], Group]

const seg = shardStore<Row>('morph')
const grouped = (r: Row): r is [Part[], Group] => Array.isArray(r[0]?.[0])
let index: Record<string, IndexRow[]> | null = null
let etym: Record<string, Etym> = {}
let indexLoad: Promise<void> | null = null

export const useMorphData = useDataSeq
export const ensureMorph = seg.ensure
export const localSeg = (w: string): Part[] | null => {
  const r = seg.get(w)
  return r ? (grouped(r) ? r[0] : r) : null
}

export const localGroup = (w: string, parts: Part[]): Group | null => {
  const r = seg.get(w)
  if (!r || !grouped(r)) return null
  return r[0].map((p) => p[0]).join('|') === parts.map((p) => p[0]).join('|') ? r[1] : null
}

const load = (name: string) => fetch(`${import.meta.env.BASE_URL}morph/${name}.json`).then((r) => (r.ok ? r.json() : {}))

export function ensureMorphIndex(): Promise<void> {
  if (index) return Promise.resolve()
  if (!indexLoad)
    indexLoad = Promise.all([load('index'), load('etym')])
      .then(([i, e]) => {
        index = i as Record<string, IndexRow[]>
        etym = e as Record<string, Etym>
        useDataSeq.setState((s) => ({ seq: s.seq + 1 }))
      })
      .catch(() => {
        indexLoad = null
      })
  return indexLoad
}

export const indexWords = (mid: string): IndexRow[] => index?.[mid] || []
export const etymOf = (w: string): Etym | undefined => etym[w]

const isHist = (m: Morpheme | undefined, s: string) => !!m?.hist?.some((h) => s === h || s === h.slice(0, -1) || s.startsWith(h))

export function classOf(w: string, parts: Part[] | null | undefined, morpheme: (id: string) => Morpheme | undefined, own?: Etym): WordCls {
  const c = (own || etymOf(w))?.[0]
  if (c === 'o' || c === 'x') return c
  return parts?.some((p) => p[1] !== 'base' && isHist(morpheme(p[1]), p[0])) ? 'x' : 'T'
}

export const setMorphData = (s: Record<string, Row>, idx: Record<string, IndexRow[]>, ety: Record<string, Etym> = {}) => {
  seg.set(s)
  index = idx
  etym = ety
}
