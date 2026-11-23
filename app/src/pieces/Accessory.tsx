import type { StyleId } from '../core/types'

export interface Acc {
  det: number[]
  more: number
  hl?: number
  ok?: boolean
}

const L = 'AB'
const arc = (x: number, y: number, r: number, a0: number, a1: number) => {
  const f = (a: number) => [x + r * Math.cos((a * Math.PI) / 180), y + r * Math.sin((a * Math.PI) / 180)].map((v) => v.toFixed(1)).join(' ')
  return `M${f(a0)}A${r} ${r} 0 0 1 ${f(a1)}`
}

function Draft({ x, y, p, i, hl }: { x: number; y: number; p: number; i: number; hl: boolean }) {
  const done = p >= 3
  return (
    <g className="acc-d">
      {hl && <circle className="acc-hl" cx={x} cy={y} r={19} />}
      <circle cx={x} cy={y} r={9} style={{ fill: done ? 'var(--acc)' : '#fff', stroke: done ? 'var(--acc)' : 'var(--ink)' }} strokeWidth={1.4} strokeDasharray={p === 0 ? '2.5 2' : undefined} />
      {!done && [0, 1, 2].map((j) => <path key={j} d={arc(x, y, 13, -90 + j * 120 + 6, -90 + j * 120 + 114)} fill="none" style={{ stroke: j < p ? 'var(--acc)' : '#b8c2d4' }} strokeWidth={3.2} />)}
      <text x={x} y={y + 3.6} textAnchor="middle" className="acc-t" style={{ fill: done ? '#fff' : 'var(--ink)' }}>
        {L[i]}
      </text>
    </g>
  )
}

function Stud({ x, y, p, i, hl }: { x: number; y: number; p: number; i: number; hl: boolean }) {
  const r = 13
  const done = p >= 3
  const a = (p / 3) * 2 * Math.PI
  return (
    <g className="acc-c">
      {hl && <circle className="acc-hl" cx={x} cy={y + 1} r={21} />}
      <circle cx={x} cy={y + 4} r={r} style={{ fill: done ? 'var(--s4-d)' : '#cfc5f4' }} />
      <circle cx={x} cy={y} r={r} style={{ fill: done ? 'var(--s4)' : '#fff', stroke: done ? 'var(--s4-d)' : 'var(--s4)' }} strokeWidth={1.6} strokeDasharray={p === 0 ? '3 2.2' : undefined} />
      {p > 0 && !done && <path d={`M${x} ${y}L${x} ${y - r}A${r} ${r} 0 ${a > Math.PI ? 1 : 0} 1 ${(x + r * Math.sin(a)).toFixed(2)} ${(y - r * Math.cos(a)).toFixed(2)}Z`} style={{ fill: 'var(--s4)' }} />}
      {done && <ellipse cx={x - 4} cy={y - 5} rx={5} ry={2.6} fill="#fff" opacity={0.55} />}
      <text x={x} y={y + 4.2} textAnchor="middle" className="acc-t" style={{ fill: done ? '#fff' : '#221C45', stroke: done ? 'none' : '#fff' }} strokeWidth={2.4} paintOrder="stroke">
        {L[i]}
      </text>
    </g>
  )
}

function Tag({ x, y, p, i, hl }: { x: number; y: number; p: number; i: number; hl: boolean }) {
  const full = p >= 3
  return (
    <g className="acc-a">
      {hl && <rect x={x - 3} y={y - 3} width={40} height={18} fill="none" style={{ stroke: 'var(--s4)' }} strokeWidth={1} strokeDasharray="2 2" />}
      <rect x={x} y={y} width={34} height={12} style={{ fill: full ? 'var(--s4)' : '#050302', stroke: 'var(--s4)' }} strokeWidth={1} />
      <text x={x + 5} y={y + 9.5} className="acc-t" style={{ fill: full ? '#120a00' : 'var(--s4)' }}>
        {L[i]}
      </text>
      {[0, 1, 2].map((j) => (
        <rect key={j} x={x + 14 + j * 6} y={y + 3} width={4.5} height={6} style={{ fill: full ? '#120a00' : j < p ? 'var(--s4)' : 'none', stroke: full ? 'none' : 'var(--s4)' }} strokeOpacity={0.6} strokeWidth={0.7} />
      ))}
    </g>
  )
}

function Tube({ x, y, p, i, hl }: { x: number; y: number; p: number; i: number; hl: boolean }) {
  const fo = [0, 0.28, 0.55, 1][Math.min(3, p)]
  return (
    <g className={`acc-n${p === 1 ? ' flick' : ''}`}>
      {hl && <rect className="acc-glow" x={x - 20} y={y - 14} width={40} height={28} rx={14} style={{ fill: 'var(--s4)' }} opacity={0.35} />}
      <rect x={x - 15} y={y - 9} width={30} height={18} rx={9} fill="#0b0811" style={{ stroke: p ? 'var(--s4)' : '#5c5070' }} strokeWidth={1.6} strokeDasharray={p ? undefined : '3 2'} />
      {p > 0 && <rect x={x - 15} y={y - 9} width={30} height={18} rx={9} style={{ fill: 'var(--s4)', stroke: p >= 3 ? '#fff' : 'var(--s4)' }} fillOpacity={fo} strokeWidth={p >= 3 ? 1.6 : 1.2} />}
      {p >= 3 && <rect className="acc-glow" x={x - 17} y={y - 11} width={34} height={22} rx={11} fill="none" style={{ stroke: 'var(--s4)' }} strokeWidth={3} opacity={0.6} />}
      <text x={x} y={y + 4} textAnchor="middle" className="acc-t" style={{ fill: p >= 3 ? '#140f1f' : p ? '#fff' : '#8a7fa8' }}>
        {L[i]}
      </text>
      {[0, 1, 2].map((j) => (
        <rect key={j} x={x - 11 + j * 8} y={y + 12} width={6} height={2.6} style={{ fill: j < p ? 'var(--s4)' : '#3a3048' }} />
      ))}
    </g>
  )
}

const GEO: Record<StyleId, { x: (W: number, i: number) => number; y: (i: number) => number; mx: (W: number, n: number) => number }> = {
  draft: { x: (W, i) => W - 15 - i * 30, y: () => 84, mx: (W, n) => W - 15 - n * 30 },
  classic: { x: (W, i) => W - 19 - i * 32, y: () => 78, mx: (W, n) => W - 19 - n * 32 },
  amber: { x: (W) => W - 40, y: (i) => 78 - i * 16, mx: (W) => W - 44 },
  neon: { x: (W, i) => W - 20 - i * 34, y: () => 78, mx: (W, n) => W - 20 - n * 34 },
}
const MARK = { draft: Draft, classic: Stud, amber: Tag, neon: Tube }

export function Accessory({ style, W, acc }: { style: StyleId; W: number; acc: Acc }) {
  const g = GEO[style]
  const M = MARK[style]
  const mx = g.mx(W, acc.det.length)
  return (
    <g className="p-acc">
      {acc.det.map((p, i) => (
        <g key={i} className={acc.ok && acc.hl === i ? 'acc-pop' : undefined}>
          <M x={g.x(W, i)} y={g.y(i)} p={p} i={i} hl={acc.hl === i} />
        </g>
      ))}
      {acc.more > 0 && (
        <g className="acc-more">
          {style === 'amber' ? (
            <text x={mx} y={87.5} textAnchor="end" className="acc-t" style={{ fill: 'var(--s4)' }} fillOpacity={0.55}>
              +{acc.more}
            </text>
          ) : (
            <>
              <rect x={mx - 13} y={g.y(0) - (style === 'neon' ? 9 : 13)} width={26} height={style === 'neon' ? 18 : 26} rx={style === 'neon' ? 9 : 13} className="acc-more-b" />
              <text x={mx} y={g.y(0) + 3.6} textAnchor="middle" className="acc-t">
                +{acc.more}
              </text>
            </>
          )}
        </g>
      )}
    </g>
  )
}
