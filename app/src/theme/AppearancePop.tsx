import { useApp } from '../app/store'
import type { PageLen } from '../core/types'

export function AppearancePop({ open }: { open: boolean }) {
  const prefs = useApp((x) => x.data.prefs)
  const setPrefs = useApp((x) => x.setPrefs)
  return (
    <div className={`pop${open ? ' open' : ''}`} id="pop">
      <label>
        释义语言
        <div className="seg" id="lang-seg" style={{ width: '100%' }}>
          {(
            [
              ['en', 'English'],
              ['zh', '中文'],
            ] as const
          ).map(([v, lb]) => (
            <button key={v} className={(prefs.defLang || 'en') === v ? 'on' : ''} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setPrefs({ defLang: v })}>
              {lb}
            </button>
          ))}
        </div>
      </label>
      <label>
        每页长度
        <div className="seg" style={{ width: '100%' }}>
          {(
            [
              ['short', '短'],
              ['mid', '中'],
              ['long', '长'],
              ['none', '不分页'],
            ] as [PageLen, string][]
          ).map(([v, lb]) => (
            <button key={v} className={(prefs.pageLen || 'mid') === v ? 'on' : ''} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setPrefs({ pageLen: v })}>
              {lb}
            </button>
          ))}
        </div>
      </label>
      <label>
        正文字号 · {prefs.fs}px <input type="range" min={16} max={24} value={prefs.fs} onChange={(e) => setPrefs({ fs: Number(e.target.value) })} />
      </label>
      <label>
        版心宽度 · {prefs.ww}em <input type="range" min={26} max={42} value={prefs.ww} onChange={(e) => setPrefs({ ww: Number(e.target.value) })} />
      </label>
      <div className="aa-legend">
        <span className="w m s1">初识</span>
        <span className="w m s2">识记 / 巩固</span>
        <span className="w m s4">理解</span>
        <span className="w m s5">运用</span>
        <span className="w ph">短语</span>
      </div>
    </div>
  )
}
