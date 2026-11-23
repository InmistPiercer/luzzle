import { describe, expect, it } from 'vitest'
import type { AppState, UserDoc } from '../core/types'
import { createPiece, entryFromSurface } from '../learn/pieces'
import { clearDemo, demoSummary } from './demoClear'
import { allDocs, deleteDoc, deleteVault, moveDoc, renameDoc, restoreDoc, setDocFlags } from './docs'
import { seedDemo } from './seed'

const T = '2026-11-16'
const doc = (id: string, vault: number): UserDoc => ({ id, title: id.toUpperCase(), vault, rebuilt: false, cachedRebuilt: false, user: true, paras: [{ id: `${id}-1`, t: 'Habits form slowly.' }] })

const base = (): AppState => ({ ...seedDemo(T), docs: [doc('a', 0), doc('b', 1), doc('c', 1)] })

describe('doc management', () => {
  it('renames, moves and pages through flags without touching the doc body', () => {
    let d = base()
    const body = d.docs[0]
    d = renameDoc(d, 'a', 'Alpha')
    d = moveDoc(d, 'a', 1)
    d = setDocFlags(d, 'a', { page: 2 })
    expect(d.docs[0]).toBe(body)
    expect(allDocs(d).find((x) => x.id === 'a')).toMatchObject({ title: 'Alpha', vault: 1, page: 2 })
  })

  it('deletes and restores user and demo docs', () => {
    const d0 = setDocFlags(base(), 'b', { page: 1 })
    const u = deleteDoc(d0, 'b')
    expect(allDocs(u.data).some((x) => x.id === 'b')).toBe(false)
    const back = restoreDoc(u.data, u.removed)
    expect(back.docs.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(allDocs(back).find((x) => x.id === 'b')?.page).toBe(1)
    const demo = deleteDoc(d0, 'd0')
    expect(allDocs(demo.data).some((x) => x.id === 'd0')).toBe(false)
    expect(allDocs(restoreDoc(demo.data, demo.removed)).some((x) => x.id === 'd0')).toBe(true)
  })

  it('deletes a vault moving or dropping its docs and reindexes the rest', () => {
    let d = { ...base(), vaults: [{ name: 'V0' }, { name: 'V1' }, { name: 'V2' }], docs: [doc('a', 0), doc('b', 1), doc('c', 2)], curVault: 2 }
    const moved = deleteVault(d, 1, 2)
    expect(moved.vaults.map((v) => v.name)).toEqual(['V0', 'V2'])
    expect(allDocs(moved).filter((x) => x.user).map((x) => [x.id, x.vault])).toEqual([['a', 0], ['b', 1], ['c', 1]])
    expect(moved.curVault).toBe(1)
    d = deleteVault(d, 0, null)
    expect(allDocs(d).filter((x) => x.user).map((x) => [x.id, x.vault])).toEqual([['b', 0], ['c', 1]])
    expect(allDocs(d).some((x) => x.id === 'd0')).toBe(false)
  })
})

describe('clear demo', () => {
  it('removes demo docs, demo pieces and empty demo vaults but keeps user work', () => {
    let d = { ...seedDemo(T), docs: [doc('u', 1)] }
    d = createPiece(d, 'habitual', entryFromSurface('habitual', 'x'), '生词初见', { pid: 'u-1', wi: 0, doc: 'U', s: 'x' })
    d = createPiece(d, 'tempt', entryFromSurface('tempt', 'y'), '生词初见', { pid: 'P3-B1', wi: 0, doc: 'demo', s: 'y' })
    expect(demoSummary(d, T).docs).toBe(3)
    const c = clearDemo(d, T)
    expect(Object.keys(c.learn)).toEqual(['habitual'])
    expect(allDocs(c).map((x) => x.id)).toEqual(['u'])
    expect(c.vaults.map((v) => v.name)).toEqual(['语言学习仓库'])
    expect(allDocs(c)[0].vault).toBe(0)
    expect(demoSummary(c, T)).toEqual({ docs: 0, pieces: 0 })
  })
})
