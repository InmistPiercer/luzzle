import type { AppState } from '../core/types'
import { BOARD_SEED, ISLAND_HOME, SUGGEST } from '../content/demo'
import { GRID, boardPrimaryOf, boardRootIds, lemmaOf } from '../learn/pieces'

export const BK = 0.88
export const SNAP_R = 38
export const BREAK_R = 26
export const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
]
const DIRS_TRBL: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
]

type Pos = AppState['board']['pos']
type Sides = [number, number, number, number]

export const occupied = (d: AppState, x: number, y: number, except: string[] = [], pos: Pos = d.board.pos) =>
  boardRootIds(d).some((k) => !except.includes(k) && pos[k] && Math.abs(pos[k].x - x) < 70 && Math.abs(pos[k].y - y) < 70)

export function sidesOf(d: AppState): Record<string, Sides> {
  const s: Record<string, Sides> = {}
  const pos = d.board.pos
  boardRootIds(d).forEach((k) => (s[k] = [0, 0, 0, 0]))
  d.board.links.forEach(([a, b]) => {
    const A = pos[a]
    const B = pos[b]
    if (!A || !B || !s[a] || !s[b]) return
    const dx = B.x - A.x
    const dy = B.y - A.y
    if (Math.abs(dx) >= Math.abs(dy)) {
      const [l, r] = dx > 0 ? [a, b] : [b, a]
      s[l][1] = 1
      s[r][3] = -1
    } else {
      const [t, m] = dy > 0 ? [a, b] : [b, a]
      s[t][2] = 1
      s[m][0] = -1
    }
  })
  const FREE = [-1, 1, 1, -1]
  Object.keys(s).forEach((k) => {
    const P = pos[k]
    if (!P) return
    DIRS_TRBL.forEach(([ux, uy], i) => {
      if (s[k][i]) return
      if (!occupied(d, P.x + ux * GRID, P.y + uy * GRID, [k])) s[k][i] = FREE[i]
    })
  })
  return s
}

export function components(d: AppState): string[][] {
  const roots = boardRootIds(d)
  const par: Record<string, string> = {}
  roots.forEach((k) => (par[k] = k))
  const f = (k: string): string => (par[k] === k ? k : (par[k] = f(par[k])))
  d.board.links.forEach(([a, b]) => {
    if (par[a] && par[b]) par[f(a)] = f(b)
  })
  const g: Record<string, string[]> = {}
  roots.forEach((k) => (g[f(k)] = g[f(k)] || []).push(k))
  return Object.values(g)
}

export const rootOf = (d: AppState, id: string) => boardPrimaryOf(d, id)

export const compOf = (d: AppState, id: string) => {
  const r = rootOf(d, id)
  return components(d).find((c) => c.includes(r)) || [r]
}

export const islandName = (d: AppState, comp: string[]) => comp.map((k) => ISLAND_HOME[k]).find(Boolean) || `${lemmaOf(d, comp[0])} 岛`

export const neighborsOf = (d: AppState, id: string) => {
  const r = rootOf(d, id)
  return d.board.links.filter((l) => l.includes(r)).map((l) => (l[0] === r ? l[1] : l[0]))
}

export function linkAdjacent(d: AppState, id: string): AppState {
  const P = d.board.pos[id]
  if (!P) return d
  let links = d.board.links
  boardRootIds(d).forEach((o) => {
    const Q = d.board.pos[o]
    if (o === id || !Q) return
    const dx = Q.x - P.x
    const dy = Q.y - P.y
    const adj = (Math.abs(Math.abs(dx) - GRID) < 4 && Math.abs(dy) < 4) || (Math.abs(Math.abs(dy) - GRID) < 4 && Math.abs(dx) < 4)
    if (adj && !links.some((l) => l.includes(id) && l.includes(o))) links = [...links, [o, id]]
  })
  return { ...d, board: { ...d.board, links } }
}

export interface Spot {
  m: string
  x: number
  y: number
  ux: number
  uy: number
  rec: boolean
}

export function candidateSpots(d: AppState, id: string): Spot[] {
  const out: Spot[] = []
  const pos = d.board.pos
  boardRootIds(d).forEach((m) => {
    if (m === id || !pos[m]) return
    DIRS.forEach(([ux, uy]) => {
      const x = pos[m].x + ux * GRID
      const y = pos[m].y + uy * GRID
      if (occupied(d, x, y, [id])) return
      const rec = SUGGEST.some(
        (r) => (r.a === m && r.b === id && r.dir[0] === ux && r.dir[1] === uy) || (r.b === m && r.a === id && r.dir[0] === -ux && r.dir[1] === -uy),
      )
      out.push({ m, x, y, ux, uy, rec })
    })
  })
  return out
}

export const ghostSides = (c: { ux?: number; uy?: number }): Sides => {
  const s: Sides = [0, 0, 0, 0]
  if (c.ux === 1) s[3] = -1
  if (c.ux === -1) s[1] = 1
  if (c.uy === 1) s[0] = -1
  if (c.uy === -1) s[2] = 1
  return s
}

export function groupSnap(d: AppState, group: string[], orig: { x: number; y: number }[], id: string, dx: number, dy: number) {
  const pos = d.board.pos
  const outside = boardRootIds(d).filter((k) => pos[k] && !group.includes(k))
  let best: { ox: number; oy: number } | null = null
  let bd = SNAP_R
  const i = group.indexOf(id)
  if (i < 0) return null
  const mx = orig[i].x + dx
  const my = orig[i].y + dy
  outside.forEach((o) =>
    DIRS.forEach(([ux, uy]) => {
      const tx = pos[o].x + ux * GRID
      const ty = pos[o].y + uy * GRID
      const q = Math.hypot(mx - tx, my - ty)
      if (q >= bd) return
      const ox = tx - orig[i].x
      const oy = ty - orig[i].y
      if (orig.some((p) => occupied(d, p.x + ox, p.y + oy, group))) return
      bd = q
      best = { ox, oy }
    }),
  )
  return best as { ox: number; oy: number } | null
}

export function bannerSpot(d: AppState, comp: string[], text: string) {
  const pos = d.board.pos
  const bw = 30 + [...text].reduce((w, ch) => w + (/[一-鿿]/.test(ch) ? 12 : 7), 0)
  const bh = 22
  const xs = comp.map((i) => pos[i].x)
  const ys = comp.map((i) => pos[i].y)
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  const x1 = Math.max(...xs) + GRID
  const y1 = Math.max(...ys) + GRID
  const others = boardRootIds(d).filter((k) => !comp.includes(k) && pos[k])
  const hits = (x: number, y: number) =>
    others.some((k) => {
      const P = pos[k]
      return x < P.x + GRID + 10 && x + bw > P.x - 10 && y < P.y + GRID + 12 && y + bh > P.y - 12
    }) ||
    comp.some((k) => {
      const P = pos[k]
      return x < P.x + GRID && x + bw > P.x && y < P.y + GRID && y + bh > P.y
    })
  const spots = [
    { x: x0 + 22, y: y0 - 30 },
    { x: x0 + 22, y: y1 + 24 },
    { x: x1 + 16, y: y0 + 8 },
    { x: x0 - bw - 16, y: y0 + 8 },
    { x: x1 - bw, y: y0 - 30 },
  ].map((p) => ({ x: Math.max(4, p.x), y: Math.max(4, p.y) }))
  return spots.find((p) => !hits(p.x, p.y)) || spots[0]
}

export function moveTo(d: AppState, id: string, x: number, y: number, unlink = false): AppState {
  return {
    ...d,
    board: {
      ...d.board,
      pos: { ...d.board.pos, [id]: { x, y } },
      links: unlink ? d.board.links.filter((l) => !l.includes(id)) : d.board.links,
    },
  }
}

export function attachNear(d: AppState, id: string, rel: string, dir?: [number, number]): AppState {
  const pos = d.board.pos
  if (!d.learn[id] || !d.learn[rel] || !pos[rel] || d.board.links.some((l) => l.includes(id) && l.includes(rel))) return d
  const spots = (dir ? [dir] : DIRS).map(([ux, uy]) => ({ x: pos[rel].x + ux * GRID, y: pos[rel].y + uy * GRID })).filter((p) => !occupied(d, p.x, p.y, [id]))
  return spots.length ? linkAdjacent(moveTo(d, id, spots[0].x, spots[0].y, true), id) : d
}

export function autoSnap(d: AppState) {
  let data = d
  let n = 0
  SUGGEST.forEach((r) => {
    if (data.learn[r.a] && data.learn[r.b] && !data.board.links.some((l) => l.includes(r.a) && l.includes(r.b))) {
      const next = attachNear(data, r.b, r.a, r.dir)
      if (next !== data) {
        data = next
        n++
      }
    }
  })
  return { data, n }
}

export function resetBoard(d: AppState): AppState {
  const pos: Pos = {}
  Object.entries(BOARD_SEED).forEach(([k, [x, y]]) => {
    if (d.learn[k]) pos[k] = { x, y }
  })
  const keep: [string, string][] = [
    ['patient', 'patience'],
    ['erode', 'erosion'],
  ]
  const links = keep.filter(([a, b]) => pos[a] && pos[b])
  return { ...d, board: { pos, links, pan: { x: 0, y: 0 } } }
}

const ZOOM_MIN = 0.3
const ZOOM_MAX = 2.5
export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

export function zoomAt(view: { x: number; y: number; z: number }, mx: number, my: number, z: number) {
  const nz = clampZoom(z)
  const k = nz / view.z
  return { x: mx - (mx - view.x) * k, y: my - (my - view.y) * k, z: nz }
}

export function fitView(d: AppState, ids: string[], w: number, h: number) {
  const ks = ids.filter((k) => d.board.pos[k])
  if (!ks.length) return { x: 0, y: 0, z: 1 }
  const xs = ks.map((k) => d.board.pos[k].x)
  const ys = ks.map((k) => d.board.pos[k].y)
  const x0 = Math.min(...xs) - 40
  const y0 = Math.min(...ys) - 50
  const x1 = Math.max(...xs) + GRID + 40
  const y1 = Math.max(...ys) + GRID + 40
  const z = clampZoom(Math.min(1.4, w / (x1 - x0), h / (y1 - y0)))
  return { x: (w - (x1 - x0) * z) / 2 - x0 * z, y: (h - (y1 - y0) * z) / 2 - y0 * z, z }
}

export function fitPan(d: AppState) {
  const ks = boardRootIds(d).filter((k) => d.board.pos[k])
  if (!ks.length) return d.board.pan
  const x0 = Math.min(...ks.map((k) => d.board.pos[k].x))
  const y0 = Math.min(...ks.map((k) => d.board.pos[k].y))
  const z = d.board.zoom || 1
  return { x: 40 - x0 * z, y: 60 - y0 * z }
}
