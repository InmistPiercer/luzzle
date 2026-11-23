import { describe, expect, it } from 'vitest'
import { initialState } from '../core/edition'
import { forgeQueue } from '../learn/engine'
import { allDocs, demoOn } from './docs'
import { seedDemo } from './seed'

describe('seedDemo', () => {
  it('matches the prototype demo', () => {
    const s = seedDemo('2026-11-14')
    expect(Object.keys(s.learn)).toHaveLength(11)
    expect(s.learn.patience).toMatchObject({ stage: 4, goal: 'use' })
    expect(s.pieces.granted.parentId).toBe('grant')
    expect(s.board.pos.patience).toEqual({ x: 128, y: 60 })
  })

  it('queues due pieces with the daily new cap', () => {
    const s = seedDemo('2026-11-14')
    const q = forgeQueue(s.learn, '2026-11-14', 10)
    expect(q).not.toContain('patient')
    expect(q).not.toContain('erosion')
    expect(q).toContain('erode')
    expect(forgeQueue(s.learn, '2026-11-14', 1).filter((id) => s.learn[id].stage === 1)).toHaveLength(1)
  })

  it('starts clean with zero demo articles or pieces in formal edition', () => {
    const formal = initialState('2026-11-14', false)
    expect(Object.keys(formal.learn)).toHaveLength(0)
    expect(Object.keys(formal.pieces)).toHaveLength(0)
    expect(formal.vaults).toEqual([{ name: '我的仓库' }])
    expect(demoOn(formal, false)).toBe(false)
    expect(allDocs(formal)).toHaveLength(0)
    const testEd = initialState('2026-11-14', true)
    expect(demoOn(testEd, true)).toBe(true)
    expect(demoOn(testEd, false)).toBe(false)
    expect(Object.keys(testEd.learn)).toHaveLength(11)
  })
})
