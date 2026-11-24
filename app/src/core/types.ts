import type { Day } from './date'

export type Stage = 1 | 2 | 3 | 4 | 5

export type Reason = '生词初见' | '熟词新义' | '词族关联'

export type Grade = 0 | 1 | 2 | 3

export type CardState = 0 | 1 | 2 | 3

export interface Sched {
  due: Day
  stability: number
  difficulty: number
  reps: number
  lapses: number
  state: CardState
  last?: Day
  intro?: Day
}

export interface SentenceAI {
  tr?: string
  st?: string
  ex?: string
  zh?: string
  sense?: number
}

export interface Occurrence {
  pid: string | null
  wi?: number
  form?: string
  added?: Day
  reviewed?: boolean
  doc: string
  s: string
  ai?: SentenceAI
}

export type PosTag = 'v.' | 'n.' | 'adj.' | 'adv.' | 'phrase' | 'func.'

export interface EntryAI {
  zh?: string
  pos?: string
  senses?: string[]
  sense?: number
  meta?: boolean
  en?: string
  ex?: string
  tr?: string
  st?: string
  fam?: string[]
}

export type SenseRow = [sid: string, pos: string, core: number, zhShort: string, zhDef: string, enShort: string, enDef: string, ex1: string, ex2: string]

export interface Entry {
  lemma: string
  sid?: string
  sidLock?: boolean
  gloss?: string
  en?: string
  ens?: string
  ph?: string
  pos?: PosTag | string
  tile?: string
  form?: string
  s?: string
  mean?: string[]
  dict?: string[]
  conf?: { opts: string[]; why: string }
  alt?: { s: string; a?: string[]; k?: number }[]
  senses?: string[]
  ai?: EntryAI
  ans?: string
  parentLemma?: string
  headSid?: string
  parentId?: string
  members?: string[]
  src?: string
  isParticipialAdj?: boolean
  etymBase?: string
  detached?: boolean
}

export interface Piece extends Entry {
  id: string
  childrenIds?: string[]
}

export type ParaKind = 'para' | 'standfirst' | 'abstract' | 'list' | 'caption' | 'equation' | 'back' | 'code'

export interface Para {
  id?: string
  pg?: number
  raw?: string
  t?: string
  junk?: string
  h?: string
  kind?: ParaKind
  fb?: boolean
}

export type TrMode = 'src' | 'bi' | 'tr'

export interface DocData {
  id: string
  title: string
  vault: number
  rebuilt: boolean
  cachedRebuilt: boolean
  paras: Para[]
  user?: boolean
  page?: number
  aiChunks?: { pages: number[]; text: string }[]
  parasRule?: Para[]
  parasAI?: Para[]
  aiDone?: number[]
  aiFailed?: number
  tr?: TrMode
}

export type Goal = 'stash' | 'read' | 'use'

export type CardKind = 'meaning' | 'form'

export interface Evidence {
  rec: Day[]
  meaning: Day[]
  fresh: Day[]
  form: Day[]
  use: Day[]
}

export interface LearnRecord {
  stage: Stage
  goal: Goal
  reason: Reason
  occ: Occurrence[]
  sched: Sched
  form?: Sched
  formDefer?: number
  pendingUse?: { s: string; day: string }
  ev: Evidence
  ph?: PhraseProg
}

export interface PhraseProg {
  n: number
  last?: Day
  seen?: Day
}

export type LearnState = Record<string, LearnRecord>

export interface BoardState {
  pos: Record<string, { x: number; y: number }>
  links: [string, string][]
  pan: { x: number; y: number }
  zoom?: number
}

export type StyleId = 'classic' | 'amber' | 'neon' | 'draft'

export type PageLen = 'short' | 'mid' | 'long' | 'none'

export interface Prefs {
  style: StyleId
  palette?: string
  fs: number
  ww: number
  pageLen?: PageLen
  defLang?: 'zh' | 'en'
  defaultGoal?: 'read' | 'use'
}

export interface Mark {
  hl?: string
}

export interface Vault {
  name: string
}

export interface UserDoc {
  id: string
  title: string
  [k: string]: unknown
}

export interface AppState {
  version: 7
  pieces: Record<string, Piece>
  learn: LearnState
  board: BoardState
  marks: Record<string, Mark>
  morph: unknown
  prefs: Prefs
  vaults: Vault[]
  curVault: number
  docs: UserDoc[]
  docState: unknown[]
  caps: { daily: number; newDaily: number }
  dayOffset: number
  extra: Record<string, unknown>
  mlearn?: Record<string, unknown>
  msense?: Record<string, number>
  senseR?: Record<string, SenseRow[]>
}

export const emptyState = (): AppState => ({
  version: 7,
  pieces: {},
  learn: {},
  board: { pos: {}, links: [], pan: { x: 0, y: 0 } },
  marks: {},
  morph: null,
  prefs: { style: 'classic', fs: 19, ww: 33, pageLen: 'mid', defLang: 'en' },
  vaults: [{ name: '媒体研究仓库' }, { name: '语言学习仓库' }],
  curVault: 0,
  docs: [],
  docState: [],
  caps: { daily: 30, newDaily: 10 },
  dayOffset: 0,
  extra: {},
})
