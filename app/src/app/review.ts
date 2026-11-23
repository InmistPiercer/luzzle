import { today } from '../core/date'
import type { Goal } from '../core/types'
import { applyReview, setGoal, type ReviewInput } from '../learn/engine'
import { logReview } from '../learn/log'
import { useApp } from './store'

export function setPieceGoal(id: string, goal: Goal) {
  useApp.getState().setLearn((l) => setGoal(l, id, goal, today()))
  if (goal === 'stash') useApp.getState().markAgain(id, false)
}

export function recordReview(id: string, i: ReviewInput, source: 'forge' | 'read') {
  const state = useApp.getState()
  const next = applyReview(state.data.learn, id, i, state.data.pieces)
  if (next === state.data.learn) return false
  state.setLearn(() => next)
  logReview(id, i, source)
  return true
}
