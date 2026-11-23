import { useRef, type PointerEvent as RPE } from 'react'
import { useApp } from '../app/store'
import { markDragEnd } from '../app/drag'
import { lexOf } from '../lang/lemmatize'
import { highlightParts } from '../core/text'
import { calcWu, Label, Piece } from '../pieces/Piece'
import { bodyBox } from '../pieces/geometry'
import { pieceGlossFor } from '../learn/pieces'
import { senseLine, sensesOfWord } from '../lang/senses'
import { Gloss, lexInfo } from './Popover'
import { meetNew, meetSame, newSenseOptions, pickCurrent, selCtxKey, selMeetKey, selOccIdx, useReader } from './session'
import { dockAI, isMetaAI, type MeetAI } from './aiContext'

function Highlight({ s, w, nth = 0 }: { s: string; w: string; nth?: number }) {
  const hp = highlightParts(s, w, nth)
  if (!hp) return <>{s}</>
  return (
    <>
      {hp[0]}
      <mark>{hp[1]}</mark>
      {hp[2]}
    </>
  )
}

export function CtxDock() {
  const d = useApp((x) => x.data)
  const hasKey = useApp((x) => !!x.ai.apiKey)
  const { sel, ctx, ai, aiStream, set } = useReader()
  const fbRef = useRef<HTMLDivElement>(null)
  const faRef = useRef<HTMLDivElement>(null)

  if (!sel || !ctx) return <section className="ctx" id="ctx" aria-live="polite" />

  let e: { lemma: string; ph?: string; pos?: string }
  let a: { zh?: string; en?: string; ex?: string; tr?: string; st?: string; fam?: string[] }
  const meet = sel.mode === 'meet'
  const occIdx = selOccIdx(d, sel)
  const mKey = meet ? selMeetKey(d, sel) : ''
  const cKey = meet ? '' : selCtxKey(d, sel)
  const activeKey = meet ? mKey : cKey
  const streaming = activeKey in aiStream
  const stream = aiStream[activeKey] as MeetAI | undefined
  const liveMeet = meet ? (ai[mKey] as MeetAI) || stream || null : null
  const loading = meet ? hasKey && !(mKey in ai) && !liveMeet?.zh && !liveMeet?.en : false
  const ref: MeetAI | null = meet ? (ai[mKey] as MeetAI) || (stream?.match !== undefined && (stream.zh || stream.en) ? stream : null) : null
  if (meet) {
    const id = sel.cands[0]
    const info = lexInfo(d, sel)
    e = d.pieces[id] || { lemma: info.lemma, ph: info.ph, pos: info.pos }
    a = liveMeet ? { zh: liveMeet.zh, en: liveMeet.en, tr: liveMeet.tr, st: liveMeet.st, ex: liveMeet.ex, fam: d.pieces[id]?.ai?.fam } : { fam: d.pieces[id]?.ai?.fam }
  } else if (sel.mode !== 'new') {
    const id = sel.k || sel.cands[0]
    e = d.pieces[id] || { lemma: sel.lm }
    const baseA = dockAI(d, id, sel.pid, sel.wi)
    a = stream
      ? {
          zh: baseA.zh || stream.zh,
          en: baseA.en || stream.en,
          fam: baseA.fam?.length ? baseA.fam : stream.fam,
          tr: baseA.tr || stream.tr || '',
          st: baseA.st || stream.st || '',
          ex: baseA.ex || stream.ex || '',
        }
      : baseA
  } else {
    const info = lexInfo(d, sel)
    e = { lemma: info.lemma, ph: info.ph, pos: info.pos }
    const liveNew = ai[cKey] || stream
    const baseFam = lexOf(sel.w)?.[4] || []
    a = liveNew
      ? {
          zh: liveNew.zh || info.g || info.lemma,
          en: liveNew.en || '',
          ex: liveNew.ex || '',
          tr: liveNew.tr || '',
          st: liveNew.st || '',
          fam: liveNew.fam?.length ? liveNew.fam : baseFam,
        }
      : { zh: info.g || info.lemma, en: '', ex: '', tr: '', st: '', fam: baseFam }
  }
  const isMeta = isMetaAI(ref || a)
  const refId = ref && !isMeta && ref.match ? sel.cands[ref.match - 1] : null
  const leftId = meet && !isMeta ? refId || (sel.cands.length === 1 ? sel.cands[0] : null) : null
  const left = leftId ? d.pieces[leftId] : null
  const wu = calcWu(e.lemma)

  const snap = (then: () => void) => {
    const fbw = fbRef.current
    const fa = faRef.current?.querySelector('.pc')
    const fb = fbw?.querySelector('.pc')
    if (fbw && fa && fb) {
      fbw.style.transition = 'none'
      fbw.style.transform = 'none'
      const A = bodyBox(fa, wu)
      const B = bodyBox(fb, wu)
      void fbw.offsetWidth
      fbw.style.transition = ''
      fbw.style.transform = `translateX(${A.r - B.l - 1}px)`
    }
    setTimeout(then, 450)
  }
  const apart = () => {
    if (fbRef.current) fbRef.current.className = 'fb apart'
    setTimeout(meetNew, 380)
  }

  const onDown = (ev: RPE<HTMLDivElement>) => {
    const fbw = fbRef.current
    const fa = faRef.current?.querySelector('.pc')
    if (!fbw || !fa || ev.button > 0 || !leftId) return
    const sx = ev.clientX
    const sy = ev.clientY
    fbw.classList.add('dragging')
    fbw.setPointerCapture(ev.pointerId)
    const A = bodyBox(fa, wu)
    const B0 = bodyBox(fbw.querySelector('.pc') as Element, wu)
    let dx = 0
    let dy = 0
    const near = () => Math.abs(B0.l + dx - A.r) < 26 && Math.abs(dy) < 30
    const mv = (e2: PointerEvent) => {
      dx = e2.clientX - sx
      dy = e2.clientY - sy
      fbw.style.transform = `translate(${dx}px,${dy}px) rotate(${dx / 25}deg)`
      faRef.current?.classList.toggle('glow', near())
    }
    const up = () => {
      fbw.removeEventListener('pointermove', mv)
      fbw.removeEventListener('pointerup', up)
      fbw.removeEventListener('pointercancel', up)
      fbw.classList.remove('dragging')
      if (Math.hypot(dx, dy) > 5) markDragEnd()
      if (near()) snap(() => meetSame(leftId))
      else if (dx > 50 || Math.abs(dy) > 50) apart()
      else {
        fbw.style.transform = ''
        faRef.current?.classList.remove('glow')
      }
    }
    fbw.addEventListener('pointermove', mv)
    fbw.addEventListener('pointerup', up)
    fbw.addEventListener('pointercancel', up)
  }

  const anchor = leftId ? d.learn[leftId]?.occ[0]?.s || left?.s || '' : ''
  const defLang = d.prefs.defLang || 'en'
  const newGloss = ref && !refId && !isMeta ? (defLang === 'en' ? ref.en || ref.zh : ref.zh || ref.en) || '' : ''
  const rawHead = isMeta
    ? defLang === 'en'
      ? 'Multiple senses / word mention'
      : '多义并举 · 词项提及'
    : meet
      ? (defLang === 'en' ? a.en || a.zh : a.zh || a.en) || ''
      : defLang === 'en'
        ? a.en || (sel.mode !== 'new' ? pieceGlossFor(d.pieces[sel.k || sel.cands[0]], 'en') : '')
        : a.zh
  const headGloss = loading || (streaming && !rawHead) ? '语境解析中…' : rawHead
  const leftGloss = left ? pieceGlossFor(left, defLang) : ''
  const extraOpts =
    meet && (!ref || isMeta) && !loading && !streaming
      ? newSenseOptions(sel).options
      : sel.mode === 'new' && isMeta
        ? sensesOfWord(e.lemma).length
          ? sensesOfWord(e.lemma).map((r) => senseLine(r, defLang))
          : lexInfo(d, sel).lines
        : []

  return (
    <section className="ctx open" id="ctx" aria-live="polite">
      <div className="hd">
        <button className="x" aria-label="关闭" onClick={() => set({ ctx: false })}>
          ×
        </button>
        <div className="wd">{meet && left ? left.lemma : e.lemma}</div>
        <div className="ph2">{[e.ph, e.pos].filter(Boolean).join(' · ')}</div>
        {headGloss && <div className="zh">{headGloss}</div>}
      </div>
      <div className="bd">
        {defLang !== 'en' && a.ex && (
          <div>
            <p>{a.ex}</p>
          </div>
        )}
        {defLang === 'en' && a.ex && !/[\u4e00-\u9fff]/.test(a.ex) && <p>{a.ex}</p>}
        {extraOpts.length > 0 && (
          <div className="card">
            <Gloss
              lines={extraOpts}
              choose={(g) => {
                if (meet) meetNew(g)
                else {
                  set({ sel: { ...sel, gloss: g }, ctx: false })
                  pickCurrent()
                }
              }}
            />
          </div>
        )}
        {meet && !leftId && (
          <div className="pr">
            {newGloss && (
              <button className="btn mint sm" onClick={() => meetNew(newGloss)}>
                按此新义摘取
              </button>
            )}
            <button className="btn alt sm" onClick={() => set({ ctx: false, po: true, askNew: !!newGloss })}>
              选择义项
            </button>
          </div>
        )}
        {meet && left && leftId && (
          <div className="fit-box" key={`${sel.pid}:${sel.wi}`}>
            <div className="small mut">
              {leftGloss} · <span style={{ fontFamily: 'var(--read)' }}>{anchor}</span>
            </div>
            <div className="fit" id="fit">
              <div className="fa" ref={faRef}>
                <Piece sides={[0, 1, 0, 0]} k={0.62} st={d.learn[leftId].stage} lb={<Label word={left.lemma} sub={defLang === 'zh' ? left.tile : undefined} />} pos={left.pos} wu={wu} />
              </div>
              <div className="fb" id="fb" ref={fbRef} onPointerDown={onDown}>
                <Piece sides={[0, 0, 0, -1]} k={0.62} st={1} lb={<Label word={left.lemma} sub={newGloss ? (defLang === 'zh' ? newGloss.slice(0, 4) : undefined) : '?'} />} pos={left.pos} wu={wu} />
              </div>
            </div>
            {ref && (
              <div className="small" style={{ fontWeight: 700, textAlign: 'center', color: refId ? 'var(--s2-d)' : 'var(--s5-d)' }}>
                {refId ? `同一含义${sel.cands.length > 1 ? ` · ${pieceGlossFor(d.pieces[refId], defLang)}` : ''}` : `新义${newGloss ? ` · ${newGloss}` : ''}`}
                {defLang === 'zh' && ref.reason ? ` · ${ref.reason}` : ''}
              </div>
            )}
            <div className="pr" style={{ justifyContent: 'center' }}>
              {newGloss ? (
                <>
                  <button className="btn mint sm" onClick={() => meetNew(newGloss)}>
                    按此新义摘取
                  </button>
                  <button className="btn alt sm" onClick={apart}>
                    其他义项
                  </button>
                  <button className="btn alt sm" onClick={() => snap(() => meetSame(leftId))}>
                    同一含义
                  </button>
                </>
              ) : (
                <>
                  <button className="btn mint sm" onClick={() => snap(() => meetSame(leftId))}>
                    同一含义
                  </button>
                  <button className="btn alt sm" onClick={apart}>
                    新义
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        <div className="card">
          {sel.pg != null && (
            <div className="small mut" style={{ fontWeight: 700 }}>
              p.{sel.pg}
            </div>
          )}
          <div style={{ font: '15.5px/1.7 var(--read)', margin: '5px 0' }}>
            <Highlight s={sel.s} w={sel.w} nth={occIdx} />
          </div>
          {a.tr ? <p>{a.tr}</p> : streaming && !a.st ? <p className="mut small">语境解析中…</p> : null}
          {a.st && (
            <p className="mut small" style={{ marginTop: 6 }}>
              {a.st}
            </p>
          )}
        </div>
        {(a.fam || []).length > 0 && (
          <div>
            {(a.fam || []).map((f) => (
              <span key={f} className="chip">
                {f}
              </span>
            ))}
          </div>
        )}
        {sel.mode === 'new' && !isMeta && (
          <div>
            <button className="btn mint" onClick={() => pickCurrent()}>
              <svg className="ico">
                <use href="#i-puzzle" />
              </svg>
              摘取 <kbd>L</kbd>
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
