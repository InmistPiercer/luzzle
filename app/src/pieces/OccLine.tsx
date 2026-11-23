import { useState } from 'react'
import { useApp } from '../app/store'
import type { AppState } from '../core/types'
import { jumpToOrigin, originsOf } from '../reader/session'
import { condense } from './condense'

const targetsOf = (d: AppState, id: string) => {
  const e = d.pieces[id]
  return { targets: e?.members?.length ? e.members : [e?.lemma || id], forms: [e?.form || ''].filter(Boolean) }
}

function Sent({ s, d, id, short }: { s: string; d: AppState; id: string; short: boolean }) {
  const { targets, forms } = targetsOf(d, id)
  const c = short ? condense(s, targets, forms) : condense(s, targets, forms, 1e9, 1e9)
  return (
    <>
      “{c.cutL && '… '}
      {c.parts.map((p, i) => (p.hit ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>))}
      {c.cutR && ' …'}”
    </>
  )
}

export function OccLine({ id, note }: { id: string; note?: string }) {
  const d = useApp((x) => x.data)
  const [open, setOpen] = useState(false)
  const r = d.learn[id]
  const occ = (r?.occ || []).filter((o) => o.s)
  if (!occ.length) return null
  const docs = new Set(occ.map((o) => o.doc).filter(Boolean))
  const origins = originsOf(d, id)
  return (
    <div className={`occ-line${open ? ' open' : ''}`}>
      <button className="occ-s" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Sent s={occ[0].s} d={d} id={id} short />
      </button>
      {note && <div className="occ-note">{note}</div>}
      <div className="occ-meta">
        遇到 {occ.length} 次{docs.size ? ` · ${docs.size} 个来源` : ''}
      </div>
      {open && (
        <div className="occ-list">
          {occ.map((o, i) => {
            const oi = o.pid ? origins.findIndex((x) => x.pid === o.pid && x.wi === o.wi && x.s === o.s) : -1
            return (
              <div key={i} className="occ-item">
                <div className="occ-full">
                  <Sent s={o.s} d={d} id={id} short={false} />
                </div>
                <div className="occ-src">
                  <span>{o.doc || '—'}</span>
                  {o.pid && (
                    <button className="link" onClick={() => (oi < 0 ? useApp.getState().say('原文所在文章已删除') : jumpToOrigin(id, oi))}>
                      跳回原文
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
