import { today, type Day } from '../core/date'
import type { AppState, LearnRecord, LearnState, Piece } from '../core/types'
import { lemmatize } from '../lang/lemmatize'

export const PH_DONE = 3
export const PH_LEARNING = 2
export const PH_DAILY = 2
const FROM_STAGE = [0, 0, 1, 1, 2, 3]

export type PhraseTask = 'order' | 'complete' | 'write'
export type PhraseStatus = 'learning' | 'pending' | 'mastered'

export const phN = (r: LearnRecord | undefined) => Math.max(0, Math.min(PH_DONE, r?.ph?.n ?? FROM_STAGE[r?.stage || 1]))

export const isLinkedPhrase = (pieces: Record<string, Piece>, id: string) => {
  const p = pieces[id]
  return p?.pos === 'phrase' && !!p.parentId && !!pieces[p.parentId]
}

export function phrasesOf(d: Pick<AppState, 'pieces' | 'learn'>, parentId: string): string[] {
  const kids = d.pieces[parentId]?.childrenIds || []
  return kids.filter((id) => d.learn[id] && d.pieces[id]?.pos === 'phrase' && d.pieces[id]?.parentId === parentId)
}

export function phraseGroups(d: Pick<AppState, 'pieces' | 'learn'>, parentId: string, holdDay?: Day): Record<PhraseStatus, string[]> {
  const out: Record<PhraseStatus, string[]> = { learning: [], pending: [], mastered: [] }
  for (const id of phrasesOf(d, parentId)) {
    const r = d.learn[id]
    if (phN(r) >= PH_DONE && (!holdDay || r?.ph?.last !== holdDay)) out.mastered.push(id)
    else if (out.learning.length < PH_LEARNING) out.learning.push(id)
    else out.pending.push(id)
  }
  return out
}

const POSS_RE = /^(?:my|your|his|her|its|our|their|one's|someone's)$/i
const REFL_RE = /^(?:myself|yourself|himself|herself|itself|ourselves|yourselves|themselves|oneself)$/i

export const phraseStatus = (d: Pick<AppState, 'pieces' | 'learn'>, id: string, holdDay?: Day): PhraseStatus => {
  const pid = d.pieces[id]?.parentId
  if (!pid) return 'pending'
  const g = phraseGroups(d, pid, holdDay)
  return g.mastered.includes(id) ? 'mastered' : g.learning.includes(id) ? 'learning' : 'pending'
}

export const taskOfPhrase = (r: LearnRecord | undefined): PhraseTask => (['order', 'complete', 'write'] as const)[Math.min(2, phN(r))]

const goalStage = (r: LearnRecord) => (r.goal === 'use' ? 5 : 4)
export const parentAtGoal = (r: LearnRecord | undefined) => !!r && r.goal !== 'stash' && r.stage >= goalStage(r)
export const parentAsks = (r: LearnRecord | undefined) => !!r && r.goal !== 'stash' && r.stage >= 3 && !parentAtGoal(r)

export function phraseFor(d: Pick<AppState, 'pieces' | 'learn'>, parentId: string, day: Day): string | null {
  const learning = phraseGroups(d, parentId, day).learning
  const doneToday = learning.find((id) => d.learn[id].ph?.last === day)
  if (doneToday) return doneToday
  const seenFirst = (id: string) => {
    const p = d.learn[id].ph
    return p?.seen && (!p.last || p.seen > p.last) ? p.seen : ''
  }
  const ranked = [...learning].sort(
    (a, b) =>
      (seenFirst(b) > seenFirst(a) ? 1 : seenFirst(b) < seenFirst(a) ? -1 : 0) ||
      phN(d.learn[a]) - phN(d.learn[b]) ||
      ((d.learn[a].ph?.last || '') < (d.learn[b].ph?.last || '') ? -1 : (d.learn[a].ph?.last || '') > (d.learn[b].ph?.last || '') ? 1 : 0),
  )
  return ranked[0] || null
}

export function fallbackPhrases(d: Pick<AppState, 'pieces' | 'learn'>, day: Day): { done: string[]; open: string[] } {
  const cand: string[] = []
  for (const pid of Object.keys(d.learn)) {
    if (!parentAtGoal(d.learn[pid]) || !d.pieces[pid]) continue
    cand.push(...phraseGroups(d, pid, day).learning)
  }
  const done = cand.filter((id) => d.learn[id].ph?.last === day)
  const open = cand
    .filter((id) => d.learn[id].ph?.last !== day && phN(d.learn[id]) < PH_DONE)
    .sort((a, b) => ((d.learn[a].ph?.last || '') < (d.learn[b].ph?.last || '') ? -1 : 1))
    .slice(0, Math.max(0, PH_DAILY - done.length))
  return { done, open }
}

export function applyPhrase(learn: LearnState, id: string, ok: boolean, day: Day): LearnState {
  const r = learn[id]
  if (!r || r.ph?.last === day) return learn
  const n = phN(r)
  return { ...learn, [id]: { ...r, ph: { ...r.ph, n: ok ? Math.min(PH_DONE, n + 1) : Math.max(0, n - 1), last: day } } }
}

export function seePhrase(learn: LearnState, id: string, day: Day): LearnState {
  const r = learn[id]
  if (!r || r.ph?.seen === day) return learn
  return { ...learn, [id]: { ...r, ph: { n: phN(r), ...r.ph, seen: day } } }
}

export const phraseTokens = (lemma: string) =>
  lemma
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[…]|\.{3}/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9'-]/g, ''))
    .filter(Boolean)

export function maskPhrase(s: string, lemma: string): string | null {
  const toks = phraseTokens(lemma)
  if (!toks.length || !s) return null
  const tLems = toks.map(lemmatize)
  const words = [...s.matchAll(/[A-Za-z0-9’']+(?:-[A-Za-z0-9’']+)*/g)].map((m) => ({ w: m[0].toLowerCase().replace(/’/g, "'"), start: m.index as number, end: (m.index as number) + m[0].length }))
  const fits = (w: string, i: number) =>
    w === toks[i] ||
    lemmatize(w) === tLems[i] ||
    (toks[i] === "one's" && (POSS_RE.test(w) || w.endsWith("'s") || w.endsWith("s'"))) ||
    (toks[i] === 'oneself' && REFL_RE.test(w))
  const find = (ti: number, from: number, prev: number): number[] | null => {
    if (ti === toks.length) return []
    for (let wi = from; wi < words.length; wi++) {
      if (prev >= 0 && wi - prev > 5) break
      if (!fits(words[wi].w, ti)) continue
      const rest = find(ti + 1, wi + 1, wi)
      if (rest) return [wi, ...rest]
    }
    return null
  }
  const hit = find(0, 0, -1)
  if (!hit) return null
  let out = ''
  let pos = 0
  for (const wi of hit) {
    out += s.slice(pos, words[wi].start) + '___'
    pos = words[wi].end
  }
  return out + s.slice(pos)
}

export const blankOf = (lemma: string, core: string) => {
  const toks = phraseTokens(lemma)
  const c = core.toLowerCase()
  const pick = toks
    .map((t, i) => [t, i] as const)
    .filter(([t]) => t !== "one's" && t !== 'oneself' && !c.startsWith(t.slice(0, 4)) && !t.startsWith(c.slice(0, 4)))
  const best = (pick.length ? pick : toks.map((t, i) => [t, i] as const)).sort((a, b) => b[0].length - a[0].length)[0]
  return best ? best[1] : 0
}

export function accOf(d: Pick<AppState, 'pieces' | 'learn'>, parentIds: string[], hlId?: string | null, holdDay: Day = today()) {
  const learning: string[] = []
  let pending = 0
  for (const pid of parentIds) {
    const g = phraseGroups(d, pid, holdDay)
    learning.push(...g.learning)
    pending += g.pending.length
  }
  if (!learning.length) return null
  const shown = learning.slice(0, PH_LEARNING)
  const hl = hlId ? shown.indexOf(hlId) : -1
  return { det: shown.map((id) => phN(d.learn[id])), more: pending + learning.length - shown.length, hl: hl >= 0 ? hl : undefined }
}
