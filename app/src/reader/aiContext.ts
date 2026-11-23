import type { AppState, EntryAI, SentenceAI } from '../core/types'
import { posOfTag, stripTag, tileOfSense } from '../lang/lexdict'
import { sensesOfWord, withSense as applySense } from '../lang/senses'

export interface MeetAI extends EntryAI {
  match?: number
  reason?: string
}

export const ctxKey = (lm: string, s: string) => `ctx2|${lm}|${s}`
export const meetKey = (cands: string[], s: string) => `meet|${cands.join(',')}|${s}`

export const sentencePart = (a: EntryAI | MeetAI | null | undefined, withSense = false): SentenceAI | undefined =>
  a && (a.tr || a.st || a.ex || a.zh) ? { tr: a.tr || '', st: a.st || '', ex: a.ex || '', zh: a.zh || '', ...(withSense && Number(a.sense) > 0 ? { sense: Number(a.sense) } : {}) } : undefined

export const senseList = (a: EntryAI | null | undefined) =>
  Array.isArray(a?.senses) ? a.senses.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 4) : []

const VALID_POS = new Set(['v.', 'n.', 'adj.', 'adv.'])
export const META_GLOSS_RE = /词义未定|歧义|词项讨论|元语言|多义并举|metalinguistic|ambiguous\s+meaning/i

export const isMetaAI = (a: EntryAI | MeetAI | null | undefined) =>
  !!(a && (a.meta || META_GLOSS_RE.test(`${a.zh || ''} ${a.en || ''} ${(a as MeetAI).reason || ''}`)))

export const hasAISense = (d: AppState, id: string) => !!d.pieces[id]?.ai?.en

export function attachAI(d: AppState, id: string, pid: string | null, a: EntryAI | MeetAI | null | undefined, withSense: boolean, wi?: number): AppState {
  const piece = d.pieces[id]
  const rec = d.learn[id]
  if (!a || !piece || !rec) return d
  const allowSense = withSense && !isMetaAI(a)
  let pieces = d.pieces
  const list = senseList(a)
  const chosen = list[Number(a.sense) - 1] || ''
  const general = chosen ? stripTag(chosen) : a.zh || ''
  const rows = sensesOfWord(piece.lemma)
  if (allowSense && rows.length && !hasAISense(d, id)) {
    const r = piece.sidLock ? undefined : rows[Number(a.sense) - 1]
    const base = r ? applySense(piece, r) : piece
    pieces = { ...pieces, [id]: { ...base, ai: { ...piece.ai, zh: a.zh || '', en: a.en || '', fam: a.fam?.length ? a.fam : piece.ai?.fam || [] } } }
  } else if (allowSense && !piece.gloss && !hasAISense(d, id) && general) {
    const tagPos = posOfTag(chosen)
    pieces = {
      ...pieces,
      [id]: {
        ...piece,
        senses: list.length ? list : piece.senses,
        tile: tileOfSense(general) || piece.tile,
        pos: piece.pos === 'phrase' ? piece.pos : tagPos || (VALID_POS.has(a.pos || '') ? a.pos : piece.pos),
        ai: { ...piece.ai, zh: general, en: a.en || '', fam: a.fam?.length ? a.fam : piece.ai?.fam || [] },
      },
    }
  }
  const sp = sentencePart(isMetaAI(a) ? { ...a, zh: '' } : a, allowSense && (list.length > 0 || rows.length > 0))
  const index = occurrenceIndex(rec.occ, pid, wi)
  const occ = sp ? rec.occ.map((o, i) => (i === index && !o.ai ? { ...o, ai: sp } : o)) : rec.occ
  return { ...d, pieces, learn: { ...d.learn, [id]: { ...rec, occ } } }
}

function occurrenceIndex(occ: AppState['learn'][string]['occ'], pid: string | null, wi?: number) {
  const exact = occ.findIndex((o) => o.pid === pid && (wi == null || o.wi === wi))
  return exact >= 0 ? exact : occ.findIndex((o) => o.pid === pid && o.wi == null)
}

export function occurrenceAI(d: AppState, id: string, pid: string | null, wi?: number): SentenceAI | undefined {
  const rec = d.learn[id]
  if (!rec) return undefined
  const i = occurrenceIndex(rec.occ, pid, wi)
  if (i < 0) return undefined
  if (rec.occ[i].ai) return rec.occ[i].ai
  return i === 0 ? sentencePart({ ...d.pieces[id]?.ai, zh: '' }) : undefined
}

export function dockAI(d: AppState, id: string, pid: string | null, wi?: number): EntryAI {
  const base = d.pieces[id]?.ai || {}
  const sent = occurrenceAI(d, id, pid, wi)
  return { zh: d.pieces[id]?.gloss || sent?.zh || base.zh, en: base.en, fam: base.fam, tr: sent?.tr || '', st: sent?.st || '', ex: sent?.ex || (sent ? '' : base.ex || '') }
}
