import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { create } from 'zustand'
import { useApp } from '../app/store'
import type { PosTag } from '../core/types'
import type { SubSlot } from '../learn/pieces'
import { Accessory, type Acc } from './Accessory'

export const useFlip = create<{
  flipped: Record<string, boolean>
  all: boolean
  wave: boolean
  toggle: (ids: string[]) => void
  toggleAll: () => void
  reset: () => void
}>((set) => ({
  flipped: {},
  all: false,
  wave: false,
  toggle: (ids) =>
    set((s) => {
      if (!ids.length) return s
      const anyFlipped = ids.some((id) => s.all !== !!s.flipped[id])
      const want = !anyFlipped
      const next = { ...s.flipped }
      for (const id of ids) next[id] = s.all !== want
      return { flipped: next, wave: false }
    }),
  toggleAll: () => set((s) => ({ all: !s.all, flipped: {}, wave: true })),
  reset: () => set({ flipped: {}, all: false, wave: false }),
}))

export type Sides = [number, number, number, number]

export const POS_COLOR: Record<string, [string, string]> = {
  'v.': ['var(--s2)', 'var(--s2-d)'],
  'n.': ['var(--s5)', 'var(--s5-d)'],
  'adj.': ['var(--s1)', 'var(--s1-d)'],
  'adv.': ['var(--s3)', 'var(--s3-d)'],
  phrase: ['var(--s4)', 'var(--s4-d)'],
  'func.': ['var(--mut)', 'var(--ink)'],
}

export const POS_CLS: Record<string, string> = {
  'v.': 'pos-v',
  'n.': 'pos-n',
  'adj.': 'pos-adj',
  'adv.': 'pos-adv',
  phrase: 'pos-ph',
  'func.': 'pos-func',
}

const FILL_PCT = [0, 18, 45, 72, 92, 92]
const DRAFT_PCT = [0, 12, 35, 68, 100, 100]
const BLOCK_PCT = [0, 18, 34, 80, 100, 100]

export const STAGE_NAMES = ['', '初识', '识记', '巩固', '理解', '运用']

export function calcWu(text = '') {
  const clean = String(text).trim()
  if (clean.length <= 6) return 100
  return Math.min(210, Math.round(100 + (clean.length - 6) * 9.5))
}

const edge = (x0: number, y0: number, x1: number, y1: number, t: number, r = 12) => {
  if (!t) return `L${x1} ${y1}`
  const f = (a: number) => [x0 + (x1 - x0) * a, y0 + (y1 - y0) * a]
  const a = f(0.37)
  const b = f(0.63)
  return `L${a[0]} ${a[1]}A${r} ${r} 0 1 ${t > 0 ? 1 : 0} ${b[0]} ${b[1]}L${x1} ${y1}`
}

const KN = [[-8.5, 0], [-8.5, 5.5], [-12, 5.5], [-12, 16], [-8, 16], [-8, 18.5], [8, 18.5], [8, 16], [12, 16], [12, 5.5], [8.5, 5.5], [8.5, 0]]

const blockEdge = (x0: number, y0: number, x1: number, y1: number, t: number) => {
  if (!t) return `L${x1} ${y1}`
  const len = Math.hypot(x1 - x0, y1 - y0)
  const ux = (x1 - x0) / len
  const uy = (y1 - y0) / len
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return 'L' + KN.map(([a, n]) => `${+(cx + ux * a + uy * t * n).toFixed(1)} ${+(cy + uy * a - ux * t * n).toFixed(1)}`).join('L') + `L${x1} ${y1}`
}

export const piecePath = (s: Sides, W: number, block = false) => {
  const e = block ? blockEdge : edge
  return `M0 0${e(0, 0, W, 0, s[0])}${e(W, 0, W, 100, s[1])}${e(W, 100, 0, 100, s[2])}${e(0, 100, 0, 0, s[3])}Z`
}

const POS_KEY: Record<string, string> = { 'v.': 'v', 'n.': 'n', 'adj.': 'a', 'adv.': 'd', phrase: 'p', 'func.': 'd' }

const gridPaths = (W: number, rows: number[]) =>
  rows.flatMap((cols, r) => {
    const h = 100 / rows.length
    const y0 = r === 0 ? -40 : r * h
    const y1 = r === rows.length - 1 ? 140 : (r + 1) * h
    return Array.from({ length: cols }, (_, c) => {
      const w = W / cols
      const x0 = c === 0 ? -40 : c * w
      const x1 = c === cols - 1 ? W + 40 : (c + 1) * w
      return { d: `M${x0} ${y0}H${x1}V${y1}H${x0}Z`, dot: [c * w + (c === cols - 1 ? w - 10 : 10), r * h + (r === 0 ? 12 : h - 12)] as [number, number] }
    })
  })

const mosaicPaths = (W: number, n: number): { d: string; dot: [number, number] }[] => {
  if (n >= 5) return gridPaths(W, n === 5 ? [2, 3] : [3, 3])
  const mx = W / 2
  if (n === 2) {
    return [
      { d: `M-40 -40 L${W + 40} -40 L${W + 40} 50 L${W} 50 ${edge(W, 50, 0, 50, -1, 9)} L-40 50 Z`, dot: [W - 10, 12] },
      { d: `M-40 50 L0 50 ${edge(0, 50, W, 50, 1, 9)} L${W + 40} 50 L${W + 40} 140 L-40 140 Z`, dot: [W - 10, 88] },
    ]
  }
  if (n === 3) {
    return [
      { d: `M-40 -40 L${mx} -40 L${mx} 0 ${edge(mx, 0, mx, 50, 1, 7)} ${edge(mx, 50, 0, 50, -1, 7)} L-40 50 Z`, dot: [10, 12] },
      { d: `M-40 50 L0 50 ${edge(0, 50, mx, 50, 1, 7)} ${edge(mx, 50, mx, 100, -1, 7)} L${mx} 140 L-40 140 Z`, dot: [10, 88] },
      { d: `M${mx} -40 L${W + 40} -40 L${W + 40} 140 L${mx} 140 L${mx} 100 ${edge(mx, 100, mx, 50, 1, 7)} ${edge(mx, 50, mx, 0, -1, 7)} Z`, dot: [W - 10, 12] },
    ]
  }
  return [
    { d: `M-40 -40 L${mx} -40 L${mx} 0 ${edge(mx, 0, mx, 50, 1, 7)} ${edge(mx, 50, 0, 50, -1, 7)} L-40 50 Z`, dot: [10, 12] },
    { d: `M${mx} -40 L${W + 40} -40 L${W + 40} 50 L${W} 50 ${edge(W, 50, mx, 50, -1, 7)} ${edge(mx, 50, mx, 0, -1, 7)} Z`, dot: [W - 10, 12] },
    { d: `M-40 50 L0 50 ${edge(0, 50, mx, 50, 1, 7)} ${edge(mx, 50, mx, 100, -1, 7)} L${mx} 140 L-40 140 Z`, dot: [10, 88] },
    { d: `M${mx} 50 ${edge(mx, 50, W, 50, 1, 7)} L${W + 40} 50 L${W + 40} 140 L${mx} 140 L${mx} 100 ${edge(mx, 100, mx, 50, 1, 7)} Z`, dot: [W - 10, 88] },
  ]
}

const SUFFIXES = ['ativeness', 'iveness', 'ousness', 'fulness', 'lessness', 'ization', 'isation', 'ability', 'ibility', 'ational', 'ically', 'ation', 'ition', 'ness', 'ment', 'ship', 'able', 'ible', 'tion', 'sion', 'ance', 'ence', 'ity', 'ive', 'ous', 'ful', 'less', 'ism', 'ist', 'ize', 'ise', 'ing']

export function splitWord(word: string): [string, string] {
  const cuts = SUFFIXES.filter((x) => word.endsWith(x) && word.length - x.length >= 4).map((x) => word.length - x.length)
  const cut = cuts.length ? cuts.sort((a, b) => Math.max(a, word.length - a) - Math.max(b, word.length - b))[0] : Math.ceil(word.length / 2)
  return [word.slice(0, cut), word.slice(cut)]
}

const sizeFor = (len: number, fixedGrid: boolean): [string, string] => {
  if (fixedGrid) {
    if (len >= 13) return ['9.5px', '-.04em']
    if (len >= 11) return ['10.5px', '-.03em']
    if (len === 10) return ['11.5px', '-.03em']
    if (len === 9) return ['12.5px', '-.02em']
    if (len === 8) return ['13.5px', '-.02em']
    return ['15px', '-.01em']
  }
  if (len >= 16) return ['11.5px', '-.03em']
  if (len >= 12) return ['12.5px', '-.02em']
  return ['14px', '-.01em']
}

export function Label({ word, sub, fixedGrid = false, back = false, slots }: { word: string; sub?: ReactNode; fixedGrid?: boolean; back?: boolean; slots?: SubSlot[] }) {
  const hasMosaic = !!slots && slots.length >= 2
  if (hasMosaic && back) {
    const shown = slots.slice(0, 6)
    return (
      <span className={`lb-mosaic m-${shown.length}`}>
        {shown.map((s, i) => {
          const longest = Math.max(1, ...String(s.micro || '').split(/\s+/).map((w) => w.length))
          return (
            <span key={s.id || i} className={`lb-mslot${s.unlocked ? '' : ' locked'}${s.active ? ' active' : ''}`}>
              {s.unlocked ? <span className="ms-t" style={{ '--n': longest } as CSSProperties}>{s.micro}</span> : ''}
            </span>
          )
        })}
      </span>
    )
  }
  if (back) {
    return (
      <>
        <span className="lb-back-hd">{word}</span>
        <span className="lb-back-txt">{sub || word}</span>
      </>
    )
  }
  const split = !/\s/.test(word) && word.length >= (fixedGrid ? 13 : 17) ? splitWord(word) : null
  const [wfs, wls] = sizeFor(split ? Math.max(split[0].length + 1, split[1].length) : word.length, fixedGrid)
  return (
    <>
      <b style={{ '--wfs': wfs, '--wls': wls } as CSSProperties}>
        {split ? (
          <>
            {split[0]}-
            <br />
            {split[1]}
          </>
        ) : (
          word
        )}
      </b>
      {!hasMosaic && sub ? <i>{sub}</i> : null}
    </>
  )
}

export interface PieceProps {
  sides: Sides
  k: number
  st: number
  lb?: ReactNode
  pos?: PosTag | string
  className?: string
  wu?: number
  style?: CSSProperties
  flipDelay?: number
  slots?: SubSlot[]
  acc?: Acc | null
}

const FLIP_FRAMES: Keyframe[] = [
  { transform: 'perspective(520px) translateY(0) scale(1) rotateY(0deg)' },
  { transform: 'perspective(520px) translateY(-7px) scale(1.06) rotateY(88deg)', offset: 0.42 },
  { transform: 'perspective(520px) translateY(-7px) scale(1.06) rotateY(-88deg)', offset: 0.58 },
  { transform: 'perspective(520px) translateY(0) scale(1) rotateY(0deg)' },
]

const seenSlots = new Map<string, { ids: Set<string>; locked: number }>()

const calmMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function Piece({ sides, k, st, lb, pos = 'v.', className = '', wu = 100, style: extra, flipDelay = 0, slots, acc }: PieceProps) {
  const style = useApp((x) => x.data.prefs.style)
  const ref = useRef<HTMLSpanElement>(null)
  const lbRef = useRef<HTMLSpanElement>(null)
  const fitKey = useRef('')
  const flipped = className.split(/\s+/).includes('flipped')
  const [held, setHeld] = useState<{ lb: ReactNode; className: string } | null>(null)
  const prev = useRef(flipped)
  const last = useRef<{ lb: ReactNode; className: string }>({ lb, className })
  const run = useRef<{ anim?: Animation; raf?: number }>({})
  const shownLb = held ? held.lb : lb
  const shownCls = held ? held.className : className
  useLayoutEffect(() => {
    if (prev.current === flipped) return
    prev.current = flipped
    const cur = run.current
    const old = cur.anim
    cur.anim = undefined
    old?.cancel()
    if (cur.raf) cancelAnimationFrame(cur.raf)
    const el = ref.current
    if (!el || typeof el.animate !== 'function' || calmMotion()) {
      setHeld(null)
      return
    }
    setHeld(last.current)
    const anim = el.animate(FLIP_FRAMES, { duration: 360, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', delay: Math.max(0, flipDelay) })
    cur.anim = anim
    let swapped = false
    const swap = () => {
      if (swapped || cur.anim !== anim) return
      swapped = true
      if (cur.raf) cancelAnimationFrame(cur.raf)
      setHeld(null)
    }
    const tick = () => {
      const p = anim.effect?.getComputedTiming().progress
      if (p != null && p >= 0.5) swap()
      else cur.raf = requestAnimationFrame(tick)
    }
    cur.raf = requestAnimationFrame(tick)
    anim.finished.then(swap, swap)
  }, [flipped, flipDelay])
  useLayoutEffect(() => {
    if (!held) last.current = { lb, className }
  })
  useLayoutEffect(
    () => () => {
      const cur = run.current
      const old = cur.anim
      cur.anim = undefined
      old?.cancel()
      if (cur.raf) cancelAnimationFrame(cur.raf)
    },
    [],
  )
  const clip = useId().replace(/:/g, '')
  const W = wu
  const amber = style === 'amber'
  const neon = style === 'neon'
  const d = piecePath(sides, W, amber)
  const shineD = `M6 5${edge(6, 5, W - 6, 5, sides[0])}`
  const dimD = `M0 120 L${W} 120 M0 115 L0 125 M${W} 115 L${W} 125`
  const [cMain, cDark] = POS_COLOR[pos] || ['var(--acc)', 'var(--accd)']
  const draft = style === 'draft'
  const block = style === 'classic'
  const pk = POS_KEY[pos] || 'a'
  const pcts = draft ? DRAFT_PCT : block ? BLOCK_PCT : FILL_PCT
  const fill = st === 0 ? 'transparent' : draft && st === 5 ? 'var(--bp)' : `color-mix(in srgb, ${cMain} ${pcts[st] || 0}%, var(--sheet))`
  const stroke = st === 0 ? 'var(--mut)' : st === 1 ? cMain : st === 5 ? 'var(--gold-d)' : cDark
  const depth = st === 5 ? 'var(--gold-d)' : st <= 1 ? 'var(--edge)' : block && st === 2 ? `color-mix(in srgb, ${cDark} 65%, #fff)` : cDark
  const gilt = st === 5 && block
  const dk = st >= 3 && pos !== 'adj.'
  const cx = W / 2
  const inset = (sc: number) => `translate(${cx} 50) scale(${1 - ((1 - sc) * 100) / W} ${sc}) translate(${-cx} -50)`
  const cls = ['pc', `s${st}`, POS_CLS[pos] || '', dk ? 'dk' : '', slots && slots.length >= 2 ? 'mosaic' : '', shownCls].filter(Boolean).join(' ')
  const back = shownCls.split(/\s+/).includes('flipped')
  const mosaic = slots && slots.length >= 2 ? slots.slice(0, 6) : null
  const mGeoms = mosaic ? mosaicPaths(W, mosaic.length) : null
  const notch = amber ? 20 : 19
  const padSide = (s: number) => (mosaic ? 0 : s < 0 ? (back ? Math.round(notch * 0.8) : notch) : 3)
  const padL = padSide(sides[3])
  const padR = padSide(sides[1])
  useLayoutEffect(() => {
    const lbEl = lbRef.current
    const b = lbEl?.querySelector<HTMLElement>(':scope > b')
    if (!lbEl || !b) return
    const key = `${b.textContent}|${W}|${k}|${padL}|${padR}|${back}|${style}`
    if (fitKey.current === key) return
    fitKey.current = key
    const fit = () => {
      b.style.removeProperty('--fit')
      if (!lbEl.clientWidth) fitKey.current = ''
      const avail = lbEl.clientWidth - padL * k - padR * k - 6
      const need = b.scrollWidth
      if (need > avail && avail > 0) b.style.setProperty('--fit', String(Math.max(0.5, avail / need)))
    }
    fit()
    if (document.fonts.status !== 'loaded') document.fonts.ready.then(fit)
  })
  const mKey = mosaic?.[0]?.id || ''
  const mPrev = mKey ? seenSlots.get(mKey) : undefined
  const mLocked = mosaic ? mosaic.filter((x) => !x.unlocked).length : 0
  const sealed = !!mPrev && mPrev.locked > 0 && mLocked === 0
  useLayoutEffect(() => {
    if (mKey && mosaic) seenSlots.set(mKey, { ids: new Set(mosaic.map((x) => x.id || '').filter(Boolean)), locked: mLocked })
  })
  const slotFill = (slot: SubSlot) => {
    if (!slot.unlocked) return undefined
    if (back) return draft ? 'var(--sheet)' : `color-mix(in srgb, var(--sheet) 92%, ${cMain})`
    if (slot.st === 5) return draft ? 'var(--bp)' : 'color-mix(in srgb, var(--gold) 58%, var(--sheet))'
    return `color-mix(in srgb, ${cMain} ${pcts[slot.st] || pcts[1]}%, var(--sheet))`
  }
  const fillArea = (f: string, o?: number) => (
    <g clipPath={`url(#${clip})`}>
      <rect x={-40} y={-40} width={W + 80} height={180} fill={f} opacity={o} />
    </g>
  )
  const lit = mosaic || st === 0 ? null : amber ? (
    back ? (
      <>
        <path d={d} className="la-b" />
        <path d={d} className="la-in dash" transform={inset(0.86)} />
      </>
    ) : st === 1 ? (
      <path d={d} className="la-b" />
    ) : st === 2 ? (
      <path d={d} className="la-b" />
    ) : st === 3 ? (
      <>
        <path d={d} className="la-b" style={{ fill: `url(#am-scan-${pk})` }} />
        <path d={d} className="la-in" transform={inset(0.88)} />
      </>
    ) : st === 4 ? (
      <>
        <path d={d} className="la-b" />
        <path d={d} fill="url(#am-scand)" />
      </>
    ) : (
      <>
        <path d={d} className="la-b" style={{ fill: `url(#am-hot-${pk})` }} />
        <path d={d} fill="url(#am-scand)" opacity={0.5} />
      </>
    )
  ) : neon ? (
    back ? (
      <>
        <path d={d} className="ln-paper" />
        <path d={d} className="ln-b" />
        <path d={d} className="ln-in dash" transform={inset(0.86)} />
      </>
    ) : st === 1 ? (
      <path d={d} className="ln-b" />
    ) : st === 2 ? (
      <>
        <path d={d} className="ln-paper" />
        {fillArea(`url(#nd-dot-${pk}-s)`, 0.4)}
        <path d={d} className="ln-b" />
      </>
    ) : st === 3 ? (
      <>
        <path d={d} className="ln-mis" transform="translate(4 3)" />
        <path d={d} className="ln-paper" />
        {fillArea(`url(#nd-dot-${pk}-d)`)}
        <path d={d} className="ln-b" />
      </>
    ) : st === 4 ? (
      <>
        <path d={d} className="ln-mis" transform="translate(4 3)" />
        <path d={d} className="ln-full" />
        {fillArea('url(#nd-grain)', 0.35)}
      </>
    ) : (
      <>
        <path d={d} className="ln-full" opacity={0.1} />
        {fillArea(`url(#nd-dot-${pk}-s)`, 0.5)}
        <path d={d} className="ln-halo" />
        <path d={d} className="ln-b" />
        <path d={d} className="ln-core" />
        <path d={d} className="ln-in" transform={inset(0.84)} />
      </>
    )
  ) : null
  return (
    <span ref={ref} className={cls} style={{ '--k': k, '--f': fill, '--st': stroke, '--dp': depth, '--pd': cDark, '--pc': cMain, width: `calc(${W + 52}px * ${k})`, ...extra } as CSSProperties}>
      <svg viewBox={`-24 -22 ${W + 48} 154`} aria-hidden="true">
        {(st === 5 || !!mosaic || (draft && st === 3) || (block && st === 4) || (neon && st >= 2)) && (
          <clipPath id={clip}>
            <path d={d} />
          </clipPath>
        )}
        {lit ? (
          <>
            <g className="lt">{lit}</g>
            <path className="p-hit" d={d} />
          </>
        ) : (
          <>
            <path className="p-depth" d={d} transform="translate(0, 6.5)" />
            <path className="p-body" d={d} strokeDasharray={st <= 1 ? '6 4' : undefined} />
          </>
        )}
        {mosaic && mGeoms && (
          <g className={`p-mosaic${sealed ? ' sealed' : ''}`} clipPath={`url(#${clip})`}>
            {mosaic.map((slot, idx) => {
              const geom = mGeoms[idx]
              return (
                <g key={slot.id || idx}>
                  <path
                    className={`p-slot${slot.unlocked ? '' : ' p-slot-locked'}${slot.active ? ' active' : ''}${mPrev && slot.id && !mPrev.ids.has(slot.id) ? ' pop' : ''}`}
                    d={geom.d}
                    data-slot-id={slot.unlocked ? slot.id : undefined}
                    style={slot.unlocked ? { fill: slotFill(slot) } : undefined}
                  />
                  {!back && slot.unlocked && (
                    <circle className={`p-slot-dot${slot.st === 5 ? ' gold' : ''}`} cx={geom.dot[0]} cy={geom.dot[1]} r={3.2} />
                  )}
                </g>
              )
            })}
            <path className="p-mosaic-rim" d={d} />
          </g>
        )}
        {draft && !back && (st === 3 || st === 5) && !mosaic && <rect className={st === 3 ? 'p-hatch' : 'p-bpgrid'} clipPath={`url(#${clip})`} x={-40} y={-40} width={W + 80} height={180} />}
        {!lit && <path className="p-shine" d={shineD} />}
        {block && st === 4 && !back && !mosaic && (
          <g className="p-gloss" clipPath={`url(#${clip})`}>
            <ellipse cx={W * 0.3} cy={14} rx={W * 0.36} ry={13} />
            <rect x={W * 0.08} y={10} width={W * 0.3} height={5} rx={2.5} />
          </g>
        )}
        {k >= 0.55 && <path className="p-dim" d={dimD} />}
        {draft && k >= 0.55 && st >= 4 && <path className="p-dim" d={`M${W + 20} 0 L${W + 20} 100 M${W + 15} 0 L${W + 25} 0 M${W + 15} 100 L${W + 25} 100`} />}
        {draft && st === 5 && !back && <path className="p-bpline" d={d} transform={inset(0.86)} />}
        {gilt && !lit && (
          <>
            <g clipPath={`url(#${clip})`}>
              <rect className="p-facet" x={-14} y={-14} width={W + 28} height={128} />
              <g transform={`rotate(24 ${cx} 50)`}>
                <rect className="p-sweep" x={-40} y={-60} width={34} height={230} />
              </g>
            </g>
            <path className="p-inlay" d={d} transform={inset(0.84)} />
            <path className="p-inlay2" d={d} transform={inset(0.72)} />
          </>
        )}
        {acc && !back && <Accessory style={style} W={W} acc={acc} />}
        {back && !lit && (
          <>
            <path className="p-back-rim" d={d} transform={inset(0.82)} />
            {!mosaic && (
              <g className="p-back-badge" transform="translate(15 15)">
                <circle r={8.5} />
                <path d="M-4 -1.2A4.3 4.3 0 0 1 3.6 -2.4M4 1.2A4.3 4.3 0 0 1 -3.6 2.4M3.6 -2.4l.4 -3M3.6 -2.4l-3 -.2M-3.6 2.4l-.4 3M-3.6 2.4l3 .2" />
              </g>
            )}
          </>
        )}
      </svg>
      <span ref={lbRef} className="lb" style={{ width: `calc(${W + 4}px * ${k})`, paddingLeft: padL * k + 3, paddingRight: padR * k + 3 }}>
        {shownLb}
      </span>
    </span>
  )
}
