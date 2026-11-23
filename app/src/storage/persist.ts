import { today } from '../core/date'
import type { AppState } from '../core/types'
import { db as defaultDb, type LuzzleDB, type StoredState } from './db'
import { dropPdf, LEGACY_KEYS, migrateLegacy, upgradeV6, type LegacySnapshot } from './migrate'

const STATE_KEY = 'state'
const PREVIOUS_BACKUP = 'previousBackup'

interface Baseline {
  revision: number
  docs: Map<string, AppState['docs'][number]>
}

const baselines = new WeakMap<LuzzleDB, Baseline>()
const saveQueues = new WeakMap<LuzzleDB, Promise<unknown>>()
const docsById = (docs: AppState['docs']) => new Map(docs.map((doc) => [doc.id, doc]))

export class StaleStateError extends Error {}

async function writeState(state: AppState, db: LuzzleDB, previous?: AppState) {
  const { docs, ...rest } = state
  const baseline = baselines.get(db)
  const nextDocs = docsById(docs)
  const put = docs.filter((doc) => baseline?.docs.get(doc.id) !== doc)
  const del = baseline ? [...baseline.docs.keys()].filter((id) => !nextDocs.has(id)) : []
  const revision = (baseline?.revision ?? 0) + 1
  await db.transaction('rw', db.kv, db.docs, async () => {
    const current = await db.kv.get(STATE_KEY)
    const currentRevision = current ? current.revision ?? 0 : null
    if (currentRevision !== (baseline?.revision ?? null)) throw new StaleStateError()
    if (previous) await db.kv.put({ key: PREVIOUS_BACKUP, value: previous })
    await db.kv.put({ key: STATE_KEY, value: rest, revision })
    if (del.length) await db.docs.bulkDelete(del)
    if (put.length) await db.docs.bulkPut(put)
  })
  baselines.set(db, { revision, docs: nextDocs })
  return { put: put.length, del: del.length }
}

export function saveState(state: AppState, db: LuzzleDB = defaultDb, previous?: AppState) {
  const write = () => writeState(state, db, previous)
  const next = (saveQueues.get(db) || Promise.resolve()).then(write, write)
  saveQueues.set(db, next)
  return next
}

export const loadState = async (
  db: LuzzleDB = defaultDb,
  storage: (Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'removeItem'>>) | null = typeof localStorage === 'undefined' ? null : localStorage,
): Promise<AppState | null> => {
  const { row, docs } = await db.transaction('r', db.kv, db.docs, async () => ({
    row: await db.kv.get(STATE_KEY),
    docs: await db.docs.toArray(),
  }))
  if (row) {
    baselines.set(db, { revision: row.revision ?? 0, docs: docsById(docs) })
    const st = { ...(row.value as StoredState), docs: docs.map(dropPdf) } as AppState
    if (st.version === 7) return st
    if (Number(st.version) !== 6) throw new Error('unsupported-state')
    const upgraded = upgradeV6(st, today())
    await saveState(upgraded, db)
    return upgraded
  }
  if (storage) {
    for (const key of LEGACY_KEYS) {
      const raw = storage.getItem(key)
      if (!raw) continue
      const state = importBackup(raw)
      await saveState(state, db)
      storage.removeItem?.(key)
      return state
    }
  }
  return null
}

export const exportBackup = (state: AppState): string =>
  JSON.stringify({ app: 'luzzle', version: 7, exportedAt: new Date().toISOString(), state })

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const number = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const days = (x: unknown): boolean => Array.isArray(x) && x.every((day) => typeof day === 'string')
const position = (x: unknown) => isRecord(x) && number(x.x) && number(x.y)
const validSched = (x: unknown) =>
  isRecord(x) && typeof x.due === 'string' && number(x.stability) && number(x.difficulty) && number(x.reps) && number(x.lapses) && number(x.state)
const invalidBackup = () => new Error('bad-backup')

function validState(s: unknown, version: number): s is AppState {
  if (!isRecord(s) || s.version !== version) return false
  const { board, caps, docState, docs, extra, learn, marks, pieces, prefs, vaults } = s
  if (!isRecord(pieces) || !isRecord(learn) || !isRecord(prefs) || !isRecord(caps) || !isRecord(marks) || !isRecord(extra)) return false
  if (!isRecord(board) || !isRecord(board.pos) || !position(board.pan) || !Array.isArray(board.links)) return false
  if (!Object.values(board.pos).every(position) || !board.links.every((link) => Array.isArray(link) && link.length === 2 && days(link))) return false
  if (!Array.isArray(vaults) || !vaults.length || !vaults.every((v) => isRecord(v) && typeof v.name === 'string')) return false
  if (!number(s.curVault) || s.curVault < 0 || s.curVault >= vaults.length || !number(s.dayOffset) || !number(prefs.fs) || !number(prefs.ww) || !number(caps.newDaily)) return false
  if (!Array.isArray(docs) || !docs.every((d) => isRecord(d) && typeof d.id === 'string' && typeof d.title === 'string')) return false
  if (!Array.isArray(docState) || !docState.every((d) => isRecord(d) && typeof d.id === 'string')) return false
  if (!Object.values(pieces).every((p) => isRecord(p) && typeof p.lemma === 'string')) return false
  return Object.entries(learn).every(([id, r]) => {
    if (!Object.hasOwn(pieces, id) || !isRecord(r) || !validSched(r.sched) || (r.form !== undefined && !validSched(r.form)) || !number(r.stage)) return false
    if (!Array.isArray(r.occ) || !r.occ.every((o) => isRecord(o) && typeof o.s === 'string')) return false
    return version === 6 || (isRecord(r.ev) && ['rec', 'meaning', 'fresh', 'form', 'use'].every((k) => days((r.ev as Record<string, unknown>)[k])) && ['stash', 'read', 'use'].includes(String(r.goal)))
  })
}

const cleanDocs = (docs: AppState['docs']) => docs.map((doc) => {
  const clean = dropPdf(doc)
  return Array.isArray(clean.paras) ? clean : { ...clean, paras: [], vault: clean.vault ?? 0 }
})

const isOldCollection = (x: unknown) =>
  isRecord(x) && Object.entries(x).every(([id, stage]) => !['__proto__', 'prototype', 'constructor'].includes(id) && number(stage))

export const importBackup = (json: string): AppState => {
  const data: unknown = JSON.parse(json)
  if (!isRecord(data)) throw invalidBackup()
  if (data.app === 'luzzle' && 'version' in data) {
    if ((data.version !== 6 && data.version !== 7) || !validState(data.state, data.version)) throw invalidBackup()
    const st = { ...data.state, docs: cleanDocs(data.state.docs) }
    return data.version === 6 ? upgradeV6(st, today()) : st
  }
  if (data.app && data.app !== 'luzzle' && data.app !== 'lexolith') throw invalidBackup()
  if (isOldCollection(data.C) && (Object.keys(data.C as object).length || number(data.v) || number(data.ver))) {
    return migrateLegacy(data as LegacySnapshot, { today: today() })
  }
  if (isOldCollection(data.pieces) && Object.keys(data.pieces as object).length) {
    const legacy = data as Record<string, unknown>
    return migrateLegacy(
      { C: legacy.pieces, L: legacy.reasons, EXP: legacy.exp, SRC: legacy.expSrc, DAYS: legacy.expDays, MARKS: legacy.marks, SENT: legacy.sentences } as LegacySnapshot,
      { today: today() },
    )
  }
  throw invalidBackup()
}
