import { today, type Day } from '../core/date'
import type { AppState, Entry, Occurrence, Reason } from '../core/types'
import { DEMO_ENTRIES } from '../content/demo'
import { guessPosBySuffix, lemmatize, lexOf, participialOf, phraseHead } from '../lang/lemmatize'
import { EN_GLOSS } from '../lang/lexicon'
import { dictPeek, firstSense, glossLines, phOf, primaryPos, sensesOf, tileOfSense } from '../lang/lexdict'
import { defaultSense, dictDefs, senseById, senseLine, sensesOfWord, withSense } from '../lang/senses'
import { newRecord, setGoal } from './engine'

export const GRID = 88

const ZH_CHAR_RE = /[\u4e00-\u9fff]/
const POS_PREFIX_RE = /^(?:(?:v|vt|vi|n|adj|adv|prep|conj|pron|det|aux|art|int|interj|num|a|ad)\.\s*(?:[&/,]\s*)?)+/i

export const isPhraseId = (d: AppState, id: string) => d.pieces[id]?.pos === 'phrase'
export const isAttachedPhrase = (d: AppState, id: string) => isPhraseId(d, id) && !!d.pieces[id]?.parentId
export const lemmaOf = (d: AppState, id: string) => d.pieces[id]?.lemma || id
export const rootIds = (d: AppState) => Object.keys(d.learn).filter((id) => !isAttachedPhrase(d, id))
let lemmaIdx: { learn: AppState['learn']; pieces: AppState['pieces']; map: Map<string, string[]> } | null = null

export function piecesOfLemma(d: AppState, lm: string): string[] {
  if (!lemmaIdx || lemmaIdx.learn !== d.learn || lemmaIdx.pieces !== d.pieces) {
    const map = new Map<string, string[]>()
    for (const id of Object.keys(d.learn).filter((k) => !isPhraseId(d, k))) {
      const k = lemmatize(lemmaOf(d, id))
      map.set(k, [...(map.get(k) || []), id])
    }
    lemmaIdx = { learn: d.learn, pieces: d.pieces, map }
  }
  return lemmaIdx.map.get(lm) || []
}

const nonDetachedSiblings = (d: AppState, lm: string) => piecesOfLemma(d, lm).filter((id) => !d.pieces[id]?.detached)

export const MOSAIC_MAX = 6

export function siblingGroupOf(d: AppState, primaryId: string): string[] {
  if (isPhraseId(d, primaryId) || d.pieces[primaryId]?.detached) return [primaryId]
  const sibs = nonDetachedSiblings(d, lemmatize(lemmaOf(d, primaryId))).slice(0, MOSAIC_MAX)
  return sibs.includes(primaryId) ? sibs : [primaryId]
}

export function boardPrimaryOf(d: AppState, id: string): string {
  const base = isAttachedPhrase(d, id) ? parentOf(d, id) || id : id
  return siblingGroupOf(d, base)[0] || base
}

export const boardRootIds = (d: AppState) =>
  rootIds(d).filter((id) => isPhraseId(d, id) || !!d.pieces[id]?.detached || siblingGroupOf(d, id)[0] === id)

export const childrenOf = (d: AppState, id: string) =>
  isPhraseId(d, id) ? [] : Object.keys(d.learn).filter((k) => isPhraseId(d, k) && d.pieces[k]?.parentId === id)
export const parentOf = (d: AppState, id: string) => (isPhraseId(d, id) ? d.pieces[id]?.parentId || null : null)

export const occurrenceAt = (o: Occurrence, pid: string | undefined, wi: number, s: string) =>
  o.pid === pid && (o.wi == null ? !!s && o.s.trim().includes(s.trim()) : o.wi === wi)

const pureEn = (s: string | undefined) => (s && /[A-Za-z]/.test(s) && !ZH_CHAR_RE.test(s) ? s.trim() : '')

const cleanZh = (s: string | undefined) => {
  if (!s || !ZH_CHAR_RE.test(s)) return ''
  return s.replace(POS_PREFIX_RE, '').trim()
}

export const pieceGloss = (e: Entry | undefined) => e?.gloss || e?.ai?.zh || e?.tile || ''

export function pieceGlossStrict(e: Entry | undefined, lang: 'zh' | 'en' = 'zh'): string {
  if (!e) return ''
  if (lang === 'en') {
    const lemma = (e.lemma || '').toLowerCase()
    const raw =
      pureEn(e.en) ||
      pureEn(e.ai?.en) ||
      pureEn(EN_GLOSS[e.lemma || '']) ||
      pureEn(EN_GLOSS[lemma]) ||
      pureEn(e.gloss) ||
      pureEn(dictDefs(lemma).find((d) => d[0] === e.pos)?.[1] || dictDefs(lemma)[0]?.[1])
    if (raw) return raw.replace(POS_PREFIX_RE, '').trim() || raw
    return e.lemma
  }
  return cleanZh(e.gloss) || cleanZh(e.ai?.zh) || cleanZh(e.tile) || cleanZh(firstSense(e.dict?.[0] || '')) || (ZH_CHAR_RE.test(pieceGloss(e)) ? pieceGloss(e) : '')
}

export const pieceGlossFor = pieceGlossStrict

export function shortEnGloss(e: Entry | undefined): string {
  if (e?.ens) return e.ens
  const raw = pieceGlossStrict(e, 'en')
  if (!raw) return ''
  const stripped = raw.replace(POS_PREFIX_RE, '').trim()
  const clause = stripped.split(/[;；,，/]/)[0]?.trim() || stripped
  const words = clause.split(/\s+/).filter(Boolean)
  if (words.length <= 1) return clause.length <= 32 ? clause : clause.slice(0, 32)
  const kept: string[] = []
  for (const w of words.slice(0, 5)) {
    const candidate = [...kept, w].join(' ')
    if (candidate.length > 32) break
    kept.push(w)
  }
  while (kept.length > 2 && /^(?:or|and|of|to|in|for|with|a|an|the)$/i.test(kept[kept.length - 1])) {
    if (words.length <= 5 && kept.join(' ').length <= 32) break
    kept.pop()
  }
  return kept.join(' ') || clause.slice(0, 32)
}

export function microGloss(e: Entry | undefined, lang: 'zh' | 'en'): string {
  if (!e) return ''
  if (lang === 'zh') {
    const raw =
      cleanZh(e.tile) ||
      cleanZh(tileOfSense(pieceGloss(e))) ||
      cleanZh(e.ai?.zh) ||
      cleanZh(firstSense(e.dict?.[0] || ''))
    const seg = raw.split(/[/、，；,;]/).map((x) => x.replace(/[^\u4e00-\u9fff]/g, '')).find(Boolean) || raw.replace(/[^\u4e00-\u9fff]/g, '')
    return seg.slice(0, 4)
  }
  const base = shortEnGloss(e)
  const clause = (base.split(/[;；,，/]/)[0] || base).replace(/^(?:to|a|an|the)\s+/i, '').trim()
  const words = clause.split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  if (words[0].length >= 12) return words[0].slice(0, 12)
  if (words.length >= 2 && `${words[0]} ${words[1]}`.length <= 12) return `${words[0]} ${words[1]}`
  return words[0]
}

export const sensesOfPiece = (e: Entry | undefined, lang: 'zh' | 'en' = 'zh'): string[] => {
  if (!e) return []
  if (lang === 'en') {
    const rows = sensesOfWord(lemmatize(e.lemma || ''))
    if (rows.length >= 2) {
      const seen = new Set<string>()
      return rows.map((r) => senseLine(r, 'en')).filter((l) => {
        const k = l.toLowerCase()
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
    }
  }
  const list = e.senses?.length ? e.senses : e.dict || []
  const seen = new Set<string>()
  return list.filter((l) => {
    const k = firstSense(l)
    if (!k || !ZH_CHAR_RE.test(k) || /[A-Za-z]/.test(k) || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export interface SubSlot {
  id?: string
  st: number
  unlocked: boolean
  micro: string
  active?: boolean
}

export function mosaicSlotsOf(d: AppState, primaryId: string, defLang: 'zh' | 'en', activeId?: string): SubSlot[] {
  if (isPhraseId(d, primaryId)) return []
  const group = siblingGroupOf(d, primaryId)
  const rows = sensesOfWord(lemmatize(lemmaOf(d, group[0])))
  const rank = (sid: string) => {
    const i = rows.findIndex((r) => r[0] === d.pieces[sid]?.sid)
    return i < 0 ? rows.length : i
  }
  const slots: SubSlot[] = [...group]
    .sort((a, b) => rank(a) - rank(b))
    .map((sid) => ({ id: sid, st: d.learn[sid]?.stage || 1, unlocked: true, micro: microGloss(d.pieces[sid], defLang), active: activeId ? sid === activeId : false }))
  const have = new Set(group.map((sid) => d.pieces[sid]?.sid).filter(Boolean))
  for (const r of rows) {
    if (slots.length >= MOSAIC_MAX) break
    if (r[2] && !have.has(r[0])) slots.push({ st: 0, unlocked: false, micro: '' })
  }
  return slots.length >= 2 ? slots : []
}

export const withGloss = (e: Entry, gloss: string): Entry => {
  const isEn = /[A-Za-z]/.test(gloss) && !ZH_CHAR_RE.test(gloss)
  return {
    ...e,
    sid: undefined,
    gloss,
    en: isEn ? gloss : e.sid ? undefined : e.en,
    ens: e.sid ? undefined : e.ens,
    tile: isEn ? '' : tileOfSense(gloss),
    mean: undefined,
    conf: undefined,
    senses: undefined,
    alt: undefined,
    ai: e.ai?.fam ? { fam: e.ai.fam } : undefined,
  }
}

export function newPieceId(d: AppState, lemma: string) {
  const base = lemma.replace(/[^a-z]+/gi, '_').toLowerCase()
  if (!d.learn[base] && !d.pieces[base]) return base
  let n = 2
  while (d.learn[`${base}~${n}`] || d.pieces[`${base}~${n}`]) n++
  return `${base}~${n}`
}

export function dictSenseOf(lemma: string, pos?: string) {
  const e = dictPeek(lemma)
  const ss = sensesOf(e)
  const best = pos || primaryPos(e, guessPosBySuffix(lemma))
  const hit = ss.find((x) => x.pos === best) || ss[0]
  return { e, lines: glossLines(e), tile: hit ? tileOfSense(hit.text) : '', pos: best }
}

export interface EntryOpts {
  lemma?: string
  pos?: string
}

export function entryFromSurface(surface: string, sent: string, opts: EntryOpts = {}): Entry {
  const e = rawEntry(surface, sent, opts)
  const r = defaultSense(e.lemma, opts.pos || e.pos)
  return r ? withSense(e, r) : e
}

function rawEntry(surface: string, sent: string, opts: EntryOpts): Entry {
  const w = surface.toLowerCase()
  const lemma = opts.lemma || lemmatize(w)
  const lx = lexOf(lemma)
  const pa = lemma === w ? participialOf(w) : null
  const d = dictSenseOf(lemma, opts.pos || pa?.pos)
  const lines = d.lines.length ? d.lines : lx ? [lx[3]] : []
  return {
    lemma,
    ph: phOf(d.e) || lx?.[2] || '',
    pos: opts.pos || pa?.pos || (d.e ? d.pos : lx?.[1]) || guessPosBySuffix(lemma),
    tile: d.e ? d.tile : lx ? tileOfSense(lx[3]) : '',
    form: surface,
    s: sent,
    dict: lines.length ? lines : undefined,
    isParticipialAdj: !!pa,
    etymBase: pa?.base,
    ai: lx?.[4]?.length ? { fam: [...lx[4]] } : undefined,
  }
}

export interface Viewport {
  w: number
  h: number
}

const occupiedAt = (d: AppState, pos: AppState['board']['pos'], x: number, y: number) =>
  boardRootIds(d).some((k) => pos[k] && Math.abs(pos[k].x - x) < 70 && Math.abs(pos[k].y - y) < 70)

export function placeOnBoard(d: AppState, id: string, near?: string, vp: Viewport = { w: 780, h: 640 }): AppState {
  if (isAttachedPhrase(d, id) || d.board.pos[id]) return d
  if (!d.pieces[id]?.detached && !isPhraseId(d, id)) {
    const primary = siblingGroupOf(d, id)[0]
    if (primary && primary !== id && d.board.pos[primary]) return d
  }
  const pos = d.board.pos
  const set = (x: number, y: number) => ({ ...d, board: { ...d.board, pos: { ...pos, [id]: { x, y } } } })
  if (near && pos[near])
    for (const [ux, uy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      const x = pos[near].x + ux * GRID
      const y = pos[near].y + uy * GRID
      if (!occupiedAt(d, pos, x, y)) return set(x, y)
    }
  const pan = d.board.pan
  const z = d.board.zoom || 1
  const cx = (-pan.x + vp.w / 2) / z - GRID / 2
  const cy = (-pan.y + vp.h / 2) / z - GRID / 2
  const c0 = Math.round((cx - 40) / GRID)
  const r0 = Math.round((cy - 60) / GRID)
  const lonely = (x: number, y: number) =>
    !boardRootIds(d).some((k) => k !== id && pos[k] && Math.abs(pos[k].x - x) < GRID * 1.9 && Math.abs(pos[k].y - y) < GRID * 1.9)
  const cands: { x: number; y: number; d: number }[] = []
  for (let dr = -14; dr <= 14; dr++)
    for (let dc = -14; dc <= 14; dc++) {
      const x = 40 + (c0 + dc) * GRID
      const y = 60 + (r0 + dr) * GRID
      if (lonely(x, y)) cands.push({ x, y, d: Math.hypot(x - cx, y - cy) })
    }
  const inView = (c: { x: number; y: number }) => {
    const sx = pan.x + c.x * z
    const sy = pan.y + c.y * z
    return sx >= 8 && sx <= vp.w - GRID * z - 8 && sy >= 30 && sy <= vp.h - GRID * z - 40
  }
  cands.sort((a, b) => Number(inView(b)) - Number(inView(a)) || a.d - b.d)
  return cands[0] ? set(cands[0].x, cands[0].y) : set(cx, cy)
}

export interface PickContext {
  pid: string | null
  wi: number | null
  doc: string
  s: string
  form?: string
  head?: { word: string; wi: number | null; parentId?: string; gloss?: string }
}

export function createPiece(d: AppState, id: string, entry: Entry, reason: Reason, ctx: PickContext, day: Day = today()): AppState {
  const defGoal = d.prefs.defaultGoal === 'use' ? 'use' : 'read'
  const occ: Occurrence = { pid: ctx.pid, wi: ctx.wi ?? undefined, form: entry.form || ctx.form, doc: ctx.pid ? ctx.doc : '', s: ctx.s || entry.s || '', added: day }
  let next: AppState = {
    ...d,
    pieces: { ...d.pieces, [id]: { ...entry, s: entry.s || ctx.s, id } },
    learn: { ...d.learn, [id]: newRecord(reason, [occ], day, defGoal) },
  }
  if (entry.pos !== 'phrase') return placeOnBoard(next, id)
  const plm = entry.parentLemma || phraseHead(entry.members || [entry.lemma])
  const head = ctx.head
  const candidates = piecesOfLemma(next, plm).filter((k) => lemmaOf(next, k) === plm)
  let parent = candidates.find((k) => k === head?.parentId)
  if (!parent) {
    parent = newPieceId(next, plm)
    const headRow = entry.headSid ? senseById(entry.headSid) : undefined
    const peBase = DEMO_ENTRIES[plm] && DEMO_ENTRIES[plm].lemma === plm
      ? { ...DEMO_ENTRIES[plm], form: head?.word || DEMO_ENTRIES[plm].form, s: occ.s }
      : entryFromSurface(head?.word || plm, occ.s, { lemma: plm })
    const pe = headRow ? { ...withSense(peBase, headRow), sidLock: true } : peBase
    next = {
      ...next,
      pieces: { ...next.pieces, [parent]: { ...(head?.gloss ? withGloss(pe, head.gloss) : pe), id: parent } },
      learn: { ...d.learn, [parent]: newRecord('词族关联', [{ ...occ, wi: head?.wi ?? undefined, form: pe.form }], day, defGoal), [id]: next.learn[id] },
    }
    next = placeOnBoard(next, parent)
  } else {
    next = addOccurrence(next, parent, { ...ctx, wi: head?.wi ?? null, form: head?.word }, day)
    if (next.learn[parent].goal === 'stash') next = { ...next, learn: setGoal(next.learn, parent, 'read', day) }
  }
  const kids = next.pieces[parent].childrenIds || []
  return {
    ...next,
    pieces: {
      ...next.pieces,
      [id]: { ...next.pieces[id], parentId: parent },
      [parent]: { ...next.pieces[parent], childrenIds: kids.includes(id) ? kids : [...kids, id] },
    },
  }
}

export function removePiece(d: AppState, id: string): AppState {
  let next = d
  if (!isPhraseId(d, id)) for (const ch of childrenOf(d, id)) next = removePiece(next, ch)
  const sibling = !isPhraseId(next, id) && !next.pieces[id]?.detached
    ? nonDetachedSiblings(next, lemmatize(lemmaOf(next, id))).find((k) => k !== id)
    : undefined
  const learn = { ...next.learn }
  delete learn[id]
  const pieces = { ...next.pieces }
  const parent = pieces[id]?.parentId
  delete pieces[id]
  if (parent && pieces[parent]) pieces[parent] = { ...pieces[parent], childrenIds: (pieces[parent].childrenIds || []).filter((x) => x !== id) }
  const pos = { ...next.board.pos }
  let links = next.board.links
  if (sibling && pos[id] && !pos[sibling]) {
    pos[sibling] = pos[id]
    links = links.map((l) => [l[0] === id ? sibling : l[0], l[1] === id ? sibling : l[1]] as [string, string])
  } else {
    links = links.filter((l) => !l.includes(id))
  }
  delete pos[id]
  return { ...next, learn, pieces, board: { ...next.board, pos, links } }
}

export function addOccurrence(d: AppState, id: string, ctx: PickContext, day: Day = today()): AppState {
  const r = d.learn[id]
  if (!r || r.occ.some((o) => o.pid === ctx.pid && (o.wi != null && ctx.wi != null ? o.wi === ctx.wi : o.s === ctx.s))) return d
  return { ...d, learn: { ...d.learn, [id]: { ...r, occ: [...r.occ, { pid: ctx.pid, wi: ctx.wi ?? undefined, form: ctx.form, doc: ctx.doc, s: ctx.s, added: day }] } } }
}

