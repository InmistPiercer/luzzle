import type { Day } from './date'
import { emptyState, type AppState } from './types'
import { seedDemo } from '../content/seed'

export const IS_TEST = import.meta.env.MODE === 'test'

export const cleanState = (): AppState => ({
  ...emptyState(),
  vaults: [{ name: '我的仓库' }],
  extra: { noDemo: true, demoAsked: true },
})

export const initialState = (day: Day, test = IS_TEST): AppState => (test ? seedDemo(day) : cleanState())
