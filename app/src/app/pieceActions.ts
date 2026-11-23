import { create } from 'zustand'
import type { AppState } from '../core/types'
import { childrenOf, lemmaOf, placeOnBoard, removePiece } from '../learn/pieces'
import { useReader } from '../reader/session'
import { db } from '../storage/db'
import { useApp } from './store'

const pick = <T,>(o: Record<string, T>, ids: string[]) => Object.fromEntries(ids.filter((k) => k in o).map((k) => [k, o[k]]))

export const useDeletePrompt = create<{ id: string | null }>(() => ({ id: null }))

export function deleteParentPiece(d: AppState, id: string, mode: 'all' | 'keepChildren'): AppState {
  if (!d.learn[id]) return d
  if (mode === 'all') return removePiece(d, id)
  const children = childrenOf(d, id)
  const pieces = { ...d.pieces }
  for (const ch of children) pieces[ch] = { ...pieces[ch], parentId: undefined }
  let next = removePiece({ ...d, pieces }, id)
  for (const ch of children) next = placeOnBoard(next, ch)
  return next
}

export function executeDelete(id: string, mode: 'all' | 'keepChildren' = 'all') {
  const { data, update, say } = useApp.getState()
  if (!data.learn[id]) return
  const children = childrenOf(data, id)
  const ids = [id, ...children]
  const clearIds = mode === 'all' ? ids : [id]
  const parent = data.pieces[id]?.parentId
  const snap = {
    pieces: pick(data.pieces, ids),
    learn: pick(data.learn, ids),
    pos: pick(data.board.pos, ids),
    links: data.board.links.filter((l) => ids.some((x) => l.includes(x))),
  }
  const snapAgain = clearIds.filter((x) => useApp.getState().again.has(x))
  const snapStep = pick(useApp.getState().againStep, clearIds)
  update((d) => deleteParentPiece(d, id, mode))
  const s = useApp.getState()
  const nextAgain = new Set(s.again)
  const nextStep = { ...s.againStep }
  for (const cid of clearIds) {
    nextAgain.delete(cid)
    delete nextStep[cid]
  }
  useApp.setState({
    again: nextAgain,
    againStep: nextStep,
    boardSel: clearIds.includes(s.boardSel || '') ? null : s.boardSel,
    forgeWord: clearIds.includes(s.forgeWord || '') ? null : s.forgeWord,
  })
  void db.kv.put({ key: 'again', value: { day: s.againDay, ids: [...nextAgain], step: nextStep } }).catch(() => undefined)
  useReader.getState().set({ po: false, ctx: false, sel: null })
  useDeletePrompt.setState({ id: null })
  say(`已删除 ${lemmaOf(data, id)}`, () => {
    const cur = useApp.getState()
    const restAgain = new Set(cur.again)
    for (const cid of snapAgain) restAgain.add(cid)
    const restStep = { ...cur.againStep, ...snapStep }
    useApp.setState({ again: restAgain, againStep: restStep })
    void db.kv.put({ key: 'again', value: { day: cur.againDay, ids: [...restAgain], step: restStep } }).catch(() => undefined)
    useApp.getState().update((x): AppState => {
      const pieces = { ...x.pieces, ...snap.pieces }
      if (parent && pieces[parent]) pieces[parent] = { ...pieces[parent], childrenIds: [...new Set([...(pieces[parent].childrenIds || []), id])] }
      const learn = { ...x.learn, ...snap.learn }
      const pos = { ...x.board.pos, ...snap.pos }
      if (mode === 'keepChildren') {
        for (const ch of children) if (!(ch in snap.pos)) delete pos[ch]
      }
      return { ...x, pieces, learn, board: { ...x.board, pos, links: [...x.board.links, ...snap.links.filter((l) => l.every((k) => learn[k]))] } }
    })
  })
}

export function deletePieceWithUndo(id: string) {
  const { data } = useApp.getState()
  if (!data.learn[id]) return
  const children = childrenOf(data, id)
  if (children.length) {
    useDeletePrompt.setState({ id })
    return
  }
  executeDelete(id, 'all')
}
