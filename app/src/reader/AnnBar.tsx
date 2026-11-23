import { useLayoutEffect, useRef } from 'react'
import { useApp } from '../app/store'
import { annToPhrase, useReader } from './session'

export function AnnBar() {
  const { ann, set } = useReader()
  const update = useApp((x) => x.update)
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const bar = ref.current
    const r = document.getElementById('rd')
    if (!ann || !bar || !r) return
    const el = document.querySelector(`#col p[data-id="${CSS.escape(ann.pid)}"] .w[data-wi="${ann.w0}"]`)
    const seg = el?.closest('.ann-seg') || el
    if (!seg) return
    const a = seg.getBoundingClientRect()
    const b = r.getBoundingClientRect()
    bar.style.left = `${Math.max(14, Math.min(a.left - b.left + r.scrollLeft, r.clientWidth - bar.offsetWidth - 18))}px`
    bar.style.top = `${Math.max(8, a.top - b.top + r.scrollTop - 44)}px`
  })

  const each = (f: (marks: Record<string, { hl?: string }>, k: string) => void) =>
    update((d) => {
      if (!ann) return d
      const marks = { ...d.marks }
      for (let wi = ann.w0; wi <= ann.w1; wi++) f(marks, `${ann.pid}:${wi}`)
      return { ...d, marks }
    })

  if (!ann) return <div className="ann-bar" id="ann-bar" role="toolbar" aria-label="标注操作" ref={ref} />
  const canPhrase = ann.words.length >= 2 && ann.words.length <= 6
  return (
    <div className="ann-bar open" id="ann-bar" role="toolbar" aria-label="标注操作" ref={ref}>
      {['y', 'g', 'p', 'b'].map((c) => (
        <button
          key={c}
          className={`pen-sw${ann.hl === c ? ' on' : ''}`}
          data-c={c}
          aria-label="换色"
          onClick={() => {
            each((m, k) => {
              if (m[k]) m[k] = { ...m[k], hl: c }
            })
            set({ ann: null })
          }}
        />
      ))}
      {canPhrase && (
        <>
          <span className="sep" />
          <button className="btn sm" style={{ padding: '3px 10px', fontSize: 12 }} onClick={annToPhrase}>
            <svg className="ico">
              <use href="#i-puzzle" />
            </svg>
            合成短语
          </button>
        </>
      )}
      <span className="sep" />
      <button
        className="btn alt sm"
        style={{ padding: '3px 8px' }}
        aria-label="删除标注"
        onClick={() => {
          each((m, k) => delete m[k])
          set({ ann: null })
        }}
      >
        <svg className="ico">
          <use href="#i-trash" />
        </svg>
      </button>
    </div>
  )
}
