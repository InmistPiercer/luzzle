import type { CSSProperties, ReactNode } from 'react'
import type { StyleId } from '../core/types'
import { Label, Piece, piecePath, STAGE_NAMES, type Sides } from '../pieces/Piece'
import { scenePage } from './logic'
import { blankOf, phraseTokens } from '../learn/phrase'

export type Outcome = 'ok' | 'bad' | null

export interface SceneProps {
  style: StyleId
  no: number
  part: string
  pos: string
  stage: number
  from: number
  outcome: Outcome
  piece: (sides?: Sides) => ReactNode
  cells?: Cell[]
  phrase?: PhraseDetail
}

export interface PhraseDetail {
  mark: string
  lemma: string
  core: string
  n: number
  outcome: Outcome
}

export interface Cell {
  id: string
  label: string
  st: number
  pos: string
  filled: boolean
  cur: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')
const gildOf = (p: SceneProps) => (p.outcome === 'ok' && p.stage === 5 && p.from < 5 ? ' gild' : '')
const X = [0, 62, 124, 186, 248]

function Ruler({ stage, from, outcome }: { stage: number; from: number; outcome: Outcome }) {
  const at = Math.max(1, stage) - 1
  const was = Math.max(1, from) - 1
  const moved = outcome === 'ok' && at > was
  const bad = outcome === 'bad'
  return (
    <svg className="dwg-ruler" viewBox="-10 0 270 74" aria-hidden="true">
      <text x="-6" y="10" className="dwg-k">
        SCALE · 阶段
      </text>
      <path d="M0 34H248" className="dwg-ln" />
      {X.map((x, i) => (
        <g key={x}>
          <path d={`M${x} 28V40`} className="dwg-ln" />
          <text x={x} y="56" textAnchor="middle" className={`dwg-st${i === at ? (bad ? ' bad' : ' on') : ''}`}>
            {STAGE_NAMES[i + 1]}
          </text>
        </g>
      ))}
      {X.slice(0, 4).map((x) => (
        <path key={x} d={`M${x + 31} 31V37`} className="dwg-ln thin" />
      ))}
      {moved && (
        <>
          <path d={`M${X[was]} 34H${X[at]}`} className="dwg-bar" />
          <path d={`M${X[was]} 22l-4 -7h8z`} className="dwg-ghost" />
        </>
      )}
      <path d={`M${X[at]} 24l-5 -9h10z`} className={`dwg-mk${bad ? ' bad' : ''}`} />
      {bad && (
        <text x={X[at] + 10} y="20" className="dwg-hold">
          HOLD
        </text>
      )}
    </svg>
  )
}

function Detail({ ph }: { ph: PhraseDetail }) {
  const toks = phraseTokens(ph.lemma)
  const b = blankOf(ph.lemma, ph.core)
  const ok = ph.outcome === 'ok'
  const bad = ph.outcome === 'bad'
  const n = ok ? Math.min(3, ph.n) : ph.n
  const shown = toks.map((t, i) => (i === b && !ok ? (bad ? t : '______') : t))
  const half = Math.ceil(shown.length / 2)
  const lines = shown.length > 2 ? [shown.slice(0, half).join(' '), shown.slice(half).join(' ')] : [shown.join(' ')]
  return (
    <svg className="dwg-detail" viewBox="0 0 230 230" aria-hidden="true">
      <path d="M-236 148L21 122" className="dwg-lead" />
      <circle cx="115" cy="115" r="96" className="dwg-dc" />
      <text x="115" y="48" textAnchor="middle" className="dwg-k">
        DETAIL {ph.mark} · 2:1
      </text>
      {lines.map((l, i) => (
        <text key={i} x="115" y={108 + i * 26 - (lines.length - 1) * 8} textAnchor="middle" className={`dwg-pt${bad && i === lines.length - 1 ? ' bad' : ''}`}>
          {l}
        </text>
      ))}
      {ok && <path d="M67 140H163" className="dwg-ok" />}
      {bad && <path d="M73 140H157" className="dwg-no" />}
      <g transform="translate(99 172)">
        {[0, 1, 2].map((i) => (
          <circle key={i} cx={i * 16} cy="0" r="4.5" className={i < n ? 'on' : ''} />
        ))}
      </g>
    </svg>
  )
}

function Drafting(p: SceneProps) {
  const { no, part, pos, stage, from, outcome, piece, phrase } = p
  const up = outcome === 'ok' && stage > from
  const stageCell = outcome === 'bad' ? `${STAGE_NAMES[stage]} · HOLD` : up ? `${STAGE_NAMES[from]} → ${STAGE_NAMES[stage]}` : STAGE_NAMES[stage]
  const status = outcome === 'ok' ? 'CHECKED' : outcome === 'bad' ? 'REVISE' : 'DRAFTING'
  const po = phrase?.outcome
  const cells: [string, string][] = phrase
    ? [
        ['DWG', `F-${pad(no)}`],
        ['PART', `${pad(no)} · ${phrase.core} · 详图 ${phrase.mark}`],
        ['PHRASE', `${po === 'ok' ? Math.min(3, phrase.n) : phrase.n} / 3`],
        ['STATUS', po === 'ok' ? 'CHECKED' : po === 'bad' ? 'REVISE' : 'DRAFTING'],
      ]
    : [
        ['DWG', `F-${pad(no)}`],
        ['PART', part ? `${pad(no)} · ${part} · ${pos}` : ''],
        ['STAGE', stageCell],
        ['STATUS', status],
      ]
  const out = phrase ? po : outcome
  return (
    <div className={`dwg${out ? ` ${out}` : ''}${phrase ? ' ph' : gildOf(p)}`}>
      <div className="dwg-piece">{piece()}</div>
      {phrase ? <Detail ph={phrase} /> : <Ruler stage={stage} from={from} outcome={outcome} />}
      <div className="dwg-tb">
        {cells.map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
    </div>
  )
}

const N = 3
const GRID: Sides[] = (() => {
  const g: Sides[] = Array.from({ length: N * N }, () => [0, 0, 0, 0] as Sides)
  for (let i = 0; i < N * N; i++) {
    const r = Math.floor(i / N)
    const c = i % N
    if (c < N - 1) {
      const t = (r + c) % 2 ? 1 : -1
      g[i][1] = t
      g[i + 1][3] = -t
    }
    if (r < N - 1) {
      const t = (r + c) % 2 ? -1 : 1
      g[i][2] = t
      g[i + N][0] = -t
    }
  }
  return g
})()
const CELL = 96
const KC = CELL / 100

function Tray(p: SceneProps) {
  const { cells = [], outcome, piece } = p
  const at = cells.findIndex((c) => c.cur)
  const seated = outcome === 'ok'
  return (
    <div className={`tray${outcome ? ` ${outcome}` : ''}${gildOf(p)}`}>
      <div className="tray-plate">
        {GRID.map((sides, i) => {
          const c = cells[i]
          const x = (i % N) * CELL - 24 * KC
          const y = Math.floor(i / N) * CELL - 22 * KC
          const show = c && (c.filled || (c.cur && seated))
          return (
            <div key={i} className={`tray-cell${c?.cur ? ' cur' : ''}`} style={{ left: x, top: y }}>
              {show ? (
                c.cur ? (
                  piece(sides)
                ) : (
                  <Piece sides={sides} k={KC} st={c.st} pos={c.pos} lb={<Label word={c.label} fixedGrid />} />
                )
              ) : (
                <>
                  <svg viewBox="-24 -22 148 154" aria-hidden="true">
                    <path d={piecePath(sides, 100)} />
                  </svg>
                  {c && <span className="tray-lb">{c.label}</span>}
                </>
              )}
            </div>
          )
        })}
      </div>
      {at >= 0 && !seated && (
        <div className="tray-hover" style={{ left: (at % N) * CELL - 24 * KC + 25, top: Math.floor(at / N) * CELL - 22 * KC + 25 }}>
          {piece(GRID[at])}
        </div>
      )}
    </div>
  )
}

const trace = (kind: 'noise' | 'lock' | 'err') => {
  let d = ''
  for (let i = 0; i <= 140; i++) {
    const x = 20 + i * (360 / 140)
    let y = 90
    if (kind === 'lock') y += -Math.exp(-Math.pow((i - 70) / 9, 2)) * 62 + Math.sin(i * 0.9) * 1.2
    else if (kind === 'err') y += i % 23 < 4 ? -48 + ((i * 13) % 7) * 6 : ((i * 37) % 11 - 5) * 0.6
    else y += Math.sin(i * 1.7) * 8 + Math.sin(i * 0.43) * 12 + ((i * 37) % 11 - 5) * 2
    d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d
}

function Scope(p: SceneProps) {
  const { part, outcome, piece } = p
  const kind = outcome === 'ok' ? 'lock' : outcome === 'bad' ? 'err' : 'noise'
  const tag = kind === 'lock' ? 'LOCK ■' : kind === 'err' ? 'ERR' : '同步中'
  return (
    <div className={`scope-box ${kind}${gildOf(p)}`}>
      <div className="scope-piece">{piece()}</div>
      <svg className="scope" viewBox="0 0 400 164" aria-hidden="true">
        <rect className="scope-grid" x="20" y="10" width="360" height="150" />
        <path className="scope-mid" d="M20 90H380" />
        <path className="scope-ln" d={trace(kind)} />
        <text x="24" y="26" className="scope-k">
          CH1 {part} · {tag}
        </text>
      </svg>
    </div>
  )
}

export function DarkroomLine({ cells = [], state = 'dev', doneWave = false }: { cells?: Cell[]; state?: 'dev' | 'ok' | 'bad' | 'ask'; doneWave?: boolean }) {
  const hung = cells.filter((c) => c.filled || (c.cur && (state === 'ok' || state === 'ask')))
  return (
    <div className={`dk-line${doneWave ? ' done-wave' : ''}`}>
      <svg viewBox="0 0 760 60" preserveAspectRatio="none" aria-hidden="true">
        <path d="M10 28 Q380 48 750 28" />
      </svg>
      {Array.from({ length: scenePage('neon') }, (_, i) => {
        const c = hung[i]
        return (
          <div key={i} className={`dk-slot${c ? ' on' : ''}${c?.cur && state === 'ok' ? ' just' : ''}`} style={{ left: 40 + i * 104, top: c ? 30 + Math.sin(i * 1.3) * 4 : 18, rotate: c ? `${i % 2 ? 2 : -2}deg` : undefined, '--i': i } as CSSProperties}>
            <i className="dk-clip" />
            {c && (
              <div className="dk-print">
                <div>
                  <Piece sides={[0, 1, 1, 0]} k={0.5} st={c.st} pos={c.pos} lb={<Label word={c.label} fixedGrid />} />
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Darkroom(p: SceneProps) {
  const { cells = [], outcome, piece } = p
  const state = p.phrase ? 'ask' : outcome === 'ok' ? 'ok' : outcome === 'bad' ? 'bad' : 'dev'
  const hung = cells.filter((c) => c.filled || (c.cur && (state === 'ok' || state === 'ask')))
  const curIdx = Math.max(0, hung.findIndex((c) => c.cur))
  const dx = (curIdx - 3) * 104 + 15
  const dy = Math.round(-122 + Math.sin(curIdx * 1.3) * 4)
  const rot = curIdx % 2 ? 2 : -2
  return (
    <div className={`dk-room ${state}${gildOf(p)}`}>
      <DarkroomLine cells={cells} state={state} />
      <div className="dk-tray">
        <i className="dk-rim" />
        <i className="dk-bath" />
        <i className="dk-glare" />
        <i className="dk-halo" />
        <div className="dk-cur" style={{ '--dx': `${dx}px`, '--dy': `${dy}px`, '--rot': `${rot}deg` } as CSSProperties}>
          {piece()}
        </div>
      </div>
    </div>
  )
}

export function Scene(p: SceneProps) {
  if (p.style === 'draft') return <Drafting {...p} />
  if (p.style === 'classic') return <Tray {...p} />
  if (p.style === 'amber') return <Scope {...p} />
  return <Darkroom {...p} />
}
