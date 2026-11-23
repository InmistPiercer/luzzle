import { describe, expect, it } from 'vitest'
import { addDays } from '../core/date'
import type { LearnRecord, LearnState, Sched } from '../core/types'
import { applyReview, confirmUse, deriveStage, dueCard, evidenceFor, forgeQueue, legacyRecord, newRecord, pendingUseOf, setGoal, taskFor, type ReviewInput } from './engine'
import { newSched, review } from './scheduler'

const D0 = '2026-11-16'
const rec = (over: Partial<LearnRecord> = {}): LearnRecord => ({ ...newRecord('生词初见', [], D0), ...over })
const withS = (stability: number, day = D0): Sched => ({ ...newSched(day), state: 2, stability, difficulty: 5, reps: 3, last: addDays(day, -stability) })
const rv = (over: Partial<ReviewInput>): ReviewInput => ({ kind: 'meaning', task: 'pick', grade: 2, fresh: false, day: D0, ...over })

describe('review', () => {
  it('schedules Again for a later day and Good by FSRS', () => {
    const s1 = review(newSched(D0), 2, D0)
    expect(s1.due > D0).toBe(true)
    const s2 = review(s1, 0, s1.due)
    expect(s2.due > s1.due).toBe(true)
    expect(s2.lapses).toBe(1)
  })

  it('caps stability and schedules next day on Hard (grade 1)', () => {
    const s0 = newSched(D0)
    const h0 = review(s0, 1, D0)
    expect(h0.stability).toBe(0.5)
    expect(h0.due).toBe(addDays(D0, 1))
    expect(h0.last).toBe(D0)
    expect(h0.intro).toBe(D0)

    const sRev = withS(10, D0)
    const h1 = review(sRev, 1, D0)
    expect(h1.stability).toBe(9)
    expect(h1.stability).toBeLessThanOrEqual(sRev.stability)
    expect(h1.due).toBe(addDays(D0, 1))

    const sLow = withS(0.3, D0)
    const hLow = review(sLow, 1, D0)
    expect(hLow.stability).toBeLessThanOrEqual(sLow.stability)

    const sMature = withS(20, D0)
    const hMature = review(sMature, 1, D0)
    expect(hMature.stability).toBe(18)
    expect(hMature.due).toBe(addDays(D0, 4))
  })
})

describe('task policy', () => {
  it('moves from recognition to recall to new sentences as stability grows', () => {
    expect(taskFor(rec(), 'meaning', true).task).toBe('pick')
    expect(taskFor(rec(), 'meaning', false).task).toBe('recall')
    expect(taskFor(rec({ sched: withS(3) }), 'meaning', true).task).toBe('recall')
    expect(taskFor(rec({ sched: withS(8) }), 'meaning', true).task).toBe('recallNew')
    expect(taskFor(rec({ sched: withS(20) }), 'meaning', true).task).toBe('recallNew')
    const rMean = rec({ sched: withS(20), ev: { rec: ['2026-11-10'], meaning: ['2026-11-10', '2026-11-13'], fresh: [], form: [], use: [] } })
    expect(taskFor(rMean, 'meaning', true, false).task).toBe('recallNew')
    expect(taskFor(rMean, 'meaning', true, true).task).toBe('sense')
    const rFresh = { ...rMean, ev: { ...rMean.ev, fresh: ['2026-11-14'] } }
    expect(['recallNew', 'choose']).toContain(taskFor(rFresh, 'meaning', true).task)
    expect(taskFor(rec({ form: newSched(D0) }), 'form', true)).toEqual({ task: 'spell', hint: true })
    expect(taskFor(rec({ form: withS(8) }), 'form', true).task).toBe('fill')
  })
})

describe('evidence and stages', () => {
  it('derives the visual stage from evidence and stability', () => {
    let st: LearnState = { w: rec() }
    expect(st.w.stage).toBe(1)
    st = applyReview(st, 'w', rv({ task: 'pick' }))
    expect(st.w.stage).toBe(2)
    expect(st.w.ev.rec).toEqual([D0])
    const r3 = { ...st.w, sched: withS(7), ev: { ...st.w.ev, meaning: ['2026-11-10', '2026-11-13'] } }
    expect(deriveStage(r3)).toBe(3)
    const r4 = { ...r3, sched: withS(13), ev: { ...r3.ev, fresh: ['2026-11-14'] } }
    expect(deriveStage(r4)).toBe(4)
    expect(deriveStage({ ...r4, goal: 'use', ev: { ...r4.ev, form: ['a', 'b'], use: ['c'] } })).toBe(5)
  })

  it('does not count a failure or a non-fresh sentence as new-sentence evidence', () => {
    let st: LearnState = { w: rec({ sched: withS(8) }) }
    st = applyReview(st, 'w', rv({ task: 'recallNew', fresh: false }))
    expect(st.w.ev.fresh).toEqual([])
    expect(st.w.ev.meaning).toEqual([D0])
    st = applyReview(st, 'w', rv({ task: 'recallNew', fresh: true, grade: 0 }))
    expect(st.w.ev.fresh).toEqual([])
    expect(st.w.sched.due > D0).toBe(true)
  })

  it('keeps evidence unchanged and does not promote or raise stability on grade 1', () => {
    let s1: LearnState = { w: rec() }
    s1 = applyReview(s1, 'w', rv({ task: 'pick', grade: 1 }))
    expect(s1.w.stage).toBe(1)
    expect(s1.w.ev.rec).toEqual([])
    expect(s1.w.sched.stability).toBe(0.5)
    expect(s1.w.sched.due).toBe(addDays(D0, 1))

    const s8 = withS(8)
    let st: LearnState = { w: rec({ stage: 2, sched: s8, ev: { rec: ['2026-11-10'], meaning: ['2026-11-10'], fresh: [], form: [], use: [] } }) }
    st = applyReview(st, 'w', rv({ task: 'recallNew', fresh: true, grade: 1 }))
    expect(st.w.ev.rec).toEqual(['2026-11-10'])
    expect(st.w.ev.meaning).toEqual(['2026-11-10'])
    expect(st.w.ev.fresh).toEqual([])
    expect(st.w.sched.stability).toBeLessThanOrEqual(s8.stability)
    expect(st.w.stage).toBe(2)

    const r3 = { ...st.w, stage: 3 as const, sched: withS(14), ev: { ...st.w.ev, meaning: ['2026-11-10', '2026-11-13'] } }
    expect(deriveStage(r3)).toBe(3)
    const evAfterHard = evidenceFor(r3.ev, rv({ task: 'recallNew', fresh: true, grade: 1, day: '2026-11-17' }))
    expect(evAfterHard).toEqual(r3.ev)
    expect(deriveStage({ ...r3, ev: evAfterHard })).toBe(3)
    const formHard = evidenceFor(r3.ev, rv({ kind: 'form', task: 'write', fresh: true, grade: 1, day: '2026-11-17' }))
    expect(formHard).toEqual(r3.ev)
  })

  it('rolls back meaning/fresh or form/use evidence on grade 0 and never raises stage', () => {
    const evM = { rec: ['2026-11-01', '2026-11-03'], meaning: ['2026-11-01', '2026-11-03'], fresh: ['2026-11-03'], form: ['2026-11-06'], use: ['2026-11-06'] }
    const afterM = evidenceFor(evM, rv({ kind: 'meaning', task: 'recallNew', fresh: true, grade: 0 }))
    expect(afterM.meaning).toEqual(['2026-11-01'])
    expect(afterM.fresh).toEqual([])
    expect(afterM.form).toEqual(['2026-11-06'])

    const afterF = evidenceFor(evM, rv({ kind: 'form', task: 'fill', fresh: true, grade: 0 }))
    expect(afterF.form).toEqual([])
    expect(afterF.use).toEqual([])
    expect(afterF.meaning).toEqual(['2026-11-01', '2026-11-03'])

    const st = applyReview({ w: rec({ stage: 4, sched: withS(13), ev: evM }) }, 'w', rv({ kind: 'meaning', task: 'recallNew', grade: 0 }))
    expect(st.w.stage).toBeLessThanOrEqual(4)
    expect(st.w.ev.fresh).toEqual([])
    expect(st.w.ev.meaning).toEqual(['2026-11-01'])
  })

  it('opens the form card for use goals once meaning is stable and keeps cards independent', () => {
    let st: LearnState = { w: rec({ sched: withS(3) }) }
    st = setGoal(st, 'w', 'use', D0)
    expect(st.w.form).toBeUndefined()
    st = { w: { ...st.w, sched: { ...withS(7), due: addDays(D0, 5) } } }
    st = setGoal(setGoal(st, 'w', 'read', D0), 'w', 'use', D0)
    expect(st.w.form?.due).toBe(addDays(D0, 1))
    const meaning = st.w.sched
    const day = addDays(D0, 1)
    st = applyReview(st, 'w', rv({ kind: 'form', task: 'spell', grade: 0, day }))
    expect(st.w.sched).toEqual(meaning)
    expect(st.w.form?.lapses).toBe(0)
  })

  it('defers a sibling card that is due on the same day', () => {
    const st: LearnState = { w: rec({ goal: 'use', sched: withS(7, '2026-11-01'), form: { ...withS(3), due: D0 } }) }
    st.w.sched = { ...st.w.sched, due: D0 }
    const out = applyReview(st, 'w', rv({ task: 'recallNew' }))
    expect(out.w.form?.due).toBe(addDays(D0, 1))
    expect(out.w.formDefer).toBe(1)
  })

  it('defers the first-ever form exercise and rejects a second graded track that day', () => {
    const w = rec({ goal: 'use', sched: withS(8), form: newSched(D0) })
    const out = applyReview({ w }, 'w', rv({ task: 'recall' }))
    expect(out.w.form?.due).toBe(addDays(D0, 1))
    expect(dueCard(out.w, D0)).toBeNull()
    expect(applyReview(out, 'w', rv({ kind: 'form', task: 'spell' }))).toBe(out)
  })

  it('drops gold on a form failure and rolls back form and use evidence', () => {
    const ev = { rec: ['2026-11-01'], meaning: ['2026-11-01', '2026-11-03'], fresh: ['2026-11-03'], form: ['2026-11-06', '2026-11-08'], use: ['2026-11-08'] }
    const w = rec({ stage: 5, goal: 'use', sched: withS(13, addDays(D0, 3)), form: withS(7), ev })
    const out = applyReview({ w }, 'w', rv({ kind: 'form', task: 'fill', grade: 0 }))
    expect(out.w.stage).toBe(4)
    expect(out.w.ev).toEqual({ ...ev, form: ['2026-11-06'], use: [] })
  })

  it('regresses Stage 5 to at most Stage 4 on a meaning lapse, rolls back meaning evidence and keeps form.last on unlock', () => {
    const ev = {
      rec: ['2026-11-01'],
      meaning: ['2026-11-01', '2026-11-03'],
      fresh: ['2026-11-03'],
      form: ['2026-11-05', '2026-11-06', '2026-11-08'],
      use: ['2026-11-08'],
    }
    const w = rec({ stage: 5, goal: 'use', sched: withS(13, D0), form: withS(7, addDays(D0, 2)), ev })
    const outM = applyReview({ w }, 'w', rv({ kind: 'meaning', task: 'recallNew', grade: 0 }))
    expect(outM.w.stage).toBe(Math.min(4, deriveStage(outM.w)))
    expect(outM.w.stage).toBeLessThanOrEqual(2)
    expect(outM.w.ev.use).toEqual([])
    expect(outM.w.ev.form).toEqual(['2026-11-05', '2026-11-06'])
    expect(outM.w.ev.meaning).toEqual(['2026-11-01'])
    expect(outM.w.ev.fresh).toEqual([])

    const unlocked = setGoal({ w: rec({ sched: withS(7), goal: 'read' }) }, 'w', 'use', D0)
    expect(unlocked.w.form?.last).toBe(D0)
    expect(dueCard(unlocked.w, D0)).toBeNull()
  })

  it('puts the form card first after it was deferred twice', () => {
    const w = rec({ goal: 'use', sched: { ...withS(7, '2026-11-01'), due: D0 }, form: { ...withS(3), due: D0 }, formDefer: 1 })
    expect(dueCard(w, D0)).toBe('meaning')
    const st = applyReview({ w }, 'w', rv({ task: 'recallNew' }))
    const d1 = addDays(D0, 1)
    const w2 = { ...st.w, sched: { ...st.w.sched, due: d1 } }
    expect(st.w.formDefer).toBe(2)
    expect(dueCard(w2, d1)).toBe('form')
    const after = applyReview({ w: w2 }, 'w', rv({ kind: 'form', task: 'spell', day: d1 }))
    expect(after.w.formDefer).toBeUndefined()
    expect(after.w.sched.due).toBe(addDays(d1, 1))
  })
})

describe('use evidence', () => {
  const ev = { rec: ['2026-11-01'], meaning: ['2026-11-01', '2026-11-03'], fresh: ['2026-11-03'], form: ['2026-11-06', '2026-11-08'], use: [] as string[] }
  const gold = () => rec({ stage: 4, goal: 'use', sched: withS(20, addDays(D0, 40)), form: { ...withS(8), due: D0 }, ev })

  it('counts a fresh fill as form evidence only', () => {
    const out = evidenceFor(ev, rv({ kind: 'form', task: 'fill', fresh: true }))
    expect(out.form).toContain(D0)
    expect(out.use).toEqual([])
  })

  it('reaches stage 5 from an AI-verified sentence', () => {
    const out = applyReview({ w: gold() }, 'w', rv({ kind: 'form', task: 'write', verified: true }))
    expect(out.w.ev.use).toEqual([D0])
    expect(out.w.stage).toBe(5)
    expect(out.w.pendingUse).toBeUndefined()
  })

  it('keeps an offline sentence pending and confirms it on a later day', () => {
    const out = applyReview({ w: gold() }, 'w', rv({ kind: 'form', task: 'write', sentence: 'My habit is reading before bed every night.' }))
    expect(out.w.ev.form).toContain(D0)
    expect(out.w.ev.use).toEqual([])
    expect(out.w.stage).toBe(4)
    expect(out.w.pendingUse).toEqual({ s: 'My habit is reading before bed every night.', day: D0 })
    expect(pendingUseOf(out.w, D0)).toBeNull()
    const D1 = out.w.form!.due
    expect(pendingUseOf(out.w, D1)?.s).toBe('My habit is reading before bed every night.')
    const ok = confirmUse(out, 'w', true, D1)
    expect(ok.w.ev.use).toEqual([D1])
    expect(ok.w.stage).toBe(5)
    expect(ok.w.pendingUse).toBeUndefined()
    const no = confirmUse(out, 'w', false, D1)
    expect(no.w.ev.use).toEqual([])
    expect(no.w.pendingUse).toBeUndefined()
  })

  it('drops a pending sentence when the form card is failed', () => {
    const pending = { ...gold(), pendingUse: { s: 'x', day: addDays(D0, -2) } }
    const out = applyReview({ w: pending }, 'w', rv({ kind: 'form', task: 'fill', grade: 0 }))
    expect(out.w.pendingUse).toBeUndefined()
  })
})

describe('same-lemma senses', () => {
  const pieces = {
    a: { id: 'a', lemma: 'scale', pos: 'n.', senses: ['n. 规模', 'n. 鳞片'] },
    b: { id: 'b', lemma: 'scale', pos: 'n.', senses: ['n. 规模', 'n. 鳞片'] },
  } as never
  const ev = { rec: ['2026-11-01'], meaning: ['2026-11-01', '2026-11-03'], fresh: [], form: [], use: [] }

  it('does not defer a sibling that is due for sense discrimination and leaves formDefer alone', () => {
    const a = rec({ sched: { ...withS(8), due: D0 }, ev })
    const b = rec({ goal: 'use', sched: { ...withS(8), due: D0 }, form: { ...withS(3), due: D0 }, formDefer: 1, ev })
    expect(taskFor(b, 'meaning', true, true).task).toBe('sense')
    const out = applyReview({ a, b }, 'a', rv({ task: 'recall' }), pieces)
    expect(out.b.sched.due).toBe(D0)
    expect(forgeQueue(out, D0, 10, new Set(), pieces)).toContain('b')
    const plain = { ...b, sched: { ...withS(3), due: D0 } }
    const out2 = applyReview({ a, b: plain }, 'a', rv({ task: 'recall' }), pieces)
    expect(out2.b.sched.due).toBe(addDays(D0, 1))
    expect(out2.b.formDefer).toBe(1)
  })
})

describe('queue', () => {
  it('skips stashed pieces and respects the daily new cap', () => {
    const learn: LearnState = { a: rec(), b: rec(), c: rec({ goal: 'stash' }), d: rec({ sched: { ...withS(3), due: D0 } }) }
    expect(dueCard(learn.c, D0)).toBeNull()
    const q = forgeQueue(learn, D0, 1)
    expect(q).toContain('d')
    expect(q).not.toContain('c')
    expect(q.filter((x) => x === 'a' || x === 'b')).toHaveLength(1)
    const later = { ...learn.d, sched: { ...learn.d.sched, due: '2026-11-20' } }
    expect(forgeQueue({ d: later }, D0, 1, new Set(['d']))).toEqual(['d'])
    expect(forgeQueue({ d: later }, D0, 1)).toEqual([])
  })

  it('maps legacy stages to goals and evidence', () => {
    const base = { reason: '生词初见' as const, occ: [], sched: withS(13) }
    expect(legacyRecord(1, base, D0)).toMatchObject({ goal: 'read', stage: 1 })
    expect(legacyRecord(4, base, D0)).toMatchObject({ goal: 'use', stage: 4 })
    expect(legacyRecord(5, base, D0).stage).toBe(5)
  })

  it('unlocks Stage 4 offline when a word without a second sentence passes four distinct days of recall', () => {
    const w = rec({
      stage: 3,
      sched: withS(14),
      ev: { rec: ['2026-11-01'], meaning: ['2026-11-01', '2026-11-04', '2026-11-09'], fresh: [], form: [], use: [] },
    })
    const out = applyReview({ w }, 'w', rv({ task: 'recallNew', fresh: false, day: D0 }))
    expect(out.w.ev.fresh).toEqual([D0])
    expect(out.w.stage).toBe(4)
  })

  it('never demotes stage on Hard even right above a stage threshold', () => {
    const s3 = rec({
      stage: 3,
      sched: { ...withS(6.2), due: D0 },
      ev: { rec: ['2026-11-01'], meaning: ['2026-11-01', '2026-11-05'], fresh: [], form: [], use: [] },
    })
    const out3 = applyReview({ w: s3 }, 'w', rv({ task: 'recallNew', grade: 1, day: D0 }))
    expect(out3.w.stage).toBe(3)
    expect(out3.w.sched.stability).toBe(6)

    const s5 = rec({
      stage: 5,
      goal: 'use',
      sched: { ...withS(12.3), due: D0 },
      form: { ...withS(8), due: D0 },
      ev: { rec: ['2026-11-01'], meaning: ['2026-11-01', '2026-11-03'], fresh: ['2026-11-03'], form: ['2026-11-06', '2026-11-08'], use: ['2026-11-09'] },
    })
    const out5 = applyReview({ w: s5 }, 'w', rv({ task: 'recallNew', grade: 1, day: D0 }))
    expect(out5.w.stage).toBe(5)
    expect(out5.w.sched.stability).toBe(12)
  })
})
