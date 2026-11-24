import { clearDemo, demoSummary } from '../content/demoClear'
import { today } from '../core/date'
import { useReader } from '../reader/session'
import { useApp } from './store'

export function DemoAsk() {
  const ask = useApp((x) => x.demoAsk)
  const data = useApp((x) => x.data)
  const { update, say } = useApp.getState()
  const sum = ask ? demoSummary(data, today()) : { docs: 0, pieces: 0 }
  const close = (clear: boolean) => {
    useApp.setState({ demoAsk: null })
    if (!clear) return update((d) => ({ ...d, extra: { ...d.extra, demoAsked: true } }))
    const cur = useReader.getState().cur
    update((d) => clearDemo(d, today()))
    useApp.setState({ again: new Set(), boardSel: null, forgeWord: null })
    useReader.getState().set({ sel: null, po: false, ctx: false, ann: null, cur: cur && /^d\d+$/.test(cur) ? null : cur })
    say('已清除演示内容')
  }
  return (
    <div className={`modal-bg${ask ? ' open' : ''}`} id="demo-ask" onClick={(e) => e.target === e.currentTarget && close(false)}>
      <div className="modal" role="dialog" aria-label="清除演示内容" style={{ width: 'min(400px,92vw)' }}>
        <h3>清除演示内容？</h3>
        <div className="card small" style={{ fontWeight: 700 }}>
          演示文章 {sum.docs} 篇 · 演示拼块 {sum.pieces} 块
        </div>
        <div className="pr" style={{ justifyContent: 'flex-end', marginTop: 0 }}>
          <button className="btn alt sm" data-dialog-cancel onClick={() => close(false)}>
            保留
          </button>
          <button className="btn sm danger-btn" onClick={() => close(true)}>
            清除
          </button>
        </div>
      </div>
    </div>
  )
}
