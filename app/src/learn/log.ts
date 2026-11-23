import { db } from '../storage/db'

export interface LogInput {
  kind: string
  task: string
  grade: number
  fresh: boolean
  day: string
}

export const logReview = (piece: string, i: LogInput, source: 'forge' | 'read') =>
  void db.reviews
    .add({ at: Date.now(), day: i.day, piece, card: i.kind, task: i.task, grade: i.grade, fresh: i.fresh, source })
    .catch(() => undefined)
