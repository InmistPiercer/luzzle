import { useEffect, useState } from 'react'
import { useApp } from '../app/store'
import { boardRootIds, placeOnBoard } from '../learn/pieces'
import { useFlip } from '../pieces/Piece'
import { BoardCanvas } from './BoardCanvas'
import { BoardDetail } from './BoardDetail'
import { boardChange, undoBoard, useBoardHistory } from './history'
import { autoSnap, compOf, resetBoard } from './logic'
import { Organizer } from './Organizer'

export function BoardView() {
  const data = useApp((x) => x.data)
  const view = useApp((x) => x.view)
  const update = useApp((x) => x.update)
  const say = useApp((x) => x.say)
  const boardSel = useApp((x) => x.boardSel)
  const stack = useBoardHistory((x) => x.stack)
  const allFlipped = useFlip((x) => x.all)
  const [mode, setMode] = useState<'canvas' | 'box'>('canvas')

  useEffect(() => {
    if (view !== 'board') return
    const missing = boardRootIds(data).filter((id) => !data.board.pos[id])
    if (missing.length) {
      const vp = document.getElementById('board')
      update((d) => missing.reduce((acc, id) => placeOnBoard(acc, id, undefined, { w: vp?.clientWidth || 780, h: vp?.clientHeight || 640 }), d))
    }
    if (!boardSel || !data.learn[boardSel]) useApp.setState({ boardSel: boardRootIds(data)[0] || Object.keys(data.learn)[0] || null })
  }, [view, data, boardSel, update])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useApp.getState().view !== 'board' || (e.target as Element).closest('input, textarea, [contenteditable]')) return
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undoBoard()
        return
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'f') {
        const sel = useApp.getState().boardSel
        if (sel) {
          e.preventDefault()
          useFlip.getState().toggle(compOf(useApp.getState().data, sel))
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const ids = boardRootIds(data)
  const last = stack[stack.length - 1]

  return (
    <>
      <div className="vh">
        <h2>词汇拼板与收纳盒</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="seg" id="b-view">
            <button className={mode === 'canvas' ? 'on' : ''} onClick={() => setMode('canvas')}>
              岛屿画布
            </button>
            <button className={mode === 'box' ? 'on' : ''} onClick={() => setMode('box')}>
              分格收纳盒
            </button>
          </div>
          <button className={`btn sm ${allFlipped ? 'on' : 'alt'}`} id="b-flip" onClick={() => useFlip.getState().toggleAll()}>
            翻面
          </button>
          {mode === 'canvas' && (
            <>
              <button
                className="btn alt sm"
                id="b-auto"
                onClick={() => {
                  let n = 0
                  const changed = boardChange('自动吸合', (d) => {
                    const out = autoSnap(d)
                    n = out.n
                    return out.data
                  })
                  if (n && changed) say(`吸合 ${n} 组`, undoBoard)
                  else say('已全部咬合')
                }}
              >
                <svg className="ico">
                  <use href="#i-spark" />
                </svg>
                自动吸合词族
              </button>
              <button
                className="btn alt sm"
                id="b-undo"
                disabled={!stack.length}
                title={last ? `撤销：${last.label}（⌘Z / Ctrl+Z）` : '没有可撤销的操作'}
                onClick={undoBoard}
              >
                ↶ 撤销
              </button>
              <button
                className="btn alt sm"
                id="b-reset"
                onClick={() => {
                  boardChange('重置桌面', resetBoard)
                  update((d) => ({ ...d, board: { ...d.board, pan: { x: 0, y: 0 }, zoom: 1 } }))
                  say('桌面已重置', undoBoard)
                }}
              >
                ↺ 重置
              </button>
            </>
          )}
        </div>
      </div>
      <div className="bwrap">
        <BoardCanvas ids={ids} hidden={mode !== 'canvas'} />
        {mode === 'box' && <Organizer ids={ids} />}
        <BoardDetail />
      </div>
    </>
  )
}
