import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { IS_TEST } from '../core/edition'
import { piecePath } from '../pieces/Piece'
import { useApp, useDueCount, type View } from './store'

const ITEMS: { v: View; c: string; title: string; b: string; small: string }[] = [
  { v: 'read', c: 'var(--s4)', title: '阅读与摘词', b: '读', small: '阅读' },
  { v: 'board', c: 'var(--s2)', title: '词汇拼板与分格收纳盒', b: '拼', small: '拼板' },
  { v: 'build', c: 'var(--s5)', title: '构词工坊', b: '构', small: '构词' },
  { v: 'forge', c: 'var(--s1)', title: '锻造台', b: '锻', small: '锻造' },
]

export function Nav({ onSettings }: { onSettings: () => void }) {
  const view = useApp((x) => x.view)
  const go = useApp((x) => x.go)
  const due = useDueCount()
  const style = useApp((x) => x.data.prefs.style)
  const [pulse, setPulse] = useState(false)
  const t = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pulseSeq = useApp((x) => x.pulseSeq)
  const fire = () => {
    setPulse(false)
    requestAnimationFrame(() => setPulse(true))
    clearTimeout(t.current)
    t.current = setTimeout(() => setPulse(false), 900)
  }
  useEffect(() => {
    if (pulseSeq) fire()
  }, [pulseSeq])

  return (
    <nav className="nav" aria-label="主导航">
      <button
        className={`brand${pulse ? ' click' : ''}`}
        id="brand"
        aria-label="Luzzle 首页：回到阅读"
        title="Luzzle · 语境词汇拼图"
        onClick={() => {
          go('read')
          fire()
        }}
      >
        {style === 'draft' ? (
          <DraftLogo />
        ) : style === 'amber' ? (
          <span className="term-logo">
            <b>
              LUZZLE<i />
            </b>
            <small>{IS_TEST ? 'v1.0 · test' : 'v1.0 · amber'}</small>
          </span>
        ) : style === 'neon' ? (
          <span className="neon-sign">LUZZLE</span>
        ) : (
          <>
            <span className="brand-tile">
              <svg viewBox="-36 -52 272 236" aria-hidden="true">
                <g className="bp bp-a">
                  <path className="dp" transform="translate(0,11)" d="M0 0 L100 0 L100 48.1 A16.9 16.9 0 1 1 100 81.9 L100 130 L0 130 Z" />
                  <path className="bd" d="M0 0 L100 0 L100 48.1 A16.9 16.9 0 1 1 100 81.9 L100 130 L0 130 Z" />
                  <path className="sh" d="M13 11 L87 11" />
                  <text className="lt" x="50" y="96" textAnchor="middle">
                    z
                  </text>
                </g>
                <g className="bp bp-b">
                  <path className="dp" transform="translate(0,11)" d="M100 0 L200 0 L200 130 L100 130 L100 81.9 A16.9 16.9 0 1 0 100 48.1 Z" />
                  <path className="bd" d="M100 0 L200 0 L200 130 L100 130 L100 81.9 A16.9 16.9 0 1 0 100 48.1 Z" />
                  <path className="sh" d="M113 11 L187 11" />
                  <text className="lt lt-b" x="156" y="96" textAnchor="middle">
                    z
                  </text>
                </g>
                <path className="spark" d="M100 -46 L109 -28 L127 -19 L109 -10 L100 8 L91 -10 L73 -19 L91 -28 Z" />
              </svg>
            </span>
            <span className="brand-word">
              Lu<i>zz</i>le
            </span>
          </>
        )}
      </button>

      <div className="nav-group" role="group" aria-label="核心模块">
        {ITEMS.map((it, i) => (
          <button key={it.v} className={view === it.v ? 'on' : ''} data-v={it.v} style={{ '--c': it.c } as CSSProperties} title={it.title} onClick={() => go(it.v)}>
            {it.v === 'forge' && (
              <span className="nav-badge" id="nav-cnt" style={due ? undefined : { display: 'none' }}>
                {style === 'neon' ? String(due).padStart(2, '0') : due}
              </span>
            )}
            <span className="sn">S-0{i + 1}</span>
            <span className="fk">F{i + 1}</span>
            <b>{it.b}</b>
            <small>{it.small}</small>
            {view === it.v && (
              <svg className="dimp" viewBox="4 0 14 62" aria-hidden="true">
                <path d="M6 1H16M6 61H16M11 1V61" />
                <path className="ar" d="M11 1l-2.5 5h5zM11 61l-2.5 -5h5z" />
              </svg>
            )}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="end"
        id="set-btn"
        title="设置：本地数据 · 学习节奏 · AI 接口"
        onClick={onSettings}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
        <span className="fk">F9</span>
        <i className="tg" />
        <span>设置</span>
      </button>
    </nav>
  )
}

function DraftLogo() {
  return (
    <svg className="dwg-logo" viewBox="0 0 62 80" aria-hidden="true">
      <defs>
        <pattern id="lg-grid" width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M6 0H0V6" fill="none" stroke="#fff" strokeOpacity=".13" strokeWidth=".6" />
        </pattern>
      </defs>
      <rect width="62" height="80" fill="url(#lg-grid)" />
      <path d="M4 10V4H10M52 4H58V10M58 48V54H52M10 54H4V48" stroke="#fff" strokeWidth="1" fill="none" opacity=".75" />
      <g transform="translate(9 15) scale(.2)" fill="none" stroke="#fff" strokeWidth="7" strokeLinejoin="round">
        <path d={piecePath([0, 1, 0, 0], 100)} />
        <path transform="translate(120 0)" d={piecePath([0, 0, 0, -1], 100)} fill="#fff" fillOpacity=".18" />
      </g>
      <path d="M9 41H33M9 39V43M33 39V43" stroke="#9fc0f5" strokeWidth=".8" />
      <text x="21" y="47.5" fill="#9fc0f5" fontFamily="IBM Plex Mono" fontSize="4.6" textAnchor="middle">
        20
      </text>
      <path d="M0 58H62" stroke="#fff" strokeWidth="1.2" />
      <text x="31" y="69.5" fill="#fff" fontFamily="Gelasio" fontWeight="800" fontSize="12" textAnchor="middle">
        Luzzle
      </text>
      <text x="31" y="76.5" fill="#c9d6ee" fontFamily="IBM Plex Mono" fontSize="5" textAnchor="middle" letterSpacing=".8">
        DWG·00
      </text>
    </svg>
  )
}
