import { create } from 'zustand'
import { aiErr, askJSON } from '../ai/ask'
import type { ChatMessage } from '../ai/types'
import { useApp } from '../app/store'
import { DEMO_ENTRIES, SENSE_BANK } from '../content/demo'
import { allDocs, paraIdsOf, setDocFlags } from '../content/docs'
import { dueCard } from '../learn/engine'
import { today } from '../core/date'
import { escRe, highlightParts } from '../core/text'
import type { SenseRow, AppState, DocData, Entry, EntryAI, Grade, Reason } from '../core/types'
import { lemmatize, lexOf, participialOf, participleAsAdj, phraseHead } from '../lang/lemmatize'
import { recordReview } from '../app/review'
import {
  addOccurrence,
  createPiece,
  dictSenseOf,
  entryFromSurface,
  lemmaOf,
  newPieceId,
  occurrenceAt,
  parentOf,
  pieceGloss,
  pieceGlossFor,
  piecesOfLemma,
  sensesOfPiece,
  withGloss,
} from '../learn/pieces'
import { phraseSpans, sentencesByWord, spansFor, stripCites, tokenize, wordOwner } from './text'
import { attachAI, ctxKey, hasAISense, isMetaAI, meetKey, occurrenceAI, type MeetAI } from './aiContext'
import { db } from '../storage/db'
import { dictHas, ensureDict, firstSense } from '../lang/lexdict'
import { ensurePhrases, ensureSenses, loadedPhrases, matchSense, senseLine, sensesOfWord, withSense } from '../lang/senses'
import { phraseTokens } from '../learn/phrase'

export type PickMode = 'here' | 'meet' | 'new'

export interface Sel {
  docId: string
  pid: string
  wi: number
  w: string
  lm: string
  pg?: number
  s: string
  mode: PickMode
  k: string | null
  cands: string[]
  freePh: string | null
  gloss?: string
  part: { base: string; adj: boolean } | null
}

export interface Ann {
  pid: string
  w0: number
  w1: number
  words: string[]
  hl: string
}

export interface HeadPrompt {
  id: string
  entry: Entry
  head: string
  candidates: string[]
  ctx: { pid: string; wi: number; doc: string; s: string; form?: string }
  word: string
  headWi: number | null
  reason: Reason
  suggest: string
}

interface Session {
  cur: string | null
  pen: 'pick' | 'hl'
  penColor: string
  sel: Sel | null
  po: boolean
  ctx: boolean
  ann: Ann | null
  ai: Record<string, EntryAI | MeetAI | null>
  aiStream: Record<string, Partial<MeetAI>>
  newest: string | null
  fly: { id: string; rect: DOMRect } | null
  recalled: string[]
  jump: { id: string; i: number; seq: number } | null
  askNew: boolean
  askHead: HeadPrompt | null
  set: (p: Partial<Session>) => void
}

export const useReader = create<Session>((set) => ({
  cur: null,
  pen: 'pick',
  penColor: 'y',
  sel: null,
  po: false,
  ctx: false,
  ann: null,
  ai: {},
  aiStream: {},
  newest: null,
  fly: null,
  recalled: [],
  jump: null,
  askNew: false,
  askHead: null,
  set: (p) => set(p),
}))

const app = () => useApp.getState()
const rs = () => useReader.getState()

export const normWordsOf = (t = '') => tokenize(t).filter((x) => x.w).map((x) => x.w as string)

export function selOccIdx(d: AppState, sel: Sel): number {
  const doc = allDocs(d).find((x) => x.id === sel.docId)
  const p = doc?.paras.find((x) => x.id === sel.pid)
  if (!p?.t) return 0
  const words = normWordsOf(p.t)
  const sents = sentencesByWord(p.t)
  const target = sel.w.toLowerCase()
  let n = 0
  for (let i = 0; i < sel.wi; i++) {
    if (sents[i] === sel.s && words[i]?.toLowerCase() === target) n++
  }
  return n
}

export const selCtxKey = (d: AppState, sel: Sel) => {
  const n = selOccIdx(d, sel)
  return n > 0 ? `${ctxKey(sel.lm, sel.s)}|${n}` : ctxKey(sel.lm, sel.s)
}

export const selMeetKey = (d: AppState, sel: Sel) => {
  const n = selOccIdx(d, sel)
  return n > 0 ? `${meetKey(sel.cands, sel.s)}|${n}` : meetKey(sel.cands, sel.s)
}

const promptSentence = (s: string, w: string, n: number) => {
  const hits = [...s.matchAll(new RegExp(`\\b${escRe(w)}\\b`, 'gi'))]
  if (hits.length <= 1) return s
  const hp = highlightParts(s, w, n)
  return hp ? `${hp[0]}[${hp[1]}]${hp[2]}` : s
}


const demoPhraseLemmas = new Set(Object.values(DEMO_ENTRIES).filter((e) => e.pos === 'phrase').map((e) => e.lemma.toLowerCase()))

let builtInCache: { count: number; byId: Map<string, Entry>; byFirst: Map<string, [string, Entry][]> } | null = null

function builtInPhrases() {
  const rows = loadedPhrases()
  if (builtInCache && builtInCache.count === rows.length) return builtInCache
  const byId = new Map<string, Entry>()
  const all: [string, Entry][] = []
  for (const [pKey, r] of rows) {
    if (demoPhraseLemmas.has(pKey.toLowerCase())) continue
    const members = phraseTokens(pKey)
    if (members.length < 2) continue
    const id = 'ph_' + pKey.replace(/…|\.{2,}/g, ' gap ').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase()
    const clean = members.join(' ')
    const entry: Entry = {
      lemma: pKey,
      sid: '',
      headSid: r[1] || undefined,
      ph: '',
      pos: 'phrase',
      gloss: r[2],
      tile: r[2],
      en: r[5],
      ens: r[4],
      form: clean,
      ans: clean,
      parentLemma: r[0] || phraseHead(members),
      members,
    }
    byId.set(id, entry)
    all.push([id, entry])
  }
  all.sort((a, b) => (b[1].members?.length || 0) - (a[1].members?.length || 0))
  const byFirst = new Map<string, [string, Entry][]>()
  for (const pair of all) {
    const m0 = pair[1].members![0]
    for (const k of new Set([m0, lemmatize(m0)])) {
      const list = byFirst.get(k)
      if (list) list.push(pair)
      else byFirst.set(k, [pair])
    }
  }
  builtInCache = { count: rows.length, byId, byFirst }
  return builtInCache
}

export const catalogPhraseOf = (id: string): Entry | undefined => builtInPhrases().byId.get(id)

const phraseCatalog = (d: AppState, words?: string[]): [string, Entry][] => {
  const seen = new Map<string, Entry>()
  for (const [id, e] of Object.entries(DEMO_ENTRIES)) if (e.pos === 'phrase' && e.members) seen.set(id, e)
  for (const [id, e] of Object.entries(d.pieces)) if (e.pos === 'phrase' && e.members) seen.set(id, e)
  if (words?.length) {
    const idx = builtInPhrases().byFirst
    const matched: [string, Entry][] = []
    const added = new Set<string>()
    for (const w of words) {
      for (const k of [w.toLowerCase(), lemmatize(w)]) {
        for (const [id, e] of idx.get(k) || []) {
          if (!seen.has(id) && !added.has(id)) {
            added.add(id)
            matched.push([id, e])
          }
        }
      }
    }
    matched.sort((a, b) => (b[1].members?.length || 0) - (a[1].members?.length || 0))
    for (const [id, e] of matched) seen.set(id, e)
  }
  return [...seen]
}

export const curDocOf = (d: AppState): DocData | undefined => {
  const docs = allDocs(d)
  const { cur } = rs()
  const list = docs.filter((y) => y.vault === d.curVault)
  return list.find((y) => y.id === cur) || list[0]
}

export function computeSel(d: AppState, doc: DocData, pid: string, wi: number, w: string): Sel | null {
  const p = doc.paras.find((x) => x.id === pid)
  if (!p) return null
  const normAll = normWordsOf(p.t)
  const pa = participialOf(w)
  const part = pa ? { base: pa.base, adj: participleAsAdj(normAll, wi) } : null
  const lm = part?.adj ? w.toLowerCase() : lemmatize(w)
  const sents = sentencesByWord(p.t || '')
  const s = sents[wi] || stripCites(p.t || '')
  const cat = phraseCatalog(d, normAll)
  const matchHere = (_id: string, hit: number[]) => hit.every((pos) => sents[pos] === s)
  const freePh = spansFor(cat.filter(([id]) => !d.learn[id]), normAll, matchHere, true)[wi] || null
  const ownPh = phraseSpans(d, normAll, pid, sents)[wi]
  const word = wordOwner(d, pid, w, wi, s)
  const owner = ownPh || word
  const base = { docId: doc.id, pid, wi, w, lm, pg: p.pg, s, freePh, part }
  if (owner) return { ...base, mode: 'here', k: owner, cands: [owner] }
  const phrases = cat.filter((row) => d.learn[row[0]] && spansFor([row], normAll, matchHere)[wi]).map(([id]) => id)
  const cands = phrases.length ? phrases : piecesOfLemma(d, lemmatize(lm)).filter((id) => !part || lemmaOf(d, id) === lm)
  if (cands.length) return { ...base, mode: 'meet', k: null, cands }
  return { ...base, mode: 'new', k: null, cands: [] }
}

const glossed = (base: Entry, g: string) => {
  const r = sensesOfWord(base.lemma).find((x) => x[3] === g || x[5] === g)
  return r ? { ...withSense(base, r), sidLock: true } : withGloss(base, g)
}

export function pickWord(pid: string, wi: number, w: string) {
  const { sel, po } = rs()
  if (sel && sel.pid === pid && sel.wi === wi && po) return rs().set({ sel: null, po: false, ann: null })
  const d = app().data
  const doc = curDocOf(d)
  if (!doc) return
  const next = computeSel(d, doc, pid, wi, w)
  rs().set({ sel: next, po: !!next })
  if (next) {
    void aiCached(next.mode === 'meet' ? selMeetKey(d, next) : selCtxKey(d, next))
    const sentLetters = [...new Set((next.s.match(/\b[a-z]/gi) || []).map((c) => c.toLowerCase()))]
    void Promise.all([
      ...(!sensesOfWord(next.lm).length ? [ensureSenses(w), ensureSenses(lemmatize(w))] : []),
      ...sentLetters.map((c) => ensurePhrases(c)),
    ]).then(() => {
      const cur = rs().sel
      if (!cur || cur.pid !== pid || cur.wi !== wi) return
      const again = computeSel(app().data, doc, pid, wi, w)
      if (again) rs().set({ sel: { ...again, gloss: cur.gloss } })
    })
  }
  if (!dictHas(w) && next) {
    void ensureDict(w).then(() => {
      const cur = rs().sel
      if (!cur || cur.pid !== pid || cur.wi !== wi) return
      const again = computeSel(app().data, doc, pid, wi, w)
      if (again) rs().set({ sel: { ...again, gloss: cur.gloss } })
    })
  }
}

export const closePop = () => rs().set({ po: false, ann: null, askHead: null, sel: rs().ctx ? rs().sel : null })

const refreshSel = (d: AppState, k?: string) => {
  const { sel } = rs()
  if (!sel) return
  const doc = allDocs(d).find((x) => x.id === sel.docId)
  const next = doc ? computeSel(d, doc, sel.pid, sel.wi, sel.w) : null
  if (next && k) Object.assign(next, { mode: 'here', k, cands: [k] })
  rs().set({ sel: next })
}

const ctxOf = (sel: Sel) => {
  const doc = allDocs(app().data).find((x) => x.id === sel.docId)
  return { pid: sel.pid, wi: sel.wi, doc: doc?.title || '', s: sel.s, form: sel.w }
}

function phraseContext(
  d: AppState,
  id: string,
  entry: Entry,
  ctx: Omit<ReturnType<typeof ctxOf>, 'form'> & { form?: string },
  reason: Reason = '词族关联',
): Parameters<typeof createPiece>[4] | null {
  const head = entry.parentLemma || phraseHead(entry.members || [entry.lemma])
  const doc = allDocs(d).find((x) => x.paras.some((p) => p.id === ctx.pid))
  const para = doc?.paras.find((p) => p.id === ctx.pid)
  const words = normWordsOf(para?.t)
  const sentences = sentencesByWord(para?.t || '')
  let positions: number[] = []
  spansFor([['phrase', entry]], words, (_id, hit) => {
    if (!hit.includes(ctx.wi) || hit.some((i) => sentences[i] !== ctx.s)) return false
    positions = hit
    return true
  })
  const wi = positions.find((i) => lemmatize(words[i]) === head)
  const candidates = piecesOfLemma(d, head).filter((cid) => lemmaOf(d, cid) === head)
  const exact = wi == null ? null : wordOwner(d, ctx.pid, words[wi], wi, ctx.s)
  const known = DEMO_ENTRIES[head]
  const sameGloss = candidates.filter((cid) => known && pieceGloss(known) === pieceGloss(d.pieces[cid]))
  const bySid = entry.headSid ? candidates.find((cid) => d.pieces[cid]?.sid === entry.headSid) : undefined
  const sidConflict = !!entry.headSid && !bySid && candidates.length > 0 && candidates.every((cid) => !!d.pieces[cid]?.sid)
  const parentId =
    candidates.find((cid) => cid === exact) ||
    bySid ||
    (sidConflict ? undefined : candidates.length === 1 ? candidates[0] : sameGloss.length === 1 ? sameGloss[0] : undefined)
  const word = (wi != null && words[wi]) || head
  if (!parentId && candidates.length > 1 && !sidConflict) {
    const suggest = known ? pieceGlossFor(known, d.prefs.defLang || 'en') : ''
    rs().set({ askHead: { id, entry, head, candidates, ctx, word, headWi: wi ?? null, reason, suggest }, po: true, ann: null })
    return null
  }
  return { ...ctx, head: { parentId, word, wi: wi ?? null } }
}

export function resolveHead(parentId?: string, gloss?: string) {
  const h = rs().askHead
  if (!h) return
  const rect = wordRect(rs().sel)
  const d = app().data
  const linked = { ...h.ctx, head: { parentId, gloss, word: h.word, wi: h.headWi } }
  rs().set({ askHead: null })
  app().update(() => createPiece(d, h.id, h.entry, h.reason, linked))
  afterPick(h.id, rect)
}

const wordRect = (sel: Sel | null) =>
  typeof document !== 'undefined' && sel
    ? (document.querySelector(`#col p[data-id="${CSS.escape(sel.pid)}"] .w[data-wi="${sel.wi}"]`)?.getBoundingClientRect() ?? null)
    : null

function afterPick(id: string, rect: DOMRect | null) {
  const d = app().data
  refreshSel(d, id)
  const pId = parentOf(d, id)
  app().say(pId ? `已挂在 ${lemmaOf(d, pId)} 下：${lemmaOf(d, id)}` : `摘取 ${lemmaOf(d, id)}`)
  app().pulse()
  rs().set({ newest: id, fly: rect ? { id, rect } : null })
}

export function pickCurrent(phrase = false, lemma: string | null = null) {
  const sel = rs().sel
  if (!sel) return
  const rect = wordRect(sel)
  const d = app().data
  const ctx = ctxOf(sel)
  let id: string
  let next: AppState
  let cKey = ''
  if (phrase && !sel.freePh) return
  if (phrase && sel.freePh) {
    id = sel.freePh
    const entry = d.pieces[id] || DEMO_ENTRIES[id] || catalogPhraseOf(id)
    if (!entry) return
    const headWord = entry.parentLemma || phraseHead(entry.members || [entry.lemma])
    void ensureSenses(headWord)
    const linked = phraseContext(d, id, entry, ctx, '词族关联')
    if (!linked) return
    next = createPiece(d, id, entry, '词族关联', linked)
  } else {
    const lm = lemma || sel.lm
    id = newPieceId(d, lm)
    const ov = lemma ? undefined : (d.extra.posOv as Record<string, string> | undefined)?.[sel.lm]
    const base = entryFromSurface(sel.w, sel.s, { lemma: lm, pos: ov })
    cKey = selCtxKey(d, sel)
    next = createPiece(d, id, sel.gloss && !lemma ? glossed(base, sel.gloss) : base, '生词初见', ctx)
    if (!lemma) next = attachAI(next, id, sel.pid, rs().ai[cKey], true, sel.wi)
  }
  app().update(() => next)
  afterPick(id, rect)
  if (!phrase && !lemma && cKey && inflight.has(cKey)) {
    void inflight.get(cKey)?.then((out) => out && app().update((x) => attachAI(x, id, sel.pid, out, true, sel.wi)))
  }
}

export function meetSame(id: string) {
  const sel = rs().sel
  if (!sel || !sel.cands.includes(id)) return
  const d0 = app().data
  const ref = rs().ai[selMeetKey(d0, sel)] as MeetAI | undefined
  const help = ref?.match && sel.cands[ref.match - 1] === id ? ref : null
  const data = attachAI(addOccurrence(d0, id, ctxOf(sel)), id, sel.pid, help, false, sel.wi)
  app().update(() => data)
  app().pulse()
  app().say('新原句已并入')
  refreshSel(data, id)
}

export function newSenseOptions(sel: Sel) {
  const d = app().data
  const lang = d.prefs.defLang || 'en'
  const rawRef = rs().ai[selMeetKey(d, sel)] as MeetAI | undefined
  const ref = rawRef && !isMetaAI(rawRef) ? rawRef : undefined
  const previous = sel.cands.map((id) => d.pieces[id]).filter(Boolean)
  const phrase = previous.find((entry) => entry.pos === 'phrase')
  const usedSids = new Set(previous.map((entry) => entry.sid).filter(Boolean))
  const usedNorm = new Set(
    previous
      .flatMap((entry) => [entry.tile, entry.gloss, entry.ens, pieceGlossFor(entry, 'zh'), pieceGlossFor(entry, 'en')])
      .filter((x): x is string => !!x)
      .map((x) => x.trim().toLowerCase()),
  )
  const bank = (SENSE_BANK[sel.lm] || []).find((x) => !usedNorm.has((x.tile || '').toLowerCase()))
  const rows = sensesOfWord(sel.lm)
  const options = phrase
    ? []
    : rows.length
      ? rows
          .filter((r) => !usedSids.has(r[0]) && !usedNorm.has(r[3].toLowerCase()) && !usedNorm.has(r[5].toLowerCase()))
          .map((r) => senseLine(r, lang))
      : dictSenseOf(sel.lm).lines.filter((l) => !usedNorm.has(firstSense(l).toLowerCase()))
  const suggest = lang === 'en' ? ref?.en || '' : ref?.zh || bank?.tile || ''
  return { options, suggest, term: phrase?.lemma || sel.lm }
}

export function meetNew(gloss?: string) {
  const sel = rs().sel
  if (!sel) return
  if (!gloss) return rs().set({ askNew: true, po: true, ctx: false })
  rs().set({ askNew: false, ctx: false })
  const rect = wordRect(sel)
  const d = app().data
  const rawRef = rs().ai[selMeetKey(d, sel)] as MeetAI | undefined
  const ref = rawRef && !isMetaAI(rawRef) ? rawRef : undefined
  const previous = sel.cands.map((id) => d.pieces[id]).filter(Boolean)
  const phrase = previous.find((entry) => entry.pos === 'phrase')
  const usedSids = new Set(previous.map((entry) => entry.sid).filter(Boolean))
  const term = phrase?.lemma || sel.lm
  const id = newPieceId(d, term)
  const base = phrase
    ? { ...phrase, s: sel.s, gloss: undefined, ai: undefined, mean: undefined, conf: undefined, alt: undefined, senses: undefined }
    : entryFromSurface(sel.w, sel.s, { lemma: sel.lm })
  const clean = gloss.replace(/^(?:[a-z]+\.\s*(?:[&/,]\s*)?)+/i, '').trim()
  const unusedRows = sensesOfWord(sel.lm).filter((r) => !usedSids.has(r[0]))
  const exactRow = phrase
    ? undefined
    : unusedRows.find((r) => senseLine(r, 'zh') === gloss || senseLine(r, 'en') === gloss || r[3] === clean || r[5].toLowerCase() === clean.toLowerCase())
  const matchedRow =
    exactRow ||
    (phrase
      ? undefined
      : matchSense({ lemma: sel.lm, pos: base.pos, gloss: ref && !ref.match ? ref.zh || clean : clean, tile: '' }, unusedRows))
  let e = phrase ? withGloss(base, clean) : matchedRow ? { ...withSense(base, matchedRow), sidLock: true } : glossed(base, clean)
  if (ref && !ref.match && (ref.zh || ref.en)) {
    e = { ...e, ai: { ...e.ai, zh: ref.zh || e.ai?.zh || '', en: ref.en || e.ai?.en || '' } }
  }
  const ctx = phrase ? phraseContext(d, id, e, ctxOf(sel), '熟词新义') : ctxOf(sel)
  if (!ctx) return
  const created = createPiece(d, id, e, '熟词新义', ctx)
  app().update(() => attachAI(created, id, sel.pid, ref?.match ? null : ref, false, sel.wi))
  afterPick(id, rect)
}

export function setWordPos(key: string, pos: string, isPiece: boolean) {
  app().update((d) =>
    isPiece
      ? { ...d, pieces: { ...d.pieces, [key]: { ...d.pieces[key], pos } } }
      : { ...d, extra: { ...d.extra, posOv: { ...((d.extra.posOv as Record<string, string>) || {}), [key]: pos } } },
  )
}

export function recallKey(id: string, sel: Sel) {
  return `${id}|${sel.pid}|${sel.wi}`
}

export function recallGateId(d: AppState, sel: Sel): string | null {
  if (sel.mode === 'here') return sel.k
  if (sel.mode === 'meet' && sel.cands.length === 1 && piecesOfLemma(d, sel.lm).length === 1) {
    const id = sel.cands[0]
    const e = d.pieces[id]
    if (e && !(e.senses?.length && sensesOfPiece(e).length >= 2)) return id
  }
  return null
}

export function needsRecall(d: AppState, sel: Sel, id: string, day: string) {
  const r = d.learn[id]
  if (!r || recallGateId(d, sel) !== id || r.sched.state === 0 || dueCard(r, day) !== 'meaning' || rs().recalled.includes(recallKey(id, sel))) return false
  const doc = allDocs(d).find((x) => x.id === sel.docId)
  if (!doc) return false
  const pids = paraIdsOf(doc)
  const [first] = r.occ
  if (sel.mode === 'meet') {
    return (!first?.pid || !pids.has(first.pid)) && first?.s !== sel.s
  }
  const occurrence = r.occ.find((o) => occurrenceAt(o, sel.pid, sel.wi, sel.s))
  return !!occurrence && occurrence.added !== day && !occurrence.reviewed && !!first?.pid && !pids.has(first.pid) && occurrence.s !== first.s
}

function bindReviewedOccurrence(id: string, sel: Sel, day: string) {
  app().update((d) => {
    const added = sel.mode === 'meet' ? addOccurrence(d, id, ctxOf(sel), day) : d
    return {
      ...added,
      learn: {
        ...added.learn,
        [id]: {
          ...added.learn[id],
          occ: added.learn[id].occ.map((o) => (occurrenceAt(o, sel.pid, sel.wi, sel.s) ? { ...o, reviewed: true } : o)),
        },
      },
    }
  })
}

export function recallInReading(id: string, grade: Grade) {
  const sel = rs().sel
  const day = today()
  if (!sel || !needsRecall(app().data, sel, id, day)) return
  if (!recordReview(id, { kind: 'meaning', task: 'recallNew', grade, fresh: sel.mode !== 'meet', day }, 'read')) return
  app().markAgain(id, grade < 2)
  bindReviewedOccurrence(id, sel, day)
  rs().set({ recalled: [...rs().recalled, recallKey(id, sel)] })
  if (sel.mode === 'meet') refreshSel(app().data, id)
  if (grade) app().pulse()
}

export function skipRecall(id: string) {
  const sel = rs().sel
  if (!sel) return
  if (sel.mode === 'meet' && recallGateId(app().data, sel) === id) {
    bindReviewedOccurrence(id, sel, today())
    refreshSel(app().data, id)
  }
  rs().set({ recalled: [...rs().recalled, recallKey(id, sel)] })
}

const CTX_SYS =
  'You are an English vocabulary tutor for Chinese learners. Reply ONLY valid JSON with keys in the exact order shown. Set "meta":true ONLY if the sentence mentions the word itself as a word or intentionally leaves multiple senses unresolved.'

const fixedPrompt = (w: string, s: string, rows: SenseRow[], needFam: boolean): ChatMessage[] => [
  { role: 'system', content: CTX_SYS },
  {
    role: 'user',
    content: `Word: "${w}"\nSentence: "${s}"\nKnown senses: ${rows.map((r, i) => `${i + 1}. ${r[1]} ${r[3]} (${r[5] || r[6]})`).join(' | ')}\nSchema: {"sense":1,"meta":false,"pos":"v./n./adj./adv.","zh":"本句中的具体意思(<=12字)","en":"English gloss","tr":"整句中文翻译","st":"句子主干(<=30字)","ex":"为什么是这个意思(<=36字)"${needFam ? ',"fam":["2-3个同族或近义词 带中文"]' : ''}} where sense is 1-based index of the known sense used here, or 0 if none fits.`,
  },
]

const openPrompt = (w: string, s: string, lines: string[], needFam: boolean): ChatMessage[] => [
  { role: 'system', content: CTX_SYS },
  {
    role: 'user',
    content: `Word: "${w}"\nSentence: "${s}"\nDictionary: ${lines.length ? lines.map((l, i) => `${i + 1}. ${l}`).join(' | ') : '(not in dictionary)'}\nSchema: {"sense":1,"meta":false,"pos":"v./n./adj./adv.","zh":"本句中的具体意思(<=12字)","en":"English gloss","tr":"整句中文翻译","st":"句子主干(<=30字)","ex":"为什么是这个意思(<=36字)","senses":["2-4 distinct Chinese senses starting with POS, e.g. adj. 故意的; merge near-synonyms"]${needFam ? ',"fam":["2-3个同族或近义词 带中文"]' : ''}} where sense is 1-based index in senses.`,
  },
]

const ctxPrompt = (w: string, lm: string, s: string, lines: string[], hasFam = false): ChatMessage[] => {
  const rows = sensesOfWord(w.toLowerCase()).length ? sensesOfWord(w.toLowerCase()) : sensesOfWord(lm)
  const needFam = !hasFam && !(lexOf(w)?.[4]?.length || lexOf(lm)?.[4]?.length)
  return rows.length ? fixedPrompt(w, s, rows, needFam) : openPrompt(w, s, lines, needFam)
}

const meetPrompt = (w: string, senses: string[], s: string): ChatMessage[] => [
  { role: 'system', content: CTX_SYS },
  {
    role: 'user',
    content: `Word: "${w}"\nKnown senses: ${senses.map((x, i) => `${i + 1}. ${x}`).join('; ')}\nNew sentence: "${s}"\nSchema: {"match":1,"meta":false,"zh":"本句中的中文语境义(<=12字)","en":"English gloss","reason":"中文判据(<=26字)","tr":"整句中文翻译","st":"句子主干(<=30字)","ex":"为什么是这个意思(<=36字)"} where match is the sense number, or 0 if none fits.`,
  },
]

const inflight = new Map<string, Promise<MeetAI | null>>()

async function aiCached(key: string) {
  if (key in rs().ai && rs().ai[key] !== null) return rs().ai[key]
  const row = await db.cache.get(key).catch(() => undefined)
  if (row) {
    rs().set({ ai: { ...rs().ai, [key]: row.value as EntryAI } })
    return row.value as EntryAI
  }
  return undefined
}

const clearStream = (key: string) => {
  if (!(key in rs().aiStream)) return
  const next = { ...rs().aiStream }
  delete next[key]
  rs().set({ aiStream: next })
}

async function askAI(key: string, prompt: ChatMessage[], baseFam?: string[]) {
  const running = inflight.get(key)
  if (running) return running
  const { ai, say } = app()
  if (!ai.apiKey) {
    rs().set({ ai: { ...rs().ai, [key]: null } })
    say('离线释义 · 未配置 Key')
    return null
  }
  if (key in rs().ai && rs().ai[key] === null) {
    const next = { ...rs().ai }
    delete next[key]
    rs().set({ ai: next })
  }
  rs().set({ aiStream: { ...rs().aiStream, [key]: {} } })
  const job = askJSON<MeetAI>(prompt, {
    jsonMode: true,
    maxTokens: 380,
    estOut: 180,
    onPartial: (p) => {
      rs().set({ aiStream: { ...rs().aiStream, [key]: { ...(baseFam?.length ? { fam: baseFam } : {}), ...(p as Partial<MeetAI>) } } })
    },
  })
    .then((raw) => {
      const out: MeetAI = baseFam?.length && !raw.fam?.length ? { ...raw, fam: baseFam } : raw
      const nextStream = { ...rs().aiStream }
      delete nextStream[key]
      rs().set({ ai: { ...rs().ai, [key]: out }, aiStream: nextStream })
      void db.cache.put({ key, value: out, at: Date.now() }).catch(() => undefined)
      return out
    })
    .catch((e) => {
      clearStream(key)
      rs().set({ ai: { ...rs().ai, [key]: null } })
      say(aiFailReason(e))
      return null
    })
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, job)
  return job
}

export async function triggerAI() {
  const sel = rs().sel
  if (!sel) return
  rs().set({ po: false, ctx: true })
  const d = app().data
  const ps = promptSentence(sel.s, sel.w, selOccIdx(d, sel))
  const localFam = lexOf(sel.w)?.[4] || lexOf(sel.lm)?.[4] || []
  if (sel.mode === 'new') {
    const key = selCtxKey(d, sel)
    if ((await aiCached(key)) === undefined) await askAI(key, ctxPrompt(sel.w, sel.lm, ps, dictSenseOf(sel.lm).lines, localFam.length > 0), localFam)
    return
  }
  if (sel.mode === 'meet') {
    const key = selMeetKey(d, sel)
    if ((await aiCached(key)) !== undefined) return
    const senses = sel.cands.map((id) => {
      const p = d.pieces[id]
      return `${p?.ai?.zh || p?.tile || p?.lemma}${p?.ai?.en ? ` (${p.ai.en})` : ''}`
    })
    await askAI(key, meetPrompt(sel.w, senses, ps))
    return
  }
  const id = sel.k
  if (!id || (hasAISense(d, id) && occurrenceAI(d, id, sel.pid, sel.wi))) return
  const key = selCtxKey(d, sel)
  const p0 = d.pieces[id]
  const fam = p0?.ai?.fam?.length ? p0.ai.fam : localFam
  const out = (await aiCached(key)) ?? (await askAI(key, ctxPrompt(sel.w, sel.lm, ps, p0?.dict || p0?.senses || [], fam.length > 0), fam))
  if (out) app().update((x) => attachAI(x, id, sel.pid, out, true, sel.wi))
}

export const aiFailReason = (e: unknown) => aiErr(e, '离线释义 · AI 暂不可用')

export function annToPhrase() {
  const A = rs().ann
  if (!A) return
  const d = app().data
  const doc = curDocOf(d)
  const p = doc?.paras.find((x) => x.id === A.pid)
  if (!doc || !p) return
  const text = A.words.join(' ')
  const members = A.words.map((w) => w.toLowerCase())
  const cat = phraseCatalog(d, members)
  const hitId = spansFor(cat, members, (_id, hit) => hit[0] === 0 && hit[hit.length - 1] === members.length - 1, true)[0]
  const matched = hitId ? d.pieces[hitId] || DEMO_ENTRIES[hitId] || catalogPhraseOf(hitId) : undefined
  const id = hitId || 'ph_' + members.map(lemmatize).join('_')
  if (d.learn[id]) return app().say('已在拼块中')
  const head = matched?.parentLemma || phraseHead(members)
  const sent = sentencesByWord(p.t || '')[A.w0] || stripCites(p.t || '')
  const e: Entry = matched
    ? { ...matched, form: text, s: sent }
    : {
        lemma: text,
        ph: '',
        pos: 'phrase',
        tile: '短语',
        form: text,
        ans: text.toLowerCase(),
        parentLemma: head,
        members,
        s: sent,
        conf: { opts: [text, members.slice(0, -1).join(' ') || members[0], members.slice(1).join(' ') || members[0]], why: `原文搭配是「${text}」。` },
        ai: { zh: text, en: '', ex: `挂靠在核心词 ${head} 下`, tr: sent, st: '', fam: [] },
      }
  void ensureSenses(head)
  const rect = document.querySelector(`#col p[data-id="${CSS.escape(A.pid)}"] .w[data-wi="${A.w0}"]`)?.getBoundingClientRect() ?? null
  const sel: Sel = { docId: doc.id, pid: A.pid, wi: A.w0, w: members[0], lm: lemmatize(members[0]), pg: p.pg, s: sent, mode: 'here', k: id, cands: [id], freePh: null, part: null }
  const ctx = phraseContext(d, id, e, { pid: A.pid, wi: A.w0, doc: doc.title, s: sent }, '词族关联')
  if (!ctx) {
    rs().set({ ann: null, sel })
    return
  }
  rs().set({ ann: null, sel })
  app().update(() => createPiece(d, id, e, '词族关联', ctx))
  afterPick(id, rect)
  void ensureSenses(e.lemma)
}

export function originsOf(d: AppState, id: string) {
  const docs = allDocs(d)
  return (d.learn[id]?.occ || [])
    .map((o) => ({ ...o, di: o.pid ? docs.findIndex((x) => [x.paras, x.parasRule, x.parasAI].some((ps) => ps?.some((p) => p.id === o.pid))) : -1 }))
    .filter((o) => o.di >= 0)
}

export function jumpToOrigin(id: string, idx?: number) {
  const d = app().data
  const list = originsOf(d, id)
  if (!list.length) {
    const hadPid = d.learn[id]?.occ.some((o) => o.pid)
    return app().say(hadPid ? '原文所在文章已删除' : d.learn[id]?.reason === '词族关联' ? '这个词来自构词或手动新建，没有原文出处' : '这个词没有原文出处')
  }
  const i = idx == null ? list.length - 1 : ((idx % list.length) + list.length) % list.length
  const o = list[i]
  const doc = allDocs(d)[o.di]
  if (app().view !== 'read') app().go('read')
  if (d.curVault !== doc.vault) app().update((x) => ({ ...x, curVault: doc.vault }))
  if (!doc.paras.some((p) => p.id === o.pid)) {
    const toAI = !!doc.parasAI?.some((p) => p.id === o.pid)
    app().update((x) => setDocFlags(x, doc.id, { rebuilt: toAI }))
  }
  rs().set({ cur: doc.id, jump: { id, i, seq: (rs().jump?.seq || 0) + 1 } })
  if (list.length > 1) app().say(`原文 ${i + 1}/${list.length}`)
}
