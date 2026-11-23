import { create } from 'zustand'
import { useApp } from '../app/store'
import type { AppState } from '../core/types'

interface Snap {
  label: string
  board: AppState['board']
  detached: Record<string, boolean | undefined>
}

interface History {
  stack: Snap[]
}

const MAX = 20

export const useBoardHistory = create<History>(() => ({ stack: [] }))

const detachedOf = (d: AppState) => Object.fromEntries(Object.entries(d.pieces).filter(([, p]) => p.detached).map(([id]) => [id, true]))

const snapOf = (d: AppState, label: string): Snap => ({ label, board: d.board, detached: detachedOf(d) })

const same = (a: Snap, d: AppState) =>
  JSON.stringify([a.board.pos, a.board.links, a.detached]) === JSON.stringify([d.board.pos, d.board.links, detachedOf(d)])

export function boardChange(label: string, fn: (d: AppState) => AppState): boolean {
  const app = useApp.getState()
  const before = snapOf(app.data, label)
  app.update(fn)
  if (same(before, useApp.getState().data)) return false
  const stack = [...useBoardHistory.getState().stack, before].slice(-MAX)
  useBoardHistory.setState({ stack })
  return true
}

export function undoBoard() {
  const stack = [...useBoardHistory.getState().stack]
  const tx = stack.pop()
  const app = useApp.getState()
  if (!tx) return app.say('没有可撤销的操作')
  useBoardHistory.setState({ stack })
  app.update((d) => {
    const pieces = { ...d.pieces }
    for (const id of Object.keys(pieces)) {
      const want = !!tx.detached[id]
      if (!!pieces[id].detached !== want) pieces[id] = { ...pieces[id], detached: want || undefined }
    }
    const pos: AppState['board']['pos'] = {}
    for (const [id, p] of Object.entries(tx.board.pos)) if (d.learn[id]) pos[id] = p
    for (const [id, p] of Object.entries(d.board.pos)) if (d.learn[id] && !pos[id] && pieces[id]?.detached) pos[id] = p
    const links = tx.board.links.filter(([a, b]) => d.learn[a] && d.learn[b])
    return { ...d, pieces, board: { ...d.board, pos, links } }
  })
  app.say(`已撤销：${tx.label}`)
}
