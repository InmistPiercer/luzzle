import { shardStore } from '../core/shards'
import type { Entry, SenseRow } from '../core/types'
import UKUS from './ukus.json'

export type { SenseRow }
export type PhraseRow = [head: string, headSid: string, zhShort: string, zhDef: string, enShort: string, enDef: string, ex1: string]

const sense = shardStore<SenseRow[]>('sense')
const phrase = shardStore<PhraseRow>('phrase')
const infl = shardStore<string>('infl')
const def = shardStore<[string, string][]>('def')
let local: Record<string, SenseRow[]> = {}

export const setLocalSenses = (m: Record<string, SenseRow[]> | undefined) => {
  local = m || {}
}

export const setSenseData = (s: Record<string, SenseRow[]>, inf: Record<string, string> = {}, ph: Record<string, PhraseRow> = {}) => {
  sense.set(s)
  infl.set(inf)
  phrase.set(ph)
}

export const ukToUs = (w: string): string | undefined => (UKUS as Record<string, string>)[w]

export const ensureSenses = (w: string) => {
  const k = w.toLowerCase()
  return Promise.all([sense.ensure(k), infl.ensure(k), def.ensure(k), phrase.ensure(k)])
}

export const sensesOfWord = (w: string): SenseRow[] => {
  const k = w.toLowerCase()
  return sense.get(k) || local[k] || []
}

export const loadedSenses = () => sense.entries()

export const senseLoaded = (w: string) => sense.loaded(w.toLowerCase())

export const senseById = (sid: string | undefined): SenseRow | undefined => {
  if (!sid) return undefined
  return sensesOfWord(sid.slice(0, sid.lastIndexOf('#'))).find((r) => r[0] === sid)
}

export const ensurePhrases = (w: string) => phrase.ensure(w.toLowerCase())
export const loadedPhrases = () => phrase.entries()
export const phraseRow = (p: string): PhraseRow | undefined => phrase.get(p.toLowerCase())
export const inflLemma = (form: string): string | undefined => infl.get(form)
export const dictDefs = (w: string): [string, string][] => def.get(w.toLowerCase()) || []

export const senseLine = (r: SenseRow, lang: 'zh' | 'en') => `${r[1]} ${lang === 'en' ? r[5] : r[3]}`

export const plainExample = (s: string) => s.replace(/\[\[|\]\]/g, '')
export const exampleAnswer = (s: string) => s.match(/\[\[([^\]]+)\]\]/)?.[1] || ''

const ZH = /[一-鿿]/g
const overlap = (a: string, b: string) => {
  const A = new Set(a.match(ZH) || [])
  return (b.match(ZH) || []).filter((c) => A.has(c)).length
}

export function matchSense(e: Pick<Entry, 'lemma' | 'pos' | 'gloss' | 'tile' | 'ai'>, rows = sensesOfWord(e.lemma)): SenseRow | undefined {
  const text = [e.gloss, e.ai?.zh, e.tile].filter(Boolean).join('；')
  if (!text) return undefined
  let best: SenseRow | undefined
  let score = 0
  for (const r of rows) {
    const s = overlap(text, `${r[3]}${r[4]}`) * 2 + (r[1] === e.pos ? 1 : 0)
    if (s > score && overlap(text, `${r[3]}${r[4]}`) > 0) {
      best = r
      score = s
    }
  }
  return best
}

export const defaultSense = (lemma: string, pos?: string): SenseRow | undefined => {
  const rows = sensesOfWord(lemma)
  return rows.find((r) => r[1] === pos) || rows[0]
}

export const withSense = <T extends Entry>(e: T, r: SenseRow): T => ({
  ...e,
  sid: r[0],
  gloss: r[3],
  tile: r[3],
  en: r[6],
  ens: r[5],
  pos: e.pos === 'phrase' ? e.pos : r[1],
  senses: sensesOfWord(e.lemma).map((x) => senseLine(x, 'zh')),
  mean: undefined,
  conf: undefined,
  alt: undefined,
})

export const SENSE_RULES = `You are building vocabulary data for Chinese adult learners who read English news, books and papers. For the given low-frequency English lemma, list the senses a reader needs to tell apart. Rules: usually 1 sense, at most 3; merge near-synonyms; idioms and phrasal verbs are not senses; skip proper-noun, obsolete and vulgar senses. Fields per sense: pos (one of n. v. adj. adv. func.); core (1 if a reader is likely to meet it, else 0; at least one 1); zh_short (1-4 Chinese characters); zh_def (Chinese definition, at most 20 characters, no English); en_short (1-3 lowercase English words, at most 16 characters, never the word itself or its forms); en_def (plain English definition, at most 15 words, never the word itself or its forms); ex1 (an original English sentence of 6-25 words using this sense, the target word wrapped as [[actual form]], or "" if unsure).`

const ZH_ONLY = /^[一-鿿；]{1,6}$/

export function parseSenseRows(w: string, raw: unknown): SenseRow[] {
  const list = Array.isArray((raw as { senses?: unknown })?.senses) ? ((raw as { senses: unknown[] }).senses as Record<string, unknown>[]) : []
  const stem = w.slice(0, Math.max(4, w.length - 3))
  const ok = list.filter((x) => {
    const es = String(x.en_short || '')
    const ed = String(x.en_def || '')
    return ['n.', 'v.', 'adj.', 'adv.', 'func.'].includes(String(x.pos)) && ZH_ONLY.test(String(x.zh_short || '')) && !!x.zh_def && !!es && es.length <= 16 && !!ed && !`${es} ${ed}`.toLowerCase().includes(stem)
  })
  const rows = ok.slice(0, 3).map((x, i): SenseRow => {
    const ex = String(x.ex1 || '')
    return [`${w}#${i + 1}`, String(x.pos), x.core === 0 || x.core === '0' ? 0 : 1, String(x.zh_short), String(x.zh_def), String(x.en_short), String(x.en_def), /\[\[[^\]]+\]\]/.test(ex) ? ex : '', '']
  })
  if (rows.length && !rows.some((r) => r[2] === 1)) rows[0][2] = 1
  return rows
}
