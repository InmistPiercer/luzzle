let dragEnded = false

if (typeof window !== 'undefined')
  window.addEventListener(
    'click',
    (e) => {
      if (dragEnded) {
        e.stopPropagation()
        e.preventDefault()
      }
    },
    true,
  )

export const markDragEnd = () => {
  dragEnded = true
  setTimeout(() => {
    dragEnded = false
  }, 0)
}

export interface FloatOptions {
  targets: string
  ghostHTML?: string
  accept?: (el: Element) => boolean
  start?: () => void
  end?: () => void
  drop: (over: Element | null, ev: PointerEvent) => boolean | void
}

export function startFloat(e: { button: number; clientX: number; clientY: number }, el: HTMLElement, o: FloatOptions) {
  if (e.button > 0) return
  const sx = e.clientX
  const sy = e.clientY
  let g: HTMLElement | null = null
  let over: Element | null = null
  const findOver = (x: number, y: number) => {
    const hit = document.elementFromPoint(x, y)?.closest(o.targets) || null
    return hit && (!o.accept || o.accept(hit)) ? hit : null
  }
  const mv = (ev: PointerEvent) => {
    const dx = ev.clientX - sx
    const dy = ev.clientY - sy
    if (!g) {
      if (Math.hypot(dx, dy) < 6) return
      const r = el.getBoundingClientRect()
      if (o.ghostHTML) {
        g = document.createElement('div')
        g.innerHTML = o.ghostHTML
        g.style.cssText = `left:${ev.clientX - 30}px;top:${ev.clientY - 30}px`
      } else {
        g = el.cloneNode(true) as HTMLElement
        g.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`
      }
      g.classList.add('drag-ghost')
      g.removeAttribute('id')
      document.body.appendChild(g)
      el.classList.add('drag-src')
      document.body.classList.add('is-dragging')
      window.getSelection()?.removeAllRanges()
      o.start?.()
    }
    g.style.transform = `translate(${dx}px,${dy}px) rotate(${Math.max(-8, Math.min(8, dx / 30))}deg) scale(1.06)`
    const nv = findOver(ev.clientX, ev.clientY)
    if (nv !== over) {
      over?.classList.remove('drop-hot')
      over = nv
      over?.classList.add('drop-hot')
    }
  }
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', mv)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    if (!g) return
    const ghost = g
    markDragEnd()
    over?.classList.remove('drop-hot')
    el.classList.remove('drag-src')
    document.body.classList.remove('is-dragging')
    const ok = o.drop(over, ev)
    o.end?.()
    if (ok === false || !over) {
      const t0 = ghost.style.transform
      ghost.animate([{ transform: t0 }, { transform: 'translate(0,0) scale(1)' }], { duration: 240, easing: 'ease-out' }).onfinish = () => ghost.remove()
    } else ghost.remove()
  }
  window.addEventListener('pointermove', mv)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

export const escHTML = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
