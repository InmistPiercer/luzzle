import type { AppState, Entry, LearnState, Piece } from '../core/types'
import type { Day } from '../core/date'
import { examplesOf, tokenFor } from '../lang/examples'
import { lemmatize } from '../lang/lemmatize'
import { dictEntries, dictVersion, firstSense as short, sensesOf } from '../lang/lexdict'
import { EN_GLOSS, LEX } from '../lang/lexicon'
import { dictDefs, exampleAnswer, loadedSenses, phraseRow, plainExample, senseById, senseLine } from '../lang/senses'
import { stripCites } from '../reader/text'
import { escRe } from '../core/text'
import { isPhraseId, lemmaOf, pieceGlossFor, sensesOfPiece } from '../learn/pieces'
import { fallbackPhrases, isLinkedPhrase } from '../learn/phrase'

export const hash = (s: string) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

export const shuffle = <T,>(arr: T[], seed: string) =>
  arr
    .map((x, i) => [x, hash(seed + String(x) + i)] as const)
    .sort((a, b) => a[1] - b[1])
    .map((x) => x[0])

const PLACEHOLDER = new Set(['新义', '短语'])

export const isZh = (s: string | undefined) => !!s && /[\u4e00-\u9fff]/.test(s) && !/[A-Za-z]/.test(s)

export const srcSentence = (d: AppState, id: string) => stripCites(d.learn[id]?.occ[0]?.s || d.pieces[id]?.s || '')

export interface Sentence {
  s: string
  fresh: boolean
  ans?: string[]
  form?: string
}

const dedupSentences = <T extends { s: string }>(items: T[]): T[] => {
  const seen = new Set<string>()
  return items.filter((x) => {
    const key = norm(x.s)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function freshSentence(d: AppState, id: string, seed: string, withEx = true): Sentence {
  const e = d.pieces[id]
  const first = srcSentence(d, id)
  const firstNorm = norm(first)
  if (!e) return { s: first, fresh: false }
  const lemma = e.lemma.toLowerCase()
  const phrase = isPhraseId(d, id)
  const originalForm = e.form || e.lemma
  const others = (d.learn[id]?.occ || []).flatMap((o) => {
    const s = stripCites(o.s)
    if (!s || norm(s) === firstNorm) return []
    const form = o.form || (phrase ? originalForm : tokenFor(s, lemma) || undefined)
    return [{ s, form, fresh: true }]
  })
  const alts = (e.alt || []).filter((a) => !a.k).flatMap((a) => {
    if (!a.s.includes('___')) return []
    const form = a.a?.[0] || originalForm
    const s = a.s.replace('___', form)
    return norm(s) !== firstNorm ? [{ s, form, ans: a.a, fresh: true }] : []
  })
  const exs = !withEx || isPhraseId(d, id) ? [] : examplesOf(lemma).filter((x) => norm(x) !== firstNorm).flatMap((x) => {
    const t = tokenFor(x, lemma)
    return t ? [{ s: x, fresh: false, form: t }] : []
  })
  const own = senseExamples(e).filter((x) => norm(x.s) !== firstNorm)
  const pool = dedupSentences(others.length ? others : own.length ? own : alts.length ? alts : exs)
  return pool.length ? pool[hash(seed) % pool.length] : { s: first, fresh: false }
}

const senseExamples = (e: Entry) =>
  [senseById(e.sid)?.[7], senseById(e.sid)?.[8]].filter((x): x is string => !!x?.trim()).map((x) => {
    const form = exampleAnswer(x)
    return { s: plainExample(x).trim(), form, ans: [form.toLowerCase()], fresh: true }
  })

export function meaningOf(e: Entry | undefined, lang: 'zh' | 'en' = 'zh'): string {
  if (!e) return ''
  if (lang === 'en') {
    const lm = (e.lemma || '').toLowerCase()
    const defHit = e.pos === 'phrase' ? phraseRow(lm)?.[5] || phraseRow(lm)?.[4] : dictDefs(lm).find((d) => d[0] === e.pos)?.[1] || dictDefs(lm)[0]?.[1]
    const en =
      (e.sid ? e.en : '') ||
      e.ai?.en ||
      e.en ||
      EN_GLOSS[e.lemma] ||
      EN_GLOSS[lm] ||
      defHit ||
      (e.gloss && /[A-Za-z]/.test(e.gloss) && !isZh(e.gloss) ? e.gloss : '')
    if (en) return en
  }
  if (e.gloss && isZh(short(e.gloss))) return e.gloss
  const cands = [e.ai?.zh, PLACEHOLDER.has(e.tile || '') ? '' : e.tile, ...(e.dict || [])].map((x) => short(x || ''))
  return cands.find(isZh) || ''
}

const POS_LEAD_RE = /^(?:(?:v|vt|vi|n|adj|adv|prep|conj|pron|det|aux|art|int|interj|num|a|ad)\.\s*(?:[&/,]\s*)?)+/i

export function wordDefOf(e: Entry | undefined, lang: 'zh' | 'en' = 'en'): string {
  if (!e) return ''
  const row = senseById(e.sid)
  if (lang === 'en') {
    const en = row?.[6] || (e.ai?.en && !/[\u4e00-\u9fff]/.test(e.ai.en) ? e.ai.en : '') || pieceGlossFor(e, 'en')
    return en.replace(POS_LEAD_RE, '').trim()
  }
  if (row?.[3]) return row[3]
  const zh = [e.gloss, e.ai?.zh, PLACEHOLDER.has(e.tile || '') ? '' : e.tile].find((x) => x && /[\u4e00-\u9fff]/.test(x))
  if (zh) return zh.replace(POS_LEAD_RE, '').trim()
  const dictFirst = short(e.dict?.[0] || '')
  if (dictFirst && /[\u4e00-\u9fff]/.test(dictFirst)) return dictFirst
  return pieceGlossFor(e, 'zh')
}

export const hasMeaning = (d: AppState, id: string) => {
  const e = d.pieces[id]
  return !!e && ((e.mean || []).some(isZh) || !!meaningOf(e, d.prefs.defLang || 'en'))
}

let dictPool: { pos: string; zh: string; w: string }[] | null = null
let poolVer = -1

function dictDistractors() {
  if (dictPool && poolVer === dictVersion()) return dictPool
  const out: { pos: string; zh: string; w: string }[] = []
  for (const e of dictEntries()) {
    if (!e.freq || e.freq > 12000 || !/^[a-z]+$/.test(e.word)) continue
    const s = sensesOf(e)[0]
    if (!s?.pos) continue
    const zh = short(s.text)
    if (isZh(zh) && zh.length <= 8) out.push({ pos: s.pos, zh, w: e.word })
  }
  dictPool = out
  poolVer = dictVersion()
  return out
}

function tableDistractors(pos: string, lemma: string, seed: string, lang: 'zh' | 'en') {
  const same = loadedSenses().flatMap(([w, rows]) => (w === lemma ? [] : rows.filter((r) => r[1] === pos && r[2] === 1).map((r) => ({ w, txt: lang === 'en' ? r[6] : r[3] }))))
  const out: { w: string; txt: string }[] = []
  const start = hash(seed) % Math.max(1, same.length)
  const step = Math.max(1, Math.floor(same.length / 12))
  for (let i = 0; i < same.length && out.length < 12; i += step) out.push(same[(start + i) % same.length])
  return out
}

export interface MeaningChoice {
  opts: string[]
  owner: Record<string, string>
}

const overlaps = (a: string, b: string) => {
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  return la === lb || la.includes(lb) || lb.includes(la)
}

export function meaningChoices(d: AppState, id: string, lang: 'zh' | 'en' = 'zh'): MeaningChoice {
  const e = d.pieces[id]
  if (lang === 'en') {
    const ans = meaningOf(e, 'en')
    if (ans && !isZh(ans)) {
      const pos = e.pos || 'v.'
      const owner: Record<string, string> = {}
      const picks: string[] = []
      const tryAddEn = (txt: string, w: string) => {
        if (picks.length >= 2 || !txt || isZh(txt) || overlaps(ans, txt) || picks.some((p) => overlaps(p, txt))) return
        picks.push(txt)
        if (w) owner[txt] = w
      }
      const lemma = e.lemma.toLowerCase()
      const others = shuffle(
        Object.keys(d.learn).filter((x) => x !== id && !isPhraseId(d, x) && d.pieces[x] && lemmaOf(d, x).toLowerCase() !== lemma),
        id,
      )
      for (const x of others.filter((x) => d.pieces[x].pos === pos)) tryAddEn(meaningOf(d.pieces[x], 'en'), lemmaOf(d, x))
      for (const x of tableDistractors(pos, lemma, id, 'en')) tryAddEn(x.txt, x.w)
      for (const v of shuffle(Object.values(LEX).filter((v) => v[1] === pos && v[0] !== e.lemma), id)) {
        if (EN_GLOSS[v[0]]) tryAddEn(EN_GLOSS[v[0]], v[0])
      }
      for (const x of others) tryAddEn(meaningOf(d.pieces[x], 'en'), lemmaOf(d, x))
      for (const [w, g] of shuffle(Object.entries(EN_GLOSS), id)) {
        if (w !== lemma) tryAddEn(g, w)
      }
      return { opts: [ans, ...picks], owner }
    }
  }
  const curated = (e.mean || []).filter(isZh)
  if (curated.length >= 2) return { opts: curated, owner: {} }
  const ans = meaningOf(e)
  if (!ans) return { opts: [], owner: {} }
  const pos = e.pos || 'v.'
  const own = [ans, ...(e.dict || []).map(short)].filter(Boolean)
  const owner: Record<string, string> = {}
  const picks: string[] = []
  const tryAdd = (zh: string, w: string) => {
    if (picks.length >= 2 || !isZh(zh) || own.some((o) => overlaps(o, zh)) || picks.some((p) => overlaps(p, zh))) return
    picks.push(zh)
    if (w) owner[zh] = w
  }
  const lemma = e.lemma.toLowerCase()
  const others = shuffle(
    Object.keys(d.learn).filter((x) => x !== id && !isPhraseId(d, x) && d.pieces[x] && lemmaOf(d, x).toLowerCase() !== lemma),
    id,
  )
  for (const x of others.filter((x) => d.pieces[x].pos === pos)) tryAdd(meaningOf(d.pieces[x]), lemmaOf(d, x))
  for (const x of tableDistractors(pos, lemma, id, 'zh')) tryAdd(x.txt, x.w)
  for (const v of shuffle(Object.values(LEX).filter((v) => v[1] === pos && v[0] !== e.lemma), id)) tryAdd(short(v[3]), v[0])
  const pool = dictDistractors()
  if (picks.length < 2 && pool.length) {
    const same = pool.filter((x) => x.pos === pos && x.w !== lemma)
    const start = hash(id) % Math.max(1, same.length)
    for (let i = 0; i < same.length && picks.length < 2; i += 97) {
      const x = same[(start + i) % same.length]
      tryAdd(x.zh, x.w)
    }
  }
  for (const x of others) tryAdd(meaningOf(d.pieces[x]), lemmaOf(d, x))
  return { opts: [ans, ...picks], owner }
}

export function confOf(d: AppState, id: string): { opts: string[]; why: string } {
  const e = d.pieces[id]
  if (e.conf) return e.conf
  const f = e.form || e.lemma
  const sim = (LEX[e.lemma]?.[4] || []).filter((x) => x !== f).slice(0, 2)
  const pool = [
    ...new Set([
      ...Object.keys(d.learn)
        .filter((x) => !isPhraseId(d, x) && d.pieces[x]?.pos === e.pos)
        .map((x) => d.pieces[x]?.form || lemmaOf(d, x)),
      ...Object.values(LEX)
        .filter((v) => v[1] === e.pos)
        .map((v) => v[0]),
    ]),
  ].filter((x) => x && x !== f && !sim.includes(x))
  shuffle(pool, id).forEach((x) => {
    if (sim.length < 2) sim.push(x)
  })
  return { opts: [f, ...sim], why: `这里需要「${e.lemma}」（${e.tile}）。` }
}


export function maskParts(s: string, form: string): [string, string] {
  const re = new RegExp((/^\w/.test(form) ? '\\b' : '') + escRe(form) + (/\w$/.test(form) ? '\\b' : ''), 'i')
  const m = s.match(re)
  if (!m || m.index == null) return [`${s} `, '']
  return [s.slice(0, m.index), s.slice(m.index + m[0].length)]
}

export const answersOf = (e: Entry) => [e.form, e.lemma, e.ans].filter(Boolean).map((x) => (x as string).toLowerCase())

export const norm = (v: string) => v.trim().toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ')

export const matchesWord = (e: Entry, v: string, extra: string[] = []) =>
  [...extra, ...answersOf(e)].includes(v) || (e.pos !== 'phrase' && lemmatize(v) === lemmatize(e.lemma))

export const matchesForm = (v: string, forms: string[]) => forms.some((form) => norm(form) === v)

export function localJudge(d: AppState, id: string, v: string): string {
  const e = d.pieces[id]
  const words = (v.match(/[A-Za-z’']+/g) || []).map((w) => w.toLowerCase())
  if (words.length < 5) return '至少 5 个词'
  const lem = words.map(lemmatize)
  const mem = (e.members || [e.lemma]).map(lemmatize)
  if (!mem.every((m) => lem.includes(m))) return `需包含 ${e.lemma}`
  const cnt: Record<string, number> = {}
  words.forEach((w) => (cnt[w] = (cnt[w] || 0) + 1))
  if (Object.entries(cnt).some(([w, n]) => n >= (w.length > 2 ? 3 : 4))) return '重复词过多'
  if (new Set(lem.filter((x) => !mem.includes(x))).size < 4) return '句子太简单'
  const A = new Set(words)
  const B = new Set((srcSentence(d, id).match(/[A-Za-z’']+/g) || []).map((w) => w.toLowerCase()))
  const inter = [...A].filter((x) => B.has(x)).length
  if (inter / new Set([...A, ...B]).size > 0.6) return '换一个新场景'
  return ''
}

export { sensesOfPiece }

export const isPoly = (e: Entry | undefined, lang: 'zh' | 'en' = 'zh') => sensesOfPiece(e, lang).length >= 2

export interface SenseSentence extends Sentence {
  k: number
}

export function senseSentence(d: AppState, id: string, seed: string): SenseSentence | null {
  const e = d.pieces[id]
  const r = d.learn[id]
  const lang = d.prefs.defLang || 'en'
  if (!e || !r || !isPoly(e, lang)) return null
  const senses = sensesOfPiece(e, lang)
  const first = srcSentence(d, id)
  const firstNorm = norm(first)
  const row = senseById(e.sid)
  const targetLine = row ? senseLine(row, lang) : ''
  const rawList = e.senses?.length ? e.senses : e.dict || []
  const aiRaw = r.occ[0]?.ai?.sense ? rawList[r.occ[0].ai.sense - 1] : ''
  const idx =
    (targetLine ? senses.indexOf(targetLine) : -1) >= 0
      ? senses.indexOf(targetLine)
      : aiRaw && senses.findIndex((s) => short(s) === short(aiRaw)) >= 0
        ? senses.findIndex((s) => short(s) === short(aiRaw))
        : senses.findIndex((s) => short(s) === meaningOf(e) || (e.ens && s.toLowerCase().endsWith(e.ens.toLowerCase())))
  const k = idx + 1
  if (!k) return null
  const rawK = r.occ[0]?.ai?.sense
  const pool = dedupSentences<SenseSentence>([
    ...r.occ.filter((o) => o.s && (!o.ai?.sense || o.ai.sense === rawK)).map((o) => {
      const s = stripCites(o.s)
      return { s, fresh: norm(s) !== firstNorm, k }
    }),
    ...(e.alt || []).filter((a) => !a.k || a.k === rawK || a.k === k).map((a) => {
      const s = a.s.replace('___', a.a?.[0] || e.form || e.lemma)
      return { s, fresh: norm(s) !== firstNorm, k }
    }),
    ...senseExamples(e).map((x) => ({ s: x.s, form: x.form, fresh: norm(x.s) !== firstNorm, k })),
  ])
  if (!pool.length) return null
  const fresh = pool.filter((x) => x.fresh)
  const list = fresh.length ? fresh : pool
  return list[hash(seed) % list.length]
}

export function todayDone(learn: LearnState, day: Day, queue: readonly string[], again: ReadonlySet<string>, pieces?: Record<string, Piece>) {
  const inQ = new Set(queue)
  const fb = pieces ? new Set(fallbackPhrases({ learn, pieces }, day).done) : new Set<string>()
  return Object.keys(learn).filter((id) => {
    if (pieces && isLinkedPhrase(pieces, id)) return fb.has(id)
    return !inQ.has(id) && !again.has(id) && learn[id].goal !== 'stash' && (learn[id].sched.last === day || learn[id].form?.last === day)
  })
}

export function stableRows(prev: readonly string[], done: readonly string[], queue: readonly string[]) {
  const live = new Set([...done, ...queue])
  const kept = prev.filter((id) => live.has(id))
  const seen = new Set(kept)
  return [...kept, ...[...done, ...queue].filter((id) => !seen.has(id))]
}

export const scenePage = (style: string) => (style === 'neon' ? 7 : 9)
