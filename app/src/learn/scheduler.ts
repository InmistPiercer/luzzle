import { createEmptyCard, fsrs, Rating, type Card, type Grade as FsrsGrade } from 'ts-fsrs'
import { addDays, dayStr, dayToDate, diffDays, type Day } from '../core/date'
import type { CardState, Grade, Sched } from '../core/types'
import { POLICY_CONFIG } from './policy'

const engine = fsrs({ request_retention: POLICY_CONFIG.retention, enable_short_term: false, enable_fuzz: false })

const RATING: Record<Grade, FsrsGrade> = { 0: Rating.Again, 1: Rating.Hard, 2: Rating.Good, 3: Rating.Easy }

export const newSched = (day: Day): Sched => ({
  due: day,
  stability: 0,
  difficulty: 0,
  reps: 0,
  lapses: 0,
  state: 0,
})

const toCard = (s: Sched, day: Day): Card => {
  const base = createEmptyCard(dayToDate(day))
  if (s.state === 0) return base
  return {
    ...base,
    due: dayToDate(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    scheduled_days: s.last ? Math.max(0, diffDays(s.due, s.last)) : 0,
    last_review: s.last ? dayToDate(s.last) : undefined,
  }
}

export const review = (s: Sched, grade: Grade, day: Day): Sched => {
  const { card } = engine.next(toCard(s, day), dayToDate(day), RATING[grade])
  if (grade === 1) {
    const floor = s.state === 0 ? 0.5 : s.stability >= POLICY_CONFIG.stage4.stability ? POLICY_CONFIG.stage4.stability : s.stability >= POLICY_CONFIG.stage3.stability ? POLICY_CONFIG.stage3.stability : 0.5
    const stability =
      s.state === 0 ? 0.5 : Math.min(s.stability, Math.max(floor, Number((s.stability * 0.9).toFixed(4))))
    const hardWait = s.state !== 0 && s.stability >= POLICY_CONFIG.mixAt ? Math.min(4, Math.max(2, Math.round(s.stability * 0.2))) : 1
    return {
      due: addDays(day, hardWait),
      stability,
      difficulty: card.difficulty,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state as CardState,
      last: day,
      intro: s.intro ?? day,
    }
  }
  const wait = Math.max(1, diffDays(dayStr(card.due), day))
  return {
    due: addDays(day, wait),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as CardState,
    last: day,
    intro: s.intro ?? day,
  }
}

export const stabilityOf = (s: Sched | undefined) => (s && s.state !== 0 ? s.stability : 0)

export const isDue = (s: Sched, day: Day) => s.due <= day

export interface LegacySched {
  due?: string
  stab?: number
  lapses?: number
  seen?: boolean
  intro?: string
}

export const fromLegacySched = (o: LegacySched | undefined, day: Day): Sched => {
  const due = o?.due || day
  if (!o || !o.seen) return { ...newSched(due), lapses: o?.lapses || 0, intro: o?.intro }
  const stab = Math.max(1, o.stab || 1)
  return {
    due,
    stability: stab,
    difficulty: engine.init_difficulty(Rating.Good),
    reps: 1,
    lapses: o.lapses || 0,
    state: 2,
    last: addDays(due, -Math.round(stab)),
    intro: o.intro,
  }
}
