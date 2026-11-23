import { startFloat } from '../app/drag'
import { useApp } from '../app/store'
import { openForge } from '../board/BoardDetail'
import { paraIdsOf } from '../content/docs'
import type { DocData } from '../core/types'
import { childrenOf, lemmaOf, rootIds } from '../learn/pieces'
import { Piece } from '../pieces/Piece'
import { jumpToOrigin, useReader } from './session'

export function Shelf({ doc }: { doc?: DocData }) {
  const data = useApp((x) => x.data)
  const go = useApp((x) => x.go)
  const newest = useReader((x) => x.newest)
  const roots = rootIds(data)
  const pids = doc ? paraIdsOf(doc) : null
  const isLoose = (k: string) => data.learn[k].stage === 1 || childrenOf(data, k).some((ch) => data.learn[ch].stage === 1)
  const inDoc = (k: string) => (pids ? [k, ...childrenOf(data, k)].some((id) => data.learn[id]?.occ.some((o) => o.pid && pids.has(o.pid))) : false)
  const items = roots
    .filter(inDoc)
    .sort((a, b) => {
      const aNew = newest === a || (newest != null && childrenOf(data, a).includes(newest)) ? 1 : 0
      const bNew = newest === b || (newest != null && childrenOf(data, b).includes(newest)) ? 1 : 0
      if (aNew !== bNew) return bNew - aNew
      return Number(isLoose(b)) - Number(isLoose(a))
    })
  const looseCnt = items.filter(isLoose).length
  const total = items.length
  return (
    <footer className="shelf" id="shelf">
      <div className="say-pill" id="say">
        <span className="say-main">
          本篇已摘 <b>{total}</b> 块
        </span>
        {looseCnt > 0 && (
          <span className="say-sub">
            待锻 <b>{looseCnt}</b>
          </span>
        )}
      </div>
      <div id="tpc" aria-label="本篇已摘拼块">
        {!items.length && <span className="tpc-empty">本篇尚未摘词 · 点击文中单词摘取</span>}
        {items.map((k) => {
          const chs = childrenOf(data, k)
          const isNew = newest === k || (newest != null && chs.includes(newest))
          return (
            <button
              key={k}
              className={`tp${isNew ? ' new' : ''}${isLoose(k) ? ' loose' : ''}`}
              data-k={k}
              onClick={() => jumpToOrigin(k)}
              onPointerDown={(e) => {
                const tp = e.currentTarget
                const sel = '.nav-group button[data-v="forge"], .nav-group button[data-v="board"]'
                const navs = [...document.querySelectorAll(sel)]
                startFloat(e, tp, {
                  targets: sel,
                  start: () => navs.forEach((n) => n.classList.add('drop-cand')),
                  end: () => navs.forEach((n) => n.classList.remove('drop-cand')),
                  drop: (over) => {
                    if (!over) return false
                    if ((over as HTMLElement).dataset.v === 'forge') openForge(k)
                    else {
                      useApp.setState({ boardSel: k })
                      go('board')
                    }
                  },
                })
              }}
            >
              <Piece sides={[1, 0, -1, 0]} k={0.26} st={data.learn[k].stage} lb="" pos={data.pieces[k]?.pos} />
              <span>{lemmaOf(data, k)}</span>
              {chs.map((ch) => (
                <span key={ch} className="ph-badge" title={`挂靠短语：${lemmaOf(data, ch)}`}>
                  + {lemmaOf(data, ch)}
                </span>
              ))}
            </button>
          )
        })}
      </div>
      <button
        className="btn pri sm"
        id="go-forge"
        onClick={() => {
          useApp.setState({ forgeWord: null })
          go('forge')
        }}
      >
        去锻造 →
      </button>
    </footer>
  )
}
