import { useLayoutEffect, useRef } from 'react'
import { useApp } from '../app/store'
import { parentOf } from '../learn/pieces'
import { Piece } from '../pieces/Piece'
import { useReader } from './session'

export function FlyLayer() {
  const fly = useReader((x) => x.fly)
  const data = useApp((x) => x.data)
  const style = useApp((x) => x.data.prefs.style)
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!fly || !el) return
    const done = () => useReader.getState().set({ fly: null })
    const key = parentOf(data, fly.id) || fly.id
    const target = document.querySelector<HTMLElement>(`#tpc .tp[data-k="${CSS.escape(key)}"]`)
    if (!target || matchMedia('(prefers-reduced-motion: reduce)').matches) return done()
    target.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    target.classList.remove('new')
    target.style.visibility = 'hidden'
    const g = target.getBoundingClientRect()
    const a = fly.rect
    const x0 = a.left + a.width / 2 - 27
    const y0 = a.top - 14
    el.style.left = `${x0}px`
    el.style.top = `${y0}px`
    const tx = g.left + 4 - x0
    const ty = g.top - 6 - y0
    const timing = {
      duration: style === 'amber' ? 560 : style === 'neon' ? 720 : 760,
      easing: style === 'amber' ? 'cubic-bezier(.3, 0, .2, 1)' : style === 'neon' ? 'cubic-bezier(.22, 1, .36, 1)' : 'cubic-bezier(.45, 0, .35, 1)',
    }
    const frames =
      style === 'amber'
        ? [
            { transform: 'translate(0, 0) scale(1)' },
            { transform: `translate(${tx}px, ${ty}px) scale(.75)` },
          ]
        : style === 'neon'
          ? [
              { transform: 'translate(0, 0) scale(1)', filter: 'brightness(1.8) drop-shadow(0 0 14px #FF4FA3)', offset: 0 },
              { transform: 'translate(0, -6px) scale(1.04)', filter: 'brightness(1.6) drop-shadow(0 0 18px #FF4FA3)', offset: 0.17 },
              { transform: `translate(${tx * 0.72}px, ${ty * 0.72}px) scale(.84)`, filter: 'brightness(1.35) blur(.5px)', offset: 0.76 },
              { transform: `translate(${tx}px, ${ty}px) scale(.75)`, filter: 'brightness(1.1)', offset: 1 },
            ]
          : style === 'draft'
            ? [
                { transform: 'translate(0, 0) scale(1) rotate(0deg)', offset: 0 },
                { transform: `translate(${tx * 0.22}px, -46px) scale(1.26) rotate(0deg)`, offset: 0.42 },
                { transform: `translate(${tx}px, ${ty}px) scale(.75) rotate(90deg)`, offset: 1 },
              ]
            : [
                { transform: 'translate(0, 0) scale(1) rotate(0deg)' },
                { transform: `translate(${tx * 0.45}px, ${Math.min(-74, ty * 0.2 - 72)}px) scale(1.35) rotate(-18deg)`, offset: 0.45 },
                { transform: `translate(${tx}px, ${ty}px) scale(.75) rotate(360deg)` },
              ]
    const anim = el.animate(frames, timing)
    anim.onfinish = () => {
      target.style.visibility = ''
      target.classList.add('new')
      const say = document.getElementById('say')
      if (say) {
        say.classList.remove('hop')
        void say.offsetWidth
        say.classList.add('hop')
      }
      if (style === 'neon') {
        const shelf = document.getElementById('shelf')
        if (shelf) {
          shelf.classList.remove('neon-catch')
          void shelf.offsetWidth
          shelf.classList.add('neon-catch')
        }
      }
      done()
    }
    return () => {
      target.style.visibility = ''
    }
  }, [fly])

  if (!fly) return null
  return (
    <div ref={ref} className={`fly fly-${style}`}>
      <Piece sides={[1, 0, -1, 0]} k={0.36} st={3} lb="" pos={data.pieces[fly.id]?.pos} />
    </div>
  )
}
