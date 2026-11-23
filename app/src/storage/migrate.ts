import { emptyState, type AppState, type LearnRecord, type Piece, type Reason, type Stage } from '../core/types'
import { normStyle } from '../theme/styles'
import { legacyRecord } from '../learn/engine'
import { fromLegacySched, type LegacySched } from '../learn/scheduler'
import type { Day } from '../core/date'
import { DEMO_ENTRIES } from '../content/demo'

type Dict<T> = Record<string, T>

export interface LegacySnapshot {
  v?: number
  ver?: number
  C?: Dict<number>
  L?: Dict<string>
  EXP?: Dict<number>
  SRC?: Dict<string[]>
  DAYS?: Dict<string[]>
  OCC?: Dict<LearnRecord['occ']>
  SCH?: Dict<LegacySched>
  SENT?: Dict<string>
  POS_OV?: Dict<string>
  MARKS?: Dict<{ hl?: string; ul?: string }>
  CUSTOM_PH?: Dict<Partial<Piece> & Dict<unknown>>
  BPOS?: Dict<{ x: number; y: number }>
  LINKS?: [string, string][]
  PAN?: { x: number; y: number }
  MORPH?: unknown
  Q?: number
  qDate?: string
  CAP?: number
  NEWCAP?: number
  DAYOFF?: number
  PREFS?: { style?: string; palette?: string; theme?: string; fs?: number; ww?: number }
  VAULTS?: { name: string }[]
  curVault?: number
  docs?: AppState['docs']
  docState?: unknown[]
}

export function dropPdf<T extends object>(doc: T): T {
  if (!('pdf' in doc)) return doc
  const out = { ...doc } as T & { pdf?: unknown }
  delete out.pdf
  return out
}

export const LEGACY_KEYS = ['luzzle_state_v55', 'luzzle_state_v5', 'luzzle_state_v4', 'luzzle_state_v34', 'lx_state_v33']

const REASONS: Reason[] = ['生词初见', '熟词新义', '词族关联']
const OLD_STAGE = [0, 1, 3, 4, 4, 5]

const clampStage = (n: number): Stage => Math.min(5, Math.max(1, Math.round(n) || 1)) as Stage
const asReason = (s: string | undefined): Reason => (REASONS.includes(s as Reason) ? (s as Reason) : '生词初见')

export interface MigrateOptions {
  today: Day
  lemmatize?: (w: string) => string
}

export const migrateLegacy = (d: LegacySnapshot, opts: MigrateOptions): AppState => {
  const st = emptyState()
  const modern = (d.v || d.ver || 0) >= 4
  const lem = opts.lemmatize || ((w: string) => w)
  const idOf = (k: string) => (modern ? k : k === 'habits' ? 'habit' : lem(k))

  for (const [k, raw] of Object.entries(d.C || {})) {
    const id = idOf(k)
    const stage = modern ? clampStage(raw) : clampStage(OLD_STAGE[raw] || 1)
    const sent = d.SENT?.[k]
    st.learn[id] = legacyRecord(
      stage,
      {
        reason: asReason(d.L?.[k]),
        occ: d.OCC?.[k] ? [...d.OCC[k]] : sent ? [{ pid: null, doc: '', s: sent }] : [],
        sched: fromLegacySched(modern ? d.SCH?.[k] : { ...d.SCH?.[k], seen: true }, opts.today),
      },
      opts.today,
    )
    st.pieces[id] = { ...(DEMO_ENTRIES[id] || { lemma: id }), id }
  }

  for (const [id, ph] of Object.entries(d.CUSTOM_PH || {})) {
    st.pieces[id] = { ...st.pieces[id], ...(ph as Partial<Piece>), id, lemma: String(ph.lemma ?? id) }
  }
  for (const [id, pos] of Object.entries(d.POS_OV || {})) {
    if (st.pieces[id]) st.pieces[id].pos = pos
  }
  for (const p of Object.values(st.pieces)) {
    if (p.pos !== 'phrase') continue
    const parent = p.parentId && st.learn[p.parentId] ? p.parentId : Object.keys(st.learn).find((k) => st.pieces[k]?.lemma === p.parentLemma && st.pieces[k]?.pos !== 'phrase')
    if (!parent || !st.pieces[parent]) continue
    p.parentId = parent
    const kids = st.pieces[parent].childrenIds || []
    if (!kids.includes(p.id)) st.pieces[parent].childrenIds = [...kids, p.id]
  }

  for (const [k, v] of Object.entries(d.MARKS || {})) {
    const hl = v.hl || v.ul
    if (hl) st.marks[k] = { hl }
  }

  st.board = {
    pos: { ...(d.BPOS || {}) },
    links: (d.LINKS || []).filter(([a, b]) => st.learn[a] && st.learn[b]),
    pan: d.PAN || { x: 0, y: 0 },
  }
  st.morph = d.MORPH ?? null

  if (d.PREFS) {
    st.prefs = {
      style: normStyle(d.PREFS.style, d.PREFS.palette || d.PREFS.theme),
      fs: d.PREFS.fs || 19,
      ww: d.PREFS.ww || 33,
    }
  }
  if (d.VAULTS?.length) {
    st.vaults = d.VAULTS
    st.curVault = Math.min(d.curVault || 0, d.VAULTS.length - 1)
  }
  st.docs = d.docs || []
  st.docState = d.docState || []
  st.caps = { daily: d.CAP || 30, newDaily: d.NEWCAP || 10 }
  st.dayOffset = d.DAYOFF || 0
  st.extra = { quota: { used: d.Q || 0, day: d.qDate || '' } }
  return st
}

interface V6Record {
  stage: number
  reason: Reason
  occ: LearnRecord['occ']
  sched: LearnRecord['sched']
}

export const upgradeV6 = (st: AppState, day: Day): AppState => ({
  ...st,
  version: 7,
  learn: Object.fromEntries(
    Object.entries(st.learn as unknown as Record<string, V6Record & Partial<LearnRecord>>).map(([id, r]) => [
      id,
      r.ev && r.goal ? { ...r, ev: r.ev, goal: r.goal } : { ...r, ...legacyRecord(r.stage, { reason: r.reason, occ: r.occ, sched: r.sched }, day) },
    ]),
  ),
})
