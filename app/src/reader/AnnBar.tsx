import { useLayoutEffect, useRef } from 'react'
import { useApp } from '../app/store'
import { annPhrasePreview, annToPhrase, useReader } from './session'

export function AnnBar() {
  const { ann, set } = useReader()
  const data = useApp((x) => x.data)
  useApp((x) => x.dictSeq)
  const update = useApp((x) => x.update)
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const bar = ref.current
    const r = document.getElementById('rd')
    if (!ann || !bar || !r) return
    const el = document.querySelector(`#col p[data-id="${CSS.escape(ann.pid)}"] .w[data-wi="${ann.w0}"]`)
    const seg = (!ann.pickOnly && el?.closest('.ann-seg')) || el
    if (!seg) return
    const a = seg.getBoundingClientRect()
    const b = r.getBoundingClientRect()
    bar.style.left = '14px'
    const w = bar.offsetWidth
    const h = bar.offsetHeight || 40
    const above = a.top - b.top >= h + 14
    bar.style.left = `${Math.max(14, Math.min(a.left - b.left + r.scrollLeft, r.clientWidth - w - 18))}px`
    bar.style.top = `${above ? a.top - b.top + r.scrollTop - h - 8 : a.bottom - b.top + r.scrollTop + 8}px`
  })

  const each = (f: (marks: Record<string, { hl?: string }>, k: string) => void) =>
    update((d) => {
      if (!ann) return d
      const marks = { ...d.marks }
      for (let wi = ann.w0; wi <= ann.w1; wi++) f(marks, `${ann.pid}:${wi}`)
      return { ...d, marks }
    })

  if (!ann) return <div className="ann-bar" id="ann-bar" role="toolbar" aria-label="标注操作" ref={ref} />
  const { kept, text, preview, hasGap, maxGap } = annPhrasePreview(data, ann)
  const canPhrase = kept.length >= 2 && kept.length <= 6 && maxGap <= 6
  const showPreview = hasGap || preview !== text.toLowerCase()
  const showChips = !ann.pickOnly && ann.wis.length >= 3 && ann.wis.length <= 10
  const skipSet = new Set(ann.skip || [])
  const toggleSkip = (wi: number) => {
    const next = skipSet.has(wi) ? (ann.skip || []).filter((x) => x !== wi) : [...(ann.skip || []), wi]
    set({ ann: { ...ann, skip: next } })
  }

  return (
    <div className={`ann-bar open${showChips ? ' has-chips' : ''}`} id="ann-bar" role="toolbar" aria-label="标注操作" ref={ref}>
      <div className="ann-bar-row">
        {ann.pickOnly ? (
          <>
            <span className="ann-preview">{preview}</span>
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
            <button className="btn alt sm" style={{ padding: '2px 8px', fontSize: 12 }} aria-label="取消选词" onClick={() => set({ ann: null })}>
              ×
            </button>
          </>
        ) : (
          <>
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
                {showPreview && <span className="ann-preview">{preview}</span>}
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
          </>
        )}
      </div>
      {showChips && (
        <div className="ann-chips">
          {ann.wis.map((wi, idx) => {
            const off = skipSet.has(wi)
            return (
              <button key={wi} type="button" className={`ann-chip${off ? ' off' : ''}`} onClick={() => toggleSkip(wi)}>
                {ann.words[idx]}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
