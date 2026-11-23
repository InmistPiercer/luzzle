import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { LuzzleDB } from './db'
import { migrateLegacy, type LegacySnapshot } from './migrate'
import { exportBackup, importBackup, loadState, saveState } from './persist'

const T = '2026-11-14'

const v5: LegacySnapshot = {
  v: 5,
  C: { patience: 4, grant: 2, granted: 2 },
  L: { patience: '词族关联' },
  EXP: { patience: 2 },
  SRC: { patience: ['board:patient', 'transfer'] },
  DAYS: { patience: ['2026-11-11', '2026-11-13'] },
  SCH: { patience: { due: '2026-11-15', stab: 6, lapses: 1, seen: true }, grant: { due: T, stab: 1, seen: false } },
  MARKS: { 'P1:3': { ul: 'yellow' }, 'P1:4': { hl: 'blue' } },
  CUSTOM_PH: { granted: { lemma: 'take … for granted', pos: 'phrase', parentId: 'grant', members: ['take', 'for', 'granted'] } },
  BPOS: { patience: { x: 1, y: 2 } },
  LINKS: [['patience', 'patient'], ['patience', 'grant']],
  PREFS: { theme: 'mint', fs: 20 },
  CAP: 40,
  Q: 3,
  qDate: T,
}

describe('migrateLegacy', () => {
  it('maps a v5 snapshot without loss', () => {
    const s = migrateLegacy(v5, { today: T })
    expect(s.learn.patience).toMatchObject({ goal: 'use', reason: '词族关联' })
    expect(s.learn.patience.ev.fresh).toHaveLength(1)
    expect(s.learn.patience.sched).toMatchObject({ state: 2, stability: 6, lapses: 1, due: '2026-11-15' })
    expect(s.learn.grant.sched.state).toBe(0)
    expect(s.pieces.granted).toMatchObject({ lemma: 'take … for granted', pos: 'phrase', parentId: 'grant' })
    expect(s.marks).toEqual({ 'P1:3': { hl: 'yellow' }, 'P1:4': { hl: 'blue' } })
    expect(s.board.links).toEqual([['patience', 'grant']])
    expect(s.prefs).toEqual({ style: 'classic', fs: 20, ww: 33 })
    expect(s.caps.daily).toBe(40)
  })

  it('maps v3 stages and lemmatizes keys', () => {
    const s = migrateLegacy({ C: { habits: 2, chasing: 4 }, SENT: { chasing: 'x' } }, { today: T, lemmatize: (w) => (w === 'chasing' ? 'chase' : w) })
    expect(s.learn.habit.ev.meaning).toHaveLength(2)
    expect(s.learn.chase.goal).toBe('use')
    expect(s.learn.chase.occ[0].s).toBe('x')
  })
})

describe('persist', () => {
  it('migrates from localStorage once and then reads IndexedDB', async () => {
    const db = new LuzzleDB('t1')
    const store = new Map([['luzzle_state_v55', JSON.stringify(v5)]])
    const a = await loadState(db, { getItem: (k) => store.get(k) ?? null })
    expect(a?.learn.patience.goal).toBe('use')
    store.clear()
    const b = await loadState(db, { getItem: () => null })
    expect(b?.learn.patience.goal).toBe('use')
  })

  it('round-trips a backup', async () => {
    const db = new LuzzleDB('t2')
    const s = migrateLegacy(v5, { today: T })
    s.docs = [{ id: 'd1', title: 'A', paras: [], vault: 0 }]
    await saveState(s, db)
    const back = importBackup(exportBackup((await loadState(db, null))!))
    expect(back.docs).toEqual(s.docs)
    expect(importBackup(JSON.stringify(v5)).learn.patience.goal).toBe('use')
  })
})

describe('incremental doc saving', () => {
  it('writes only changed docs and deletes removed ones', async () => {
    const db = new LuzzleDB('t3')
    const s = migrateLegacy(v5, { today: T })
    const a = { id: 'a', title: 'A', paras: [{ t: 'x' }] }
    const b = { id: 'b', title: 'B', paras: [{ t: 'y' }] }
    s.docs = [a, b]
    expect(await saveState(s, db)).toEqual({ put: 2, del: 0 })
    expect(await saveState({ ...s, docs: [a, { ...b, title: 'B2' }] }, db)).toEqual({ put: 1, del: 0 })
    const s2 = { ...s, docs: [a] }
    expect(await saveState(s2, db)).toEqual({ put: 0, del: 1 })
    const back = await loadState(db, null)
    expect(back?.docs.map((d) => d.id)).toEqual(['a'])
    expect(await saveState({ ...back!, docState: [{ id: 'a', page: 3 }] }, db)).toEqual({ put: 0, del: 0 })
  })
})

describe('v7 migration', () => {
  it('preserves learning, layout and documents in a v6 saved state', async () => {
    const db = new LuzzleDB('t4')
    const s = migrateLegacy(v5, { today: T })
    s.docs = [{ id: 'd1', title: 'A' }]
    await saveState({ ...s, version: 6 } as unknown as typeof s, db)
    const back = await loadState(db, null)
    expect(back?.version).toBe(7)
    expect(back?.learn).toEqual(s.learn)
    expect(back?.docs.map((d) => d.id)).toEqual(['d1'])
    expect(back?.pieces).toEqual(s.pieces)
    expect(back?.board).toEqual(s.board)
  })

  it('rejects unrelated JSON and incomplete modern backups', () => {
    expect(() => importBackup('{}')).toThrow('bad-backup')
    expect(() => importBackup('{"app":"luzzle","version":7,"state":{"version":7}}')).toThrow('bad-backup')
  })

  it('rejects out-of-range curVault and incomplete sched in modern backups', () => {
    const base = migrateLegacy(v5, { today: T })
    expect(() => importBackup(exportBackup({ ...base, curVault: -1 }))).toThrow('bad-backup')
    expect(() => importBackup(exportBackup({ ...base, curVault: base.vaults.length }))).toThrow('bad-backup')
    const badSched = {
      ...base,
      learn: { ...base.learn, patience: { ...base.learn.patience, sched: { due: T } as unknown as typeof base.learn.patience.sched } },
    }
    expect(() => importBackup(exportBackup(badSched))).toThrow('bad-backup')
    const badForm = {
      ...base,
      learn: { ...base.learn, patience: { ...base.learn.patience, form: { due: T } as unknown as typeof base.learn.patience.sched } },
    }
    expect(() => importBackup(exportBackup(badForm))).toThrow('bad-backup')
  })

  it('rejects stale saves across database connections', async () => {
    const first = new LuzzleDB('two-writers')
    const second = new LuzzleDB('two-writers')
    const original = migrateLegacy(v5, { today: T })
    await saveState(original, first)
    const stale = (await loadState(second, null))!
    const current = { ...original, docs: [{ id: 'new', title: 'New', paras: [] }] }
    await saveState(current, first)
    await expect(saveState({ ...stale, caps: { daily: 30, newDaily: 17 } }, second)).rejects.toThrow()
    await expect(saveState({ ...stale, caps: { daily: 30, newDaily: 18 } }, second)).rejects.toThrow()
    expect((await loadState(first, null))?.docs).toEqual(current.docs)
    const row = await first.kv.get('state')
    expect(row?.revision).toBe(2)
    first.close()
    second.close()
  })
})

describe('normStyle', () => {
  it('maps retired styles and dark palettes to the four current styles', async () => {
    const { normStyle } = await import('../theme/styles')
    expect(normStyle('riso', 'punch')).toBe('neon')
    expect(normStyle('classic', 'night')).toBe('neon')
    expect(normStyle('classic', 'mint')).toBe('classic')
    expect(normStyle('draft', 'cyanotype')).toBe('neon')
    expect(normStyle('draft', 'sepia')).toBe('draft')
    expect(normStyle('amber')).toBe('amber')
    expect(normStyle('gem')).toBe('classic')
  })
})
