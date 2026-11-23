import { Fragment, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPE } from 'react'
import { escHTML, markDragEnd, startFloat } from '../app/drag'
import { useApp } from '../app/store'
import { allDocs, setDocFlags } from '../content/docs'
import { today } from '../core/date'
import { lemmatize } from '../lang/lemmatize'
import { ensureDict } from '../lang/lexdict'
import { ensurePhrases } from '../lang/senses'
import { isPhraseId, lemmaOf } from '../learn/pieces'
import { AppearancePop } from '../theme/AppearancePop'
import { AnnBar } from './AnnBar'
import { CtxDock } from './CtxDock'
import { importReaderFile } from './docActions'
import { ParaText } from './Paragraph'
import { Popover } from './Popover'
import { closePop, curDocOf, needsRecall, normWordsOf, originsOf, pickCurrent, pickWord, recallGateId, triggerAI, useReader } from './session'
import { Shelf } from './Shelf'
import { DocBar } from './DocBar'
import { pageOfPara, paginate, type Item } from './paginate'
import type { TrMode } from '../core/types'
import { loadTr, pendingBatches, srcOf, translateDoc, TR_PROMPT, useTr, zhOf } from './translate'
import { aiDeps, requireKey } from '../ai/ask'
import { AIConfirm, confirmAI, planOf, type ScopeOption } from '../ai/Confirm'
import { PdfBusy, PdfPicker, requestRebuild, usePdf } from '../pdf/PdfUI'

type Mode = 'basic' | 'rebuilt'

const TR_LABEL: Record<TrMode, string> = { src: '原文', bi: '双语', tr: '译文' }

interface Paint {
  pEl: HTMLElement
  pid: string
  color: string
  erase: boolean
  w0: number
  w1: number
  moved: boolean
  sx: number
  sy: number
}

const PAINT = ['y', 'g', 'p', 'b'].map((c) => `paint-hl-${c}`)
const clearPaint = (pEl: Element) => pEl.querySelectorAll('.w').forEach((el) => el.classList.remove(...PAINT))

function groupBack(items: Item[]): (Item | Item[])[] {
  const out: (Item | Item[])[] = []
  for (const it of items) {
    if (it.p.kind === 'back') {
      const last = out[out.length - 1]
      if (Array.isArray(last)) last.push(it)
      else out.push([it])
    } else out.push(it)
  }
  return out
}

export function ReaderView() {
  const data = useApp((x) => x.data)
  const update = useApp((x) => x.update)
  const say = useApp((x) => x.say)
  const view = useApp((x) => x.view)
  const dictSeq = useApp((x) => x.dictSeq)
  const running = usePdf((x) => x.running)
  const { cur, pen, penColor, sel, jump, set } = useReader()
  const trMap = useTr((x) => x.map)
  const trRun = useTr((x) => x.running)
  const docs = allDocs(data)
  const vault = data.vaults[data.curVault] || data.vaults[0]
  const list = docs.filter((x) => x.vault === data.curVault)
  const doc = list.find((x) => x.id === cur) || list[0]
  const trMode: TrMode = doc?.tr || 'src'
  const curDoc = doc?.id || ''
  const canRebuild = !!doc && (!!doc.aiChunks?.length || doc.paras.some((p) => p.raw))
  const mode: Mode = doc?.rebuilt && canRebuild && (!doc.aiChunks || doc.parasAI) ? 'rebuilt' : 'basic'
  const pageLen = data.prefs.pageLen || 'mid'
  const pages = doc ? paginate(doc, pageLen) : [[]]
  const page = Math.min(Math.max(0, doc?.page || 0), pages.length - 1)
  const setPage = (n: number) => {
    if (!doc) return
    const next = Math.min(Math.max(0, n), pages.length - 1)
    if (next === page) return
    update((d) => setDocFlags(d, doc.id, { page: next }))
    set({ po: false, ann: null })
  }
  useLayoutEffect(() => {
    if (jump && jumpDone.current !== jump.seq) return
    document.getElementById('rd')?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [page, curDoc])
  const pageLetters = [...new Set(pages[page].flatMap((it) => (it.p.t || '').match(/\b[a-z]/gi) || []).map((c) => c.toLowerCase()))].join('')
  useEffect(() => {
    void ensurePhrases('_')
    for (const c of pageLetters) {
      void ensureDict(c)
      void ensurePhrases(c)
    }
  }, [pageLetters])
  const [pop, setPop] = useState(false)
  const [focus, setFocus] = useState<{ id: string; seq: number } | null>(null)
  const [dropHot, setDropHot] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const painting = useRef<Paint | null>(null)
  const jumpDone = useRef(0)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element
      if (!t.isConnected) return
      if (!t.closest('.w,.po,.ctx,.tp,#aa,#pop,.ann-bar')) {
        setPop(false)
        closePop()
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).matches('input,textarea,select')) return
      const r = useReader.getState()
      if (e.key === 'Escape') {
        r.set({ po: false, ctx: false, ann: null })
      }
      if (useApp.getState().view === 'read' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const btn = document.querySelector<HTMLButtonElement>(e.key === 'ArrowLeft' ? '#pager-prev' : '#pager-next')
        if (btn && !btn.disabled) {
          e.preventDefault()
          btn.click()
        }
        return
      }
      if (useApp.getState().view !== 'read' || !r.po || !r.sel || r.askNew || r.askHead) return
      if (e.key === 'Enter') {
        const d = useApp.getState().data
        const gateId = recallGateId(d, r.sel)
        if (gateId && needsRecall(d, r.sel, gateId, today())) return
        e.preventDefault()
        void triggerAI()
      }
      if (e.key.toLowerCase() === 'l' && !e.metaKey && !e.ctrlKey) {
        if (r.sel.mode === 'new') pickCurrent()
        else if (r.sel.mode === 'meet') void triggerAI()
        else say('已在拼块中')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [say])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const pt = painting.current
      if (!pt) return
      if (!pt.moved && Math.hypot(e.clientX - pt.sx, e.clientY - pt.sy) > 4) {
        pt.moved = true
        useReader.getState().set({ po: false })
      }
      if (!pt.moved) return
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.w')
      if (el && el.closest('p') === pt.pEl) pt.w1 = Number(el.dataset.wi)
      const lo = Math.min(pt.w0, pt.w1)
      const hi = Math.max(pt.w0, pt.w1)
      pt.pEl.querySelectorAll<HTMLElement>('.w').forEach((x) => {
        x.classList.remove(...PAINT)
        const wi = Number(x.dataset.wi)
        if (wi >= lo && wi <= hi && !pt.erase) x.classList.add(`paint-hl-${pt.color}`)
      })
    }
    const up = () => {
      const pt = painting.current
      painting.current = null
      if (!pt) return
      clearPaint(pt.pEl)
      if (!pt.moved) return
      const lo = Math.min(pt.w0, pt.w1)
      const hi = Math.max(pt.w0, pt.w1)
      update((d) => {
        const marks = { ...d.marks }
        for (let wi = lo; wi <= hi; wi++) {
          const key = `${pt.pid}:${wi}`
          if (pt.erase) delete marks[key]
          else marks[key] = { hl: pt.color }
        }
        return { ...d, marks }
      })
      if (!pt.erase) {
        const curNow = curDocOf(useApp.getState().data)
        const p = curNow?.paras.find((x) => x.id === pt.pid)
        if (p) {
          const norm = normWordsOf(p.t)
          const wis = Array.from({ length: hi - lo + 1 }, (_, idx) => lo + idx).filter((wi) => norm[wi])
          if (wis.length) useReader.getState().set({ ann: { pid: pt.pid, w0: wis[0], w1: wis[wis.length - 1], words: wis.map((i) => norm[i]), hl: pt.color } })
        }
      } else useReader.getState().set({ ann: null })
      markDragEnd()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [update])

  useEffect(() => {
    if (!jump || jumpDone.current === jump.seq) return
    const d = useApp.getState().data
    const o = originsOf(d, jump.id)[jump.i]
    if (!o) return
    const curDocNow = allDocs(d)[o.di]
    if (curDocNow) {
      const pg = paginate(curDocNow, d.prefs.pageLen || 'mid')
      const want = pageOfPara(pg, o.pid || '')
      if (want >= 0 && want !== Math.min(Math.max(0, curDocNow.page || 0), pg.length - 1)) {
        update((x) => setDocFlags(x, curDocNow.id, { page: want }))
        return
      }
    }
    const pEl = document.querySelector(`#col p[data-id="${CSS.escape(o.pid || '')}"]`)
    if (!pEl) return
    const all = [...pEl.querySelectorAll<HTMLElement>('.w')]
    let els: HTMLElement[] = []
    if (isPhraseId(d, jump.id)) els = all.filter((el) => el.dataset.pc === jump.id)
    if (!els.length && o.wi != null) els = all.filter((x) => Number(x.dataset.wi) === o.wi).slice(0, 1)
    if (!els.length) {
      const lm = lemmatize(lemmaOf(d, jump.id).toLowerCase())
      const el = all.find((x) => x.dataset.pc === jump.id) || all.find((x) => lemmatize(x.dataset.w || '') === lm)
      if (el) els = [el]
    }
    jumpDone.current = jump.seq
    if (!els.length) return say('原文已变动，无法定位')
    els[0].scrollIntoView({ block: 'center', behavior: 'smooth' })
    els.forEach((el) => {
      el.classList.remove('jump-hl')
      void el.offsetWidth
      el.classList.add('jump-hl')
    })
    const first = els[0]
    const t = setTimeout(() => {
      if (first.isConnected) pickWord(o.pid as string, Number(first.dataset.wi), first.dataset.w || '')
    }, 340)
    return () => clearTimeout(t)
  }, [jump?.seq, page, curDoc])

  const allParas = pages.flat().map((x) => x.p)
  useEffect(() => {
    void loadTr(allParas)
  }, [curDoc, mode, allParas.length])

  useEffect(() => {
    if (!focus) return
    const el = document.querySelector<HTMLElement>(trMode === 'tr' ? `#col [data-tid="${CSS.escape(focus.id)}"]` : `#col p[data-id="${CSS.escape(focus.id)}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.remove('p-flash')
    void el.offsetWidth
    el.classList.add('p-flash')
  }, [focus?.seq])

  const showTr = (m: TrMode) => doc && update((d) => setDocFlags(d, doc.id, { tr: m }))

  const goPara = (m: TrMode, id: string) => {
    showTr(m)
    setFocus({ id, seq: (focus?.seq || 0) + 1 })
  }

  const setTr = async (m: TrMode) => {
    if (m === 'src' || !doc || trRun) {
      showTr(m)
      return
    }
    await loadTr(allParas)
    const map = useTr.getState().map
    const curBatch = pendingBatches([pages[page]], 0, map)
    const allBatch = pendingBatches(pages, page, map)
    if (!curBatch.chunks.length || !allBatch.chunks.length) {
      showTr(m)
      return
    }
    if (!requireKey()) return
    const start = (chunks: string[][], fit: number) => {
      showTr(m)
      void translateDoc(doc.id, chunks.slice(0, fit), { ai: useApp.getState().ai, call: aiDeps() }, say)
    }
    const scopes: ScopeOption[] = [
      {
        label: '仅当前页',
        plan: planOf(curBatch.chunks.map((c) => JSON.stringify(c)), TR_PROMPT, 1.4, curBatch.pageCounts),
        onOk: (fit) => start(curBatch.chunks, fit),
      },
    ]
    if (allBatch.pages > 5) {
      const order = [...pages.keys()].slice(page).concat([...pages.keys()].slice(0, page))
      const fivePages: Item[][] = []
      for (const idx of order) {
        if (pendingBatches([pages[idx]], 0, map).chunks.length) fivePages.push(pages[idx])
        if (fivePages.length >= 5) break
      }
      const five = pendingBatches(fivePages, 0, map)
      scopes.push({
        label: '本页起 5 页',
        plan: planOf(five.chunks.map((c) => JSON.stringify(c)), TR_PROMPT, 1.4, five.pageCounts),
        onOk: (fit) => start(five.chunks, fit),
      })
    }
    if (allBatch.pages > 1) {
      scopes.push({
        label: `未译全文（${allBatch.pages} 页）`,
        plan: planOf(allBatch.chunks.map((c) => JSON.stringify(c)), TR_PROMPT, 1.4, allBatch.pageCounts),
        onOk: (fit) => start(allBatch.chunks, fit),
      })
    }
    confirmAI({ title: m === 'bi' ? '双语翻译' : '全文译文', sub: doc.title, ...scopes[0].plan, onOk: scopes[0].onOk, scopes })
  }

  const curPdfPage = pages[page]?.find((it) => it.p.pg != null)?.p.pg

  const setMode = (m: Mode) => {
    if (!doc) return
    if (m === 'rebuilt' && doc.aiChunks) return requestRebuild(doc, curPdfPage)
    if (m === 'rebuilt') update((d) => setDocFlags(d, doc.id, { rebuilt: true, cachedRebuilt: true }))
    if (m === 'basic') update((d) => setDocFlags(d, doc.id, { rebuilt: false }))
  }

  const importFile = importReaderFile

  const renderItem = (it: Item) => {
                const p = it.p
                const i = it.i
                if (it.kind === 'h') return <h2 key={i}>{p.h}</h2>
                if (it.kind === 'junk')
                  return (
                    <div key={i} className="junk">
                      {p.junk}
                    </div>
                  )
                const id = p.id as string
                if (p.kind === 'code')
                  return (
                    <pre key={id} className="p-code">
                      {p.t}
                    </pre>
                  )
                const zh = zhOf(trMap, p)
                if (trMode === 'tr')
                  return (
                    <p key={id} data-tid={id} className={`tr-p${zh ? '' : ' wait'}`} onClick={() => goPara('src', id)}>
                      {zh || srcOf(p)}
                    </p>
                  )
                return (
                  <Fragment key={id}>
                    <p data-id={id} className={p.kind && p.kind !== 'para' && p.kind !== 'back' ? `p-${p.kind}` : undefined}>
                      {zh && trMode === 'src' && (
                        <button className="tr-go" aria-label="译文" onClick={() => goPara('tr', id)}>
                          译
                        </button>
                      )}
                      <ParaText data={data} dictSeq={dictSeq} p={p} rebuilt={!!doc.rebuilt} selWi={sel && sel.pid === id && view === 'read' ? sel.wi : null} />
                    </p>
                    {zh && trMode === 'bi' && <div className="tr-sub">{zh}</div>}
                  </Fragment>
                )
              }

  const openAnn = (seg: Element) => {
    const pEl = seg.closest('p') as HTMLElement | null
    const p = doc?.paras.find((x) => x.id === pEl?.dataset.id)
    if (!pEl || !p) return
    const wis = [...new Set([...seg.querySelectorAll<HTMLElement>('.w')].map((x) => Number(x.dataset.wi)))]
    if (!wis.length) return
    const norm = normWordsOf(p.t)
    set({ ann: { pid: p.id as string, w0: wis[0], w1: wis[wis.length - 1], words: wis.map((i) => norm[i]), hl: (seg as HTMLElement).dataset.hl || 'y' } })
  }

  const onColClick = (e: React.MouseEvent) => {
    const t = e.target as Element
    if (t.closest('#imp-drop')) return file.current?.click()
    const w = t.closest<HTMLElement>('.w')
    const seg = t.closest('.ann-seg')
    if (w) {
      const pid = (w.closest('p') as HTMLElement).dataset.id as string
      pickWord(pid, Number(w.dataset.wi), w.dataset.w || '')
      if (seg) openAnn(seg)
      else set({ ann: null })
    } else if (seg) openAnn(seg)
  }

  const onColDown = (e: RPE) => {
    const w = (e.target as Element).closest<HTMLElement>('.w')
    if (!w || e.button > 0) return
    const shiftHl = e.shiftKey && pen === 'pick'
    if (shiftHl || pen === 'hl') {
      e.preventDefault()
      window.getSelection()?.removeAllRanges()
      const pEl = w.closest('p') as HTMLElement
      const pid = pEl.dataset.id as string
      const wi = Number(w.dataset.wi)
      painting.current = { pEl, pid, color: penColor, erase: !shiftHl && data.marks[`${pid}:${wi}`]?.hl === penColor, w0: wi, w1: wi, moved: false, sx: e.clientX, sy: e.clientY }
      return
    }
    if (e.pointerType === 'touch') return
    startFloat(e, w, {
      targets: '#shelf',
      ghostHTML: `<span class="w-ghost">${escHTML(w.textContent || '')}</span>`,
      drop: (over) => {
        if (!over) return false
        const pid = (w.closest('p') as HTMLElement).dataset.id as string
        pickWord(pid, Number(w.dataset.wi), w.dataset.w || '')
        if (useReader.getState().sel?.mode === 'new') pickCurrent()
        else say('已在拼块中')
      },
    })
  }


  return (
    <>
      <div className="top">
        <DocBar doc={doc} onPick={(id) => set({ cur: id, sel: null, po: false, ctx: false, ann: null })} onImport={() => file.current?.click()} />
        <div className="row2">
          {canRebuild && (
            <button className={`btn sm ${mode === 'rebuilt' ? 'on' : 'alt'}`} id="mode" onClick={() => setMode(mode === 'rebuilt' ? 'basic' : 'rebuilt')}>
              <svg className="ico">
                <use href="#i-spark" />
              </svg>
              AI 重排{running?.docId === doc?.id ? ` ${running.done}/${running.total}` : ''}
            </button>
          )}
          {doc && (
            <div className="seg" id="trmode" role="group">
              {(['src', 'bi', 'tr'] as const).map((m) => (
                <button key={m} className={trMode === m ? 'on' : ''} onClick={() => void setTr(m)}>
                  {TR_LABEL[m]}
                  {trRun?.docId === doc.id && m === (trMode === 'src' ? 'tr' : trMode) ? ` ${trRun.done}/${trRun.total}` : ''}
                </button>
              ))}
              {trRun?.docId === doc.id && (
                <button className="seg-x" aria-label="停止翻译" onClick={() => useTr.getState().set({ running: null })}>
                  ×
                </button>
              )}
            </div>
          )}
          <button className={`btn sm ${pen === 'hl' ? 'on' : 'alt'}`} id="pens" onClick={() => set({ pen: pen === 'hl' ? 'pick' : 'hl' })}>
            荧光笔
          </button>
          {pen === 'hl' && (
            <div className="pen-pal show" id="pen-pal">
              {[
                ['y', '黄色'],
                ['g', '绿色'],
                ['p', '粉色'],
                ['b', '蓝色'],
              ].map(([c, lb]) => (
                <button key={c} className={`pen-sw${penColor === c ? ' on' : ''}`} data-c={c} aria-label={lb} onClick={() => set({ penColor: c })} />
              ))}
            </div>
          )}
          <button className="btn alt sm" id="aa" aria-expanded={pop} onClick={() => setPop((p) => !p)}>
            Aa
          </button>
        </div>
        <AppearancePop open={pop} />
      </div>

      <div
        className={`reader${pen !== 'pick' ? ' pen-active' : ''}`}
        id="rd"
        data-pen={pen !== 'pick' ? penColor : undefined}
        data-mode={mode}
        onDragOver={(e) => {
          e.preventDefault()
          setDropHot(true)
        }}
        onDragLeave={() => setDropHot(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDropHot(false)
          importFile(e.dataTransfer.files[0])
        }}
      >
        <div className="col" id="col" onClick={onColClick} onPointerDown={onColDown}>
          {!doc ? (
            <div className="empty-state">
              <div style={{ font: '800 22px var(--read)' }}>{vault.name}</div>
              <button className={`drop${dropHot ? ' drop-hot' : ''}`} id="imp-drop">
                ＋ 导入 EPUB / PDF / TXT / Markdown
              </button>
            </div>
          ) : (
            <>
              <h1>{doc.title}</h1>
              {groupBack(pages[page]).map((g, gi) =>
                Array.isArray(g) ? (
                  <details key={`b${gi}`} className="backmatter">
                    <summary>{(g[0].p.t || g[0].p.h || "").slice(0, 48)}…</summary>
                    {g.map(renderItem)}
                  </details>
                ) : (
                  renderItem(g)
                ),
              )}
              {pages.length > 1 && (
                <div className="pager">
                  <button className="btn alt sm" id="pager-prev" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="上一页">
                    ‹
                  </button>
                  <span>
                    {page + 1} / {pages.length}
                  </span>
                  <button className="btn alt sm" id="pager-next" disabled={page >= pages.length - 1} onClick={() => setPage(page + 1)} aria-label="下一页">
                    ›
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        <Popover />
        <AnnBar />
      </div>

      <CtxDock />
      <Shelf doc={doc} />
      <PdfPicker />
      <AIConfirm />
      <PdfBusy />

      <input
        ref={file}
        type="file"
        accept=".epub,.pdf,.txt,.md,.markdown"
        hidden
        onChange={(e) => {
          importFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />

    </>
  )
}
