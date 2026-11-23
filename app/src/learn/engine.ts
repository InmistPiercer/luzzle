import { addDays, type Day } from '../core/date'
import type { AppState, CardKind, Evidence, Goal, Grade, LearnRecord, LearnState, Occurrence, Piece, Reason, Sched, Stage } from '../core/types'
import { lemmatize } from '../lang/lemmatize'
import { POLICY_CONFIG as P } from './policy'
import { fallbackPhrases, isLinkedPhrase } from './phrase'
import { isDue, newSched, review, stabilityOf } from './scheduler'

export type Task = 'pick' | 'recall' | 'recallNew' | 'sense' | 'choose' | 'spell' | 'fill' | 'write'

export const emptyEvidence = (): Evidence => ({ rec: [], meaning: [], fresh: [], form: [], use: [] })

export const newRecord = (reason: Reason, occ: Occurrence[], day: Day, goal: Goal = 'read'): LearnRecord => ({
  stage: 1,
  goal,
  reason,
  occ,
  sched: newSched(day),
  ev: emptyEvidence(),
})

const addDay = (list: Day[], day: Day) => (list.includes(day) ? list : [...list, day])

export function deriveStage(r: LearnRecord): Stage {
  const e = r.ev
  const s = stabilityOf(r.sched)
  if (!e.rec.length && !e.meaning.length) return 1
  if (e.meaning.length < P.stage3.days || s < P.stage3.stability) return 2
  if (e.fresh.length < P.stage4.fresh || s < P.stage4.stability) return 3
  if (r.goal !== 'use' || e.form.length < P.stage5.formDays || e.use.length < P.stage5.use) return 4
  return 5
}

const settle = (r: LearnRecord, day: Day): LearnRecord => {
  let next = r
  if (r.goal === 'use' && !r.form && stabilityOf(r.sched) >= P.formStart) next = { ...next, form: { ...newSched(addDays(day, 1)), last: day } }
  return { ...next, stage: deriveStage(next) }
}

export const cardOf = (r: LearnRecord, kind: CardKind) => (kind === 'meaning' ? r.sched : r.form)

export function dueCard(r: LearnRecord, day: Day): CardKind | null {
  if (r.goal === 'stash') return null
  if (r.sched.last === day || r.form?.last === day) return null
  const form = r.goal === 'use' && !!r.form && isDue(r.form, day)
  if (form && (r.formDefer || 0) >= P.formDeferMax) return 'form'
  if (isDue(r.sched, day)) return 'meaning'
  return form ? 'form' : null
}

export function taskFor(r: LearnRecord, kind: CardKind, hasMeaning: boolean, poly = false): { task: Task; hint: boolean } {
  const c = cardOf(r, kind)
  const s = stabilityOf(c)
  const reps = c?.reps || 0
  const odd = reps % 2 === 1
  if (kind === 'meaning') {
    if (s < P.recallAt) return { task: hasMeaning ? 'pick' : 'recall', hint: false }
    if (s < P.freshAt) return { task: 'recall', hint: false }
    if (r.ev.meaning.length < P.stage3.days) return { task: 'recallNew', hint: false }
    if (s < P.mixAt || r.ev.fresh.length < P.stage4.fresh) return { task: poly && odd ? 'sense' : 'recallNew', hint: false }
    const cycle: Task[] = poly ? ['recallNew', 'choose', 'sense'] : ['recallNew', 'choose']
    return { task: cycle[reps % cycle.length], hint: false }
  }
  if (s < P.freshAt) return { task: 'spell', hint: s < P.hintBelow }
  if (s < P.mixAt) return { task: 'fill', hint: false }
  return { task: odd ? 'write' : 'fill', hint: false }
}

export const EASIER: Partial<Record<Task, Task>> = {
  recallNew: 'recall',
  sense: 'pick',
  recall: 'pick',
  choose: 'pick',
  spell: 'choose',
  fill: 'choose',
  write: 'fill',
}

export interface ReviewInput {
  kind: CardKind
  task: Task
  grade: Grade
  fresh: boolean
  day: Day
  verified?: boolean
  sentence?: string
}

export function evidenceFor(ev: Evidence, i: ReviewInput): Evidence {
  if (i.grade === 0) {
    return i.kind === 'meaning'
      ? { ...ev, meaning: ev.meaning.slice(0, -1), fresh: [] }
      : { ...ev, form: ev.form.slice(0, -1), use: [] }
  }
  if (i.grade === 1) return ev
  const out = { ...ev }
  if (i.kind === 'meaning') {
    out.rec = addDay(ev.rec, i.day)
    if (i.task === 'recall' || i.task === 'recallNew' || i.task === 'sense' || i.task === 'choose') out.meaning = addDay(ev.meaning, i.day)
    if (((i.task === 'recallNew' || i.task === 'sense' || i.task === 'choose') && i.fresh) || (i.task === 'recallNew' && !i.fresh && ev.meaning.length >= 3)) {
      out.fresh = addDay(ev.fresh, i.day)
    }
  } else {
    if (i.task === 'spell' || i.task === 'fill' || i.task === 'write') out.form = addDay(ev.form, i.day)
    if (i.task === 'write' && i.verified) out.use = addDay(ev.use, i.day)
  }
  return out
}

function senseDue(r: LearnRecord, p: Piece | undefined, day: Day) {
  const kd = dueCard(r, day)
  return kd === 'meaning' && (p?.senses?.length || 0) >= 2 && taskFor(r, kd, true, true).task === 'sense'
}

export function hasSharedSpell(d: AppState, id: string): boolean {
  const p = d.pieces[id]
  if (!p || p.pos === 'phrase') return false
  const lm = lemmatize(p.lemma)
  return Object.keys(d.learn).some((k) => {
    if (k === id || d.pieces[k]?.pos === 'phrase') return false
    if (lemmatize(d.pieces[k]?.lemma || k) !== lm) return false
    const r = d.learn[k]
    return r.ev.form.length >= 1 || (r.form?.reps ?? 0) >= 1
  })
}

export function applyReview(state: LearnState, id: string, i: ReviewInput, pieces?: Record<string, Piece>): LearnState {
  const r = state[id]
  const c = r && cardOf(r, i.kind)
  if (!r || !c || dueCard(r, i.day) !== i.kind) return state
  const reviewed = review(c, i.grade, i.day)
  let next: LearnRecord = { ...r, ev: evidenceFor(r.ev, i), [i.kind === 'meaning' ? 'sched' : 'form']: reviewed }
  if (i.kind === 'form') next.formDefer = undefined
  if (i.kind === 'form' && (i.grade === 0 || (i.task === 'write' && i.verified))) next.pendingUse = undefined
  if (i.task === 'write' && i.grade === 2 && !i.verified && i.sentence) next.pendingUse = { s: i.sentence, day: i.day }
  const lapse = r.stage === 5 && i.grade === 0
  if (lapse) next.ev = { ...next.ev, form: next.ev.form.slice(0, 2), use: [] }
  const other: CardKind = i.kind === 'meaning' ? 'form' : 'meaning'
  const oc = cardOf(next, other)
  if (oc && (other === 'meaning' || r.goal === 'use') && isDue(oc, i.day)) {
    next = { ...next, [other === 'meaning' ? 'sched' : 'form']: { ...oc, due: addDays(i.day, 1) } }
    if (other === 'form') next.formDefer = (r.formDefer || 0) + 1
  }
  const settled = settle(next, i.day)
  const stage = (lapse ? Math.min(4, settled.stage) : i.grade === 1 ? r.stage : i.grade < 2 ? Math.min(r.stage, settled.stage) : settled.stage) as Stage
  const out: LearnState = { ...state, [id]: { ...settled, stage } }
  if (pieces && pieces[id] && pieces[id].pos !== 'phrase') {
    const lm = lemmatize(pieces[id].lemma)
    for (const otherId of Object.keys(out)) {
      if (otherId === id || pieces[otherId]?.pos === 'phrase') continue
      if (lemmatize(pieces[otherId]?.lemma || otherId) !== lm) continue
      const or = out[otherId]
      if (!or || or.goal === 'stash' || senseDue(or, pieces[otherId], i.day)) continue
      let nextOther = or
      if (isDue(or.sched, i.day)) nextOther = { ...nextOther, sched: { ...or.sched, due: addDays(i.day, 1) } }
      if (or.goal === 'use' && or.form && isDue(or.form, i.day)) nextOther = { ...nextOther, form: { ...or.form, due: addDays(i.day, 1) } }
      if (nextOther !== or) out[otherId] = nextOther
    }
  }
  return out
}

export const pendingUseOf = (r: LearnRecord | undefined, day: Day) => (r?.pendingUse && r.pendingUse.day !== day && dueCard(r, day) === 'form' ? r.pendingUse : null)

export function confirmUse(state: LearnState, id: string, ok: boolean, day: Day): LearnState {
  const r = state[id]
  if (!r) return state
  const keep = r.pendingUse?.day === day ? r.pendingUse : undefined
  const next: LearnRecord = { ...r, pendingUse: keep, ev: ok ? { ...r.ev, use: addDay(r.ev.use, day) } : r.ev }
  return { ...state, [id]: settle(next, day) }
}

export function setGoal(state: LearnState, id: string, goal: Goal, day: Day): LearnState {
  const r = state[id]
  if (!r || r.goal === goal) return state
  return { ...state, [id]: settle({ ...r, goal }, day) }
}

export const isNew = (s: Sched) => s.state === 0

export function forgeQueue(
  learn: LearnState,
  day: Day,
  newCap: number,
  again: ReadonlySet<string> = new Set(),
  pieces?: Record<string, Piece>,
): string[] {
  const all = Object.keys(learn)
  let newLeft = Math.max(0, newCap - all.filter((id) => learn[id].sched.intro === day).length)
  const fresh = (id: string) => isNew(learn[id].sched) && learn[id].sched.intro !== day
  const reviewedLemmas = new Set<string>()
  if (pieces) {
    for (const k of all) {
      if (pieces[k]?.pos === 'phrase') continue
      if (learn[k].sched.last === day || learn[k].form?.last === day) reviewedLemmas.add(lemmatize(pieces[k]?.lemma || k))
    }
  }
  const linked = (id: string) => !!pieces && isLinkedPhrase(pieces, id)
  const ordered = all
    .filter((id) => !linked(id) && (dueCard(learn[id], day) || (again.has(id) && learn[id].goal !== 'stash')))
    .sort(
      (a, b) =>
        Number(again.has(a)) - Number(again.has(b)) ||
        Number(isNew(learn[a].sched)) - Number(isNew(learn[b].sched)) ||
        learn[b].stage - learn[a].stage,
    )
  const seenLemmas = new Set(reviewedLemmas)
  return ordered.filter((id) => {
    const isFresh = fresh(id)
    if (isFresh && newLeft <= 0) return false
    if (pieces && pieces[id] && pieces[id].pos !== 'phrase' && !again.has(id)) {
      const lm = lemmatize(pieces[id].lemma || id)
      if (seenLemmas.has(lm) && !senseDue(learn[id], pieces[id], day)) return false
      seenLemmas.add(lm)
    }
    if (isFresh) newLeft--
    return true
  }).concat(pieces ? fallbackPhrases({ learn, pieces }, day).open : [])
}

export function legacyRecord(stage: number, base: Omit<LearnRecord, 'stage' | 'goal' | 'ev'>, day: Day): LearnRecord {
  const d = (n: number) => addDays(day, -n)
  const ev = emptyEvidence()
  if (stage >= 2) ev.rec = [d(2)]
  if (stage >= 3) ev.meaning = [d(3), d(2)]
  if (stage >= 4) ev.fresh = [d(1)]
  if (stage >= 5) {
    ev.form = [d(3), d(2)]
    ev.use = [d(1)]
  }
  const r: LearnRecord = { ...base, goal: stage >= 4 ? 'use' : 'read', ev, stage: 1 }
  return settle(r, day)
}
