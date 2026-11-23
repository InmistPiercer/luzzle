import { describe, expect, it } from 'vitest'
import { seedDemo } from '../content/seed'
import { GRID } from '../learn/pieces'
import { autoSnap, candidateSpots, compOf, components, fitView, groupSnap, islandName, linkAdjacent, moveTo, neighborsOf, resetBoard, sidesOf, zoomAt } from './logic'
import { placeOnBoard } from '../learn/pieces'

const T = '2026-11-14'

describe('board logic', () => {
  it('builds islands from links', () => {
    const d = seedDemo(T)
    expect(compOf(d, 'patience').sort()).toEqual(['impatient', 'patience', 'patient'])
    expect(islandName(d, compOf(d, 'patience'))).toBe('patience 词族')
    expect(components(d).filter((c) => c.length > 1)).toHaveLength(2)
    expect(compOf(d, 'granted')).toEqual(['grant'])
  })

  it('gives linked pieces matching tabs and blanks', () => {
    const s = sidesOf(seedDemo(T))
    expect(s.patient[1]).toBe(1)
    expect(s.patience[3]).toBe(-1)
    expect(s.erode[2]).toBe(1)
    expect(s.erosion[0]).toBe(-1)
  })

  it('links an adjacent neighbour without counting evidence', () => {
    let d = seedDemo(T)
    d = moveTo(d, 'corrode', d.board.pos.erode.x - GRID, d.board.pos.erode.y, true)
    const data = linkAdjacent(d, 'corrode')
    expect(neighborsOf(data, 'corrode')).toContain('erode')
    expect(data.learn).toBe(d.learn)
  })

  it('offers recommended spots and whole-island snaps', () => {
    const d = seedDemo(T)
    expect(candidateSpots(d, 'corrode').some((c) => c.rec && c.m === 'erode')).toBe(true)
    const group = compOf(d, 'erode')
    const orig = group.map((k) => d.board.pos[k])
    const snap = groupSnap(d, group, orig, 'erode', 440 + 10, 176 - 5)
    expect(snap).toEqual({ ox: 440, oy: 176 })
    expect(groupSnap(d, group, orig, 'erode', 352, 0)).toBeNull()
  })

  it('auto-snaps suggested pairs and resets the desk', () => {
    const d = seedDemo(T)
    const { data, n } = autoSnap(d)
    expect(n).toBe(1)
    expect(neighborsOf(data, 'corrode')).toContain('erode')
    expect(resetBoard(data).board.links).toEqual([['patient', 'patience'], ['erode', 'erosion']])
    const unlinked = moveTo(data, 'patient', 0, 0, true)
    expect(resetBoard(unlinked).board.links).toEqual([['patient', 'patience'], ['erode', 'erosion']])
  })

  it('zooms around the cursor, fits the window and places new pieces in view', () => {
    const v = zoomAt({ x: 0, y: 0, z: 1 }, 100, 50, 2)
    expect(v).toEqual({ x: -100, y: -50, z: 2 })
    expect(zoomAt(v, 0, 0, 99).z).toBe(2.5)
    const d = seedDemo(T)
    const ids = Object.keys(d.board.pos)
    const f = fitView(d, ids, 800, 600)
    for (const k of ids) {
      const sx = f.x + d.board.pos[k].x * f.z
      const sy = f.y + d.board.pos[k].y * f.z
      expect(sx).toBeGreaterThanOrEqual(0)
      expect(sx + GRID * f.z).toBeLessThanOrEqual(800)
      expect(sy).toBeGreaterThanOrEqual(0)
      expect(sy + GRID * f.z).toBeLessThanOrEqual(600)
    }
    const z = { ...d, board: { pos: {}, links: [], pan: { x: -400, y: -300 }, zoom: 0.5 } }
    const id = Object.keys(d.learn)[0]
    const p = placeOnBoard(z, id, undefined, { w: 800, h: 600 }).board.pos[id]
    const sx = z.board.pan.x + p.x * 0.5
    const sy = z.board.pan.y + p.y * 0.5
    expect(Math.abs(sx - 400)).toBeLessThan(GRID)
    expect(Math.abs(sy - 300)).toBeLessThan(GRID)
  })
})
