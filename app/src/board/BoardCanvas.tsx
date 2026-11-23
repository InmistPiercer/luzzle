import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPE } from 'react'
import { markDragEnd } from '../app/drag'
import { accOf } from '../learn/phrase'
import { useApp } from '../app/store'
import { today } from '../core/date'
import type { AppState } from '../core/types'
import { lemmatize } from '../lang/lemmatize'
import { childrenOf, lemmaOf, mosaicSlotsOf, pieceGloss, piecesOfLemma, shortEnGloss, siblingGroupOf } from '../learn/pieces'
import { dueCard } from '../learn/engine'
import { Label, Piece, useFlip } from '../pieces/Piece'
import { boardChange, undoBoard } from './history'
import {
  BK,
  BREAK_R,
  SNAP_R,
  bannerSpot,
  candidateSpots,
  clampZoom,
  compOf,
  components,
  fitView,
  ghostSides,
  groupSnap,
  islandName,
  linkAdjacent,
  moveTo,
  neighborsOf,
  occupied,
  rootOf,
  sidesOf,
  zoomAt,
  type Spot,
} from './logic'

type View = { x: number; y: number; z: number }

interface Drag {
  id: string
  detachSlot?: string
  u: HTMLElement
  group: string[]
  els: (HTMLElement | null)[]
  orig: { x: number; y: number }[]
  banner: HTMLElement | null
  bOrig?: { x: number; y: number }
  sx: number
  sy: number
  dx: number
  dy: number
  moved: boolean
  popped: boolean
  linked: boolean
  cands: Spot[]
  near: Spot | null
  gsnap: { ox: number; oy: number } | null
  gkey: string
}

interface Ghosts {
  rec: Spot[]
  near: Spot | null
  group: { k: string; x: number; y: number }[]
  pos: string
}

const NO_GHOSTS: Ghosts = { rec: [], near: null, group: [], pos: 'v.' }

export function BoardCanvas({ ids, hidden }: { ids: string[]; hidden: boolean }) {
  const d = useApp((x) => x.data)
  const boardSel = useApp((x) => x.boardSel)
  const update = useApp((x) => x.update)
  const say = useApp((x) => x.say)
  const flipAll = useFlip((x) => x.all)
  const flippedMap = useFlip((x) => x.flipped)
  const defLang = d.prefs.defLang || 'en'
  const ref = useRef<HTMLDivElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const pan = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)
  const [panning, setPanning] = useState(false)
  const [ghosts, setGhosts] = useState<Ghosts>(NO_GHOSTS)
  const snapped = useRef<string[]>([])
  const flipFrom = useRef<string | null>(null)

  const zoom = d.board.zoom || 1
  const view = useRef<View>({ x: d.board.pan.x, y: d.board.pan.y, z: zoom })
  const applyView = (v: View) => {
    view.current = v
    if (layer.current) layer.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`
    if (ref.current) {
      ref.current.style.backgroundPosition = `${v.x}px ${v.y}px`
      ref.current.style.setProperty('--bz', String(v.z))
    }
  }
  const saveView = (v: View) => {
    applyView(v)
    update((x) => ({ ...x, board: { ...x.board, pan: { x: v.x, y: v.y }, zoom: v.z } }))
  }
  const zoomBy = (z: number, mx?: number, my?: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    saveView(zoomAt(view.current, mx == null ? r.width / 2 : mx - r.left, my == null ? r.height / 2 : my - r.top, z))
  }
  const fit = () => {
    const r = ref.current?.getBoundingClientRect()
    if (r) saveView(fitView(useApp.getState().data, ids, r.width, r.height))
  }

  useLayoutEffect(() => applyView({ x: d.board.pan.x, y: d.board.pan.y, z: zoom }), [d.board.pan.x, d.board.pan.y, zoom, hidden])

  useLayoutEffect(() => {
    if (!snapped.current.length) return
    snapped.current.forEach((k) => ref.current?.querySelector(`.board-unit[data-k="${CSS.escape(k)}"]`)?.classList.add('snapped'))
    snapped.current = []
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = view.current
      if (e.ctrlKey || e.metaKey) return zoomBy(v.z * Math.exp(-Math.max(-50, Math.min(50, e.deltaY)) * 0.006), e.clientX, e.clientY)
      saveView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })
    }
    let z0 = 1
    const onGesture = (e: Event) => {
      const g = e as Event & { scale: number; clientX: number; clientY: number }
      e.preventDefault()
      if (e.type === 'gesturestart') z0 = view.current.z
      else zoomBy(z0 * g.scale, g.clientX, g.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGesture)
    el.addEventListener('gesturechange', onGesture)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGesture)
      el.removeEventListener('gesturechange', onGesture)
    }
  }, [update])

  const sides = sidesOf(d)
  const linked = new Set(d.board.links.flat())
  const comps = components(d)
  const banners = comps
    .filter((c) => c.length > 1 && c.some((i) => ids.includes(i)) && c.every((i) => d.board.pos[i]))
    .map((c) => {
      const text = `${islandName(d, c)} · ${c.length}`
      return { c, text, ...bannerSpot(d, c, text) }
    })
  const wave: Record<string, number> = {}
  const nb: Record<string, string[]> = {}
  d.board.links.forEach(([a, b]) => {
    nb[a] = [...(nb[a] || []), b]
    nb[b] = [...(nb[b] || []), a]
  })
  const diag = (i: string) => (d.board.pos[i] ? d.board.pos[i].x + d.board.pos[i].y : 0)
  comps.forEach((c) => {
    if (c.length < 2) return
    const from = flipFrom.current
    const start = from && c.includes(from) ? from : [...c].sort((a, b) => diag(a) - diag(b))[0]
    const seen = new Set([start])
    const order = [start]
    for (let i = 0; i < order.length; i++) {
      const next = (nb[order[i]] || []).filter((n) => !seen.has(n) && c.includes(n)).sort((a, b) => diag(a) - diag(b))
      for (const n of next) {
        seen.add(n)
        order.push(n)
      }
    }
    c.filter((i) => !seen.has(i)).forEach((i) => order.push(i))
    order.forEach((id, i) => (wave[id] = Math.min(i, 14) * 35))
  })

  const onDown = (e: RPE<HTMLDivElement>) => {
    if (e.button > 0) return
    const u = (e.target as Element).closest<HTMLElement>('.board-unit[data-k]')
    if (!u) {
      pan.current = { sx: e.clientX, sy: e.clientY, px: view.current.x, py: view.current.y }
      setPanning(true)
      ref.current?.setPointerCapture?.(e.pointerId)
      return
    }
    const id = u.dataset.k as string
    const slotId = (e.target as Element).closest<HTMLElement>('[data-slot-id]')?.dataset.slotId
    const detachSlot = e.shiftKey && slotId && slotId !== id ? slotId : undefined
    const single = e.shiftKey || e.altKey
    const group = single ? [id] : compOf(d, id)
    const banner =
      group.length > 1 ? [...(ref.current?.querySelectorAll<HTMLElement>('.island-banner') || [])].find((b) => (b.dataset.isl || '').split(' ').includes(id)) || null : null
    drag.current = {
      id,
      detachSlot,
      u,
      group,
      banner,
      bOrig: banner ? { x: parseFloat(banner.style.left), y: parseFloat(banner.style.top) } : undefined,
      els: group.map((k) => ref.current?.querySelector<HTMLElement>(`.board-unit[data-k="${CSS.escape(k)}"]`) || null),
      orig: group.map((k) => ({ ...d.board.pos[k] })),
      sx: e.clientX,
      sy: e.clientY,
      dx: 0,
      dy: 0,
      moved: false,
      popped: false,
      linked: single && !detachSlot && neighborsOf(d, id).length > 0,
      cands: [],
      near: null,
      gsnap: null,
      gkey: '',
    }
    u.setPointerCapture?.(e.pointerId)
  }

  const onMove = (e: RPE<HTMLDivElement>) => {
    if (pan.current) {
      const p = pan.current
      applyView({ ...view.current, x: p.px + e.clientX - p.sx, y: p.py + e.clientY - p.sy })
      return
    }
    const g = drag.current
    if (!g) return
    const dx = (e.clientX - g.sx) / view.current.z
    const dy = (e.clientY - g.sy) / view.current.z
    const dist = Math.hypot(dx, dy)
    if (!g.moved) {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 4) return
      g.moved = true
      g.cands = g.group.length > 1 ? [] : candidateSpots(d, g.detachSlot || g.id)
      setGhosts({ ...NO_GHOSTS, rec: g.cands.filter((c) => c.rec), pos: d.pieces[g.detachSlot || g.id]?.pos || 'v.' })
    }
    g.dx = dx
    g.dy = dy
    if (g.linked && g.group.length === 1 && dist <= BREAK_R) {
      g.u.classList.add('lifting')
      g.u.classList.remove('dragging')
      g.u.style.left = `${g.orig[0].x + dx * 0.42}px`
      g.u.style.top = `${g.orig[0].y + dy * 0.42}px`
      return
    }
    if (g.linked && !g.popped) {
      g.popped = true
      g.u.classList.remove('lifting')
      g.u.classList.add('pop-free')
    }
    g.els.forEach((el, i) => {
      if (!el) return
      el.classList.add('dragging')
      el.style.left = `${g.orig[i].x + dx}px`
      el.style.top = `${g.orig[i].y + dy}px`
    })
    if (g.banner && g.bOrig) {
      g.banner.style.left = `${g.bOrig.x + dx}px`
      g.banner.style.top = `${g.bOrig.y + dy}px`
    }
    if (g.group.length > 1) {
      const snap = groupSnap(d, g.group, g.orig, g.id, dx, dy)
      const key = snap ? `${snap.ox},${snap.oy}` : ''
      if (key !== g.gkey) {
        g.gkey = key
        g.gsnap = snap
        setGhosts((s) => ({ ...s, group: snap ? g.group.map((k, i) => ({ k, x: g.orig[i].x + snap.ox, y: g.orig[i].y + snap.oy })) : [] }))
      }
      return
    }
    const x = g.orig[0].x + dx
    const y = g.orig[0].y + dy
    let best: Spot | null = null
    let bd = SNAP_R
    g.cands.forEach((c) => {
      const q = Math.hypot(x - c.x, y - c.y)
      if (q < bd) {
        bd = q
        best = c
      }
    })
    if (best !== g.near) {
      g.near = best
      setGhosts((s) => ({ ...s, near: best }))
    }
  }

  const onUp = () => {
    if (pan.current) {
      pan.current = null
      setPanning(false)
      saveView(view.current)
      return
    }
    const g = drag.current
    drag.current = null
    if (!g) return
    g.els.forEach((el, i) => {
      el?.classList.remove('dragging', 'lifting', 'pop-free')
      if (el) {
        el.style.left = `${g.orig[i].x}px`
        el.style.top = `${g.orig[i].y}px`
      }
    })
    if (g.banner && g.bOrig) {
      g.banner.style.left = `${g.bOrig.x}px`
      g.banner.style.top = `${g.bOrig.y}px`
    }
    setGhosts(NO_GHOSTS)
    if (!g.moved) return
    markDragEnd()
    const linksBefore = d.board.links.length
    let msg = ''
    let snapIds: string[] = []
    if (g.group.length > 1) {
      const ox = g.gsnap ? g.gsnap.ox : g.dx
      const oy = g.gsnap ? g.gsnap.oy : g.dy
      const np = g.orig.map((o) => ({ x: o.x + ox, y: o.y + oy }))
      if (np.some((p) => occupied(d, p.x, p.y, g.group))) return say('位置被占用')
      const label = `移动 ${islandName(d, g.group)}`
      boardChange(label, (x) => {
        let next: AppState = { ...x, board: { ...x.board, pos: { ...x.board.pos, ...Object.fromEntries(g.group.map((k, i) => [k, np[i]])) } } }
        if (g.gsnap)
          g.group.forEach((k) => {
            next = linkAdjacent(next, k)
          })
        return next
      })
      if (g.gsnap) {
        const after = useApp.getState().data
        useApp.getState().pulse()
        msg = `${islandName(after, compOf(after, g.id))} 合并`
        snapIds = compOf(after, g.id)
      }
    } else if (g.detachSlot) {
      const targetId = g.detachSlot
      const near = g.near
      boardChange(`拆出 ${lemmaOf(d, targetId)}`, (x) => {
        const detached: AppState = { ...x, pieces: { ...x.pieces, [targetId]: { ...x.pieces[targetId], detached: true } } }
        if (near) {
          const out = linkAdjacent(moveTo(detached, targetId, near.x, near.y, true), targetId)
          msg = `${neighborsOf(out, targetId)
            .map((k) => lemmaOf(out, k))
            .join(' · ')} ↔ ${lemmaOf(out, targetId)}`
          return out
        }
        const nx = g.orig[0].x + g.dx
        const ny = g.orig[0].y + g.dy
        if (occupied(x, nx, ny, [targetId])) {
          msg = '位置被占用'
          return x
        }
        msg = `已拆出 ${lemmaOf(x, targetId)}`
        return moveTo(detached, targetId, nx, ny, false)
      })
      useApp.setState({ boardSel: targetId })
      if (near) {
        useApp.getState().pulse()
        const after = useApp.getState().data
        snapIds = [targetId, ...neighborsOf(after, targetId)]
      }
    } else {
      const id = g.id
      const dist = Math.hypot(g.dx, g.dy)
      const near = g.near
      boardChange(`移动 ${lemmaOf(d, id)}`, (x) => {
        if (near) {
          const out = linkAdjacent(moveTo(x, id, near.x, near.y, true), id)
          msg = `${neighborsOf(out, id)
            .map((k) => lemmaOf(out, k))
            .join(' · ')} ↔ ${lemmaOf(out, id)}`
          return out
        }
        if (g.linked && dist <= BREAK_R) return x
        const nx = g.orig[0].x + g.dx
        const ny = g.orig[0].y + g.dy
        if (occupied(x, nx, ny, [id])) {
          msg = '位置被占用'
          return x
        }
        if (g.linked) msg = '已拆开'
        return moveTo(x, id, nx, ny, g.linked)
      })
      useApp.setState({ boardSel: id })
      if (near) {
        useApp.getState().pulse()
        const after = useApp.getState().data
        snapIds = [id, ...neighborsOf(after, id)]
      }
    }
    snapped.current = snapIds
    const linksChanged = useApp.getState().data.board.links.length !== linksBefore
    if (msg) say(msg, linksChanged ? undoBoard : undefined)
    else if (linksChanged) say('已咬合', undoBoard)
  }

  return (
    <div
      className={`board${panning ? ' panning' : ''}`}
      id="board"
      ref={ref}
      style={{ display: hidden ? 'none' : 'block' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onClick={(e) => {
        const u = (e.target as Element).closest<HTMLElement>('.board-unit[data-k]')
        const slotId = (e.target as Element).closest<HTMLElement>('[data-slot-id]')?.dataset.slotId
        if (u) useApp.setState({ boardSel: slotId || (u.dataset.k as string) })
      }}
      onDoubleClick={(e) => {
        const u = (e.target as Element).closest<HTMLElement>('.board-unit[data-k]')
        if (!u) return
        flipFrom.current = rootOf(d, u.dataset.k as string)
        useFlip.getState().toggle(compOf(d, u.dataset.k as string))
      }}
    >
      <div className="blayer" id="blayer" ref={layer}>
        {banners.map((b) => (
          <span key={b.c.join(' ')} className="island-banner" data-isl={b.c.join(' ')} style={{ left: b.x, top: b.y }}>
            {b.text}
          </span>
        ))}
        {ids
          .filter((id) => d.board.pos[id])
          .map((id) => {
            const p = d.pieces[id]
            const r = d.learn[id]
            const group = siblingGroupOf(d, id)
            const chs = group.flatMap((sid) => childrenOf(d, sid))
            const active = boardSel != null && (group.includes(boardSel) || chs.includes(boardSel))
            const due = group.some((sid) => !!dueCard(d.learn[sid], today()))
            const flipped = flipAll !== !!flippedMap[id]
            const slots = mosaicSlotsOf(d, id, defLang, boardSel || undefined)
            const sibs = piecesOfLemma(d, lemmatize(p?.lemma || id))
            const senseNum = !slots.length && sibs.length > 1 ? sibs.indexOf(id) + 1 : 0
            const sub = flipped
              ? defLang === 'en'
                ? p?.tile || pieceGloss(p)
                : shortEnGloss(p)
              : defLang === 'en'
                ? undefined
                : p?.tile || pieceGloss(p)
            return (
              <div
                key={id}
                className={`board-unit${linked.has(id) ? ' linked' : ''}${active ? ' active' : ''}${due ? ' due' : ''}`}
                data-k={id}
                style={{ left: d.board.pos[id].x, top: d.board.pos[id].y }}
              >
                <Piece
                  sides={sides[id]}
                  k={BK}
                  st={r.stage}
                  pos={p?.pos}
                  slots={slots}
                  acc={accOf(d, group)}
                  className={flipped ? 'flipped' : ''}
                  flipDelay={wave[id] || 0}
                  lb={
                    <>
                      <Label word={p?.lemma || id} sub={sub} fixedGrid back={flipped} slots={slots} />
                      {senseNum > 0 && (
                        <span className="sense-dot" title={`义项 ${senseNum}`}>
                          {senseNum}
                        </span>
                      )}
                    </>
                  }
                />
              </div>
            )
          })}
        {ghosts.rec.map((c) => (
          <Piece key={`r${c.x},${c.y}`} sides={ghostSides(c)} k={BK} st={0} pos={ghosts.pos} className="ghost rec" style={{ left: c.x, top: c.y }} />
        ))}
        {ghosts.near && (
          <Piece sides={ghostSides(ghosts.near)} k={BK} st={0} pos={ghosts.pos} className="ghost near" style={{ left: ghosts.near.x, top: ghosts.near.y }} />
        )}
        {ghosts.group.map((c) => (
          <Piece key={`g${c.k}`} sides={[0, 0, 0, 0]} k={BK} st={0} pos={d.pieces[c.k]?.pos} className="ghost near" style={{ left: c.x, top: c.y }} />
        ))}
      </div>
      <div className="bzoom" id="b-zoom" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <button className="btn alt sm" aria-label="缩小" onClick={() => zoomBy(clampZoom(zoom / 1.2))}>
          −
        </button>
        <button className="btn alt sm" id="b-zoom-fit" onClick={fit}>
          {Math.round(zoom * 100)}%
        </button>
        <button className="btn alt sm" aria-label="放大" onClick={() => zoomBy(clampZoom(zoom * 1.2))}>
          +
        </button>
      </div>
    </div>
  )
}
