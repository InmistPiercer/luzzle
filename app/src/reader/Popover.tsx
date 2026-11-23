import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useApp } from '../app/store'
import { DEMO_ENTRIES } from '../content/demo'
import type { AppState } from '../core/types'
import { lexOf, phraseHead, posGuess } from '../lang/lemmatize'
import { phOf } from '../lang/lexdict'
import { EN_GLOSS } from '../lang/lexicon'
import { dictDefs, senseLine, sensesOfWord } from '../lang/senses'
import { dictSenseOf, childrenOf, isPhraseId, lemmaOf, pieceGlossFor } from '../learn/pieces'
import { isLinkedPhrase, seePhrase } from '../learn/phrase'
import { Piece, STAGE_NAMES } from '../pieces/Piece'
import { morphSplit } from '../morph/actions'
import { allDocs } from '../content/docs'
import { deletePieceWithUndo } from '../app/pieceActions'
import { setPieceGoal } from '../app/review'
import { today } from '../core/date'
import type { EntryAI, Goal } from '../core/types'
import { isMetaAI, occurrenceAI, senseList, type MeetAI } from './aiContext'
import { catalogPhraseOf, meetNew, meetSame, newSenseOptions, needsRecall, pickCurrent, recallGateId, recallInReading, resolveHead, selCtxKey, selMeetKey, setWordPos, skipRecall, triggerAI, useReader, type HeadPrompt, type Sel } from './session'

export const GOALS: [Goal, string][] = [
  ['stash', '暂存'],
  ['read', '读懂'],
  ['use', '会用'],
]
const POS_PILLS: [string, string, string][] = [
  ['v.', 'var(--s2)', '动'],
  ['n.', 'var(--s5)', '名'],
  ['adj.', 'var(--s1)', '形'],
  ['adv.', 'var(--s3)', '副'],
  ['func.', 'var(--mut)', '虚'],
]

export function lexInfo(d: AppState, sel: Sel) {
  const lx = lexOf(sel.lm)
  const ov = (d.extra.posOv as Record<string, string> | undefined)?.[sel.lm]
  const { e: de, lines: dl } = dictSenseOf(sel.lm)
  const lines = dl.length ? dl : lx ? [lx[3]] : []
  const aiPos = (useReader.getState().ai[selCtxKey(d, sel)] as { pos?: string } | undefined)?.pos
  const pos = ov || (aiPos && /^(v|n|adj|adv)\.$/.test(aiPos) ? aiPos : sel.part?.adj ? 'adj.' : sel.part ? 'v.' : posGuess(sel.lm))
  return { lemma: sel.lm, ph: phOf(de) || lx?.[2] || '', pos, g: lines[0] || '', lines }
}

export function Gloss({ lines, on, ai, choose }: { lines: string[]; on?: number; ai?: boolean; choose?: (gloss: string) => void }) {
  if (!lines.length) return null
  return (
    <ol className={`pw-gloss${lines.length > 1 ? ' num' : ''}`}>
      {lines.map((l, i) => {
        const m = l.match(/^((?:[a-z]+\.\s*(?:[&/,]\s*)?)+)\s*(.*)$/i)
        const gloss = m ? m[2] : l
        return (
          <li key={i} className={on === i + 1 ? 'on' : undefined}>
            {m && <i>{m[1].trim()}</i>}
            {choose ? <button className="link" onClick={() => choose(gloss)}>{gloss}</button> : gloss}
            {ai && i === 0 && <em className="ai-tag">AI</em>}
          </li>
        )
      })}
    </ol>
  )
}

function PhraseOffer({ data, sel }: { data: AppState; sel: Sel }) {
  const e = sel.freePh ? data.pieces[sel.freePh] || DEMO_ENTRIES[sel.freePh] || catalogPhraseOf(sel.freePh) : null
  if (!e) return null
  const parent = e.parentLemma || phraseHead(e.members || [e.lemma])
  return (
    <div className="phrase-offer">
      <div className="ph-meta">
        <b>{e.lemma}</b>
        <span>{pieceGlossFor(e, data.prefs.defLang || 'en')} · <u>{parent}</u></span>
      </div>
      <button className="btn mint sm" onClick={() => pickCurrent(true)}>
        <svg className="ico"><use href="#i-puzzle" /></svg>
        摘取短语
      </button>
    </div>
  )
}

function Pills({ pos, k, piece }: { pos: string; k: string; piece: boolean }) {
  return (
    <div className="pos-picker" role="group">
      {POS_PILLS.map(([p, c, lb]) => (
        <button key={p} className={`pos-dot${pos === p ? ' on' : ''}`} style={{ '--c': c } as CSSProperties} onClick={() => setWordPos(k, p, piece)}>
          <i />
          {lb}
        </button>
      ))}
    </div>
  )
}

function placePopover(el: Element, po: HTMLElement) {
  const r = document.getElementById('rd')
  if (!r) return
  const h = po.offsetHeight || 210
  let a = el.getBoundingClientRect()
  let b = r.getBoundingClientRect()
  const need = a.bottom - b.top + 12 + h + 16 - r.clientHeight
  if (need > 0) {
    r.scrollTo({ top: r.scrollTop + need, behavior: 'instant' as ScrollBehavior })
    a = el.getBoundingClientRect()
    b = r.getBoundingClientRect()
  }
  const below = a.bottom - b.top + 12 + h <= r.clientHeight
  let l = a.left - b.left + r.scrollLeft - 12
  l = Math.max(14, Math.min(l, r.clientWidth - po.offsetWidth - 14))
  po.style.left = `${l}px`
  po.style.setProperty('--tx', `${Math.max(18, a.left - b.left + r.scrollLeft + a.width / 2 - l - 7)}px`)
  po.classList.toggle('above', !below)
  po.style.top = `${below ? a.bottom - b.top + r.scrollTop + 12 : a.top - b.top + r.scrollTop - h - 12}px`
}

function SplitLink({ sel }: { sel: Sel }) {
  return (
    <button
      className="link pw-split"
      onClick={() => {
        useReader.getState().set({ po: false })
        const doc = allDocs(useApp.getState().data).find((x) => x.id === sel.docId)
        morphSplit(sel.w, { docId: sel.docId, doc: doc?.title || '', pid: sel.pid, wi: sel.wi, s: sel.s })
      }}
    >
      拆词
    </button>
  )
}

export function GoalSeg({ id, goal }: { id: string; goal: Goal }) {
  return (
    <div className="seg goal-seg" role="group">
      {GOALS.map(([g, lb]) => (
        <button key={g} className={goal === g ? 'on' : ''} onClick={() => setPieceGoal(id, g)}>
          {lb}
        </button>
      ))}
    </div>
  )
}

function RecallGate({ id, word, ph }: { id: string; word: string; ph: string }) {
  return (
    <>
      <div className="pw-row">
        <div className="pw">
          {word}
          <span>{ph}</span>
        </div>
      </div>
      <div className="pr recall-gate">
        <button className="btn mint sm" onClick={() => recallInReading(id, 2)}>
          认识
        </button>
        <button className="btn amber sm" onClick={() => recallInReading(id, 1)}>
          模糊
        </button>
        <button className="btn rose sm" onClick={() => recallInReading(id, 0)}>
          忘记
        </button>
        <button className="link" style={{ marginLeft: 'auto' }} onClick={() => skipRecall(id)}>
          直接看
        </button>
      </div>
    </>
  )
}

export function Popover() {
  const d = useApp((x) => x.data)
  const go = useApp((x) => x.go)
  useApp((x) => x.dictSeq)
  const { sel, po, ai } = useReader()
  useReader((x) => x.recalled)
  const askNew = useReader((x) => x.askNew)
  const askHead = useReader((x) => x.askHead)
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!po || !sel || !ref.current) return
    const el = document.querySelector(`#col p[data-id="${CSS.escape(sel.pid)}"] .w[data-wi="${sel.wi}"]`)
    if (el) placePopover(el, ref.current)
  })

  const selKey = sel ? `${sel.pid}|${sel.wi}` : ''
  useEffect(() => {
    if (useReader.getState().askNew || useReader.getState().askHead) useReader.getState().set({ askNew: false, askHead: null })
  }, [selKey])

  const seenKey =
    po && sel
      ? sel.mode === 'here' && sel.k && isLinkedPhrase(d.pieces, sel.k)
        ? sel.k
        : sel.mode === 'meet' && sel.cands.length === 1 && isLinkedPhrase(d.pieces, sel.cands[0])
          ? sel.cands[0]
          : null
      : null
  useEffect(() => {
    if (seenKey) useApp.getState().setLearn((l) => seePhrase(l, seenKey, today()))
  }, [seenKey])

  let body = null
  const day = today()
  const defLang = d.prefs.defLang || 'en'
  if (sel && po) {
    const gateId = recallGateId(d, sel)
    if (askHead) {
      body = <HeadPick h={askHead} defLang={defLang} />
    } else if (gateId && d.learn[gateId] && needsRecall(d, sel, gateId, day)) {
      const e = d.pieces[gateId]
      body = <RecallGate id={gateId} word={e?.lemma || sel.w} ph={e?.ph || ''} />
    } else if (sel.mode === 'here' && sel.k && d.learn[sel.k]) {
      const k = sel.k
      const e = d.pieces[k]
      const r = d.learn[k]
      const ph = isPhraseId(d, k)
      const chs = childrenOf(d, k)
      const strictEn = defLang === 'en' ? pieceGlossFor(e, 'en') : ''
      const enLine = defLang === 'en' ? e.ai?.en || e.en || EN_GLOSS[e.lemma] || (strictEn && strictEn !== e.lemma ? strictEn : '') : ''
      const hereLines =
        defLang === 'en'
          ? enLine
            ? [enLine]
            : sensesOfWord(e.lemma).map((row) => senseLine(row, 'en'))
          : e.gloss
            ? [e.gloss]
            : e.senses?.length
              ? e.senses
              : e.dict?.length
                ? e.dict
                : e.tile
                  ? [e.tile]
                  : []
      body = (
        <>
          <div className="pw-row">
            <div className="pw">
              {e.lemma}
              <span>{e.ph || ''}</span>
              {!ph && <SplitLink sel={sel} />}
            </div>
            {ph ? (
              <span className="chip" style={{ margin: 0, color: 'var(--s4-d)' }}>
                挂在 {lemmaOf(d, e.parentId || '')} 下
              </span>
            ) : (
              <Pills pos={e.pos || 'v.'} k={k} piece />
            )}
          </div>
          <Gloss lines={hereLines} on={!enLine && !e.gloss && e.senses?.length ? occurrenceAI(d, k, sel.pid, sel.wi)?.sense : undefined} ai={!enLine && !e.gloss && !e.dict?.length && !!e.senses?.length} />
          <PhraseOffer data={d} sel={sel} />
          {chs.length > 0 && (
            <div className="phrase-offer">
              <div className="ph-meta">
                <span>关联短语</span>
                <b>{chs.map((c) => lemmaOf(d, c)).join(' · ')}</b>
              </div>
              <button
                className="btn alt sm"
                onClick={() => {
                  useApp.setState({ boardSel: k })
                  go('board')
                }}
              >
                拼板查看
              </button>
            </div>
          )}
          <div className="picked">
            <b>{STAGE_NAMES[r.stage]}</b>
            <button className="link" style={{ marginLeft: 'auto' }} onClick={() => deletePieceWithUndo(k)}>
              删除
            </button>
          </div>
          <GoalSeg id={k} goal={r.goal} />
          <div className="pr">
            <button className="btn alt sm" onClick={triggerAI}>
              语境解析 <kbd>Enter</kbd>
            </button>
          </div>
        </>
      )
    } else if (sel.mode === 'meet' && sel.cands.length) {
      const info = lexInfo(d, sel)
      const rows = sensesOfWord(info.lemma)
      const enDefs = defLang === 'en' ? dictDefs(info.lemma).map(([p, t]) => (p ? `${p} ${t}` : t)) : []
      const meetLines = rows.length
        ? rows.map((r) => senseLine(r, defLang))
        : defLang === 'en'
          ? EN_GLOSS[info.lemma]
            ? [EN_GLOSS[info.lemma]]
            : enDefs
          : info.lines
      const rawRef = ai[selMeetKey(d, sel)] as MeetAI | null | undefined
      const mRef = rawRef && !isMetaAI(rawRef) ? rawRef : null
      const aiLine = mRef ? (defLang === 'en' ? mRef.en || '' : mRef.zh || mRef.en) : ''
      body = (
        <>
          <div className="pw-row">
            <div className="pw">
              {d.pieces[sel.cands[0]]?.lemma}
              <span>{info.ph}</span>
              <SplitLink sel={sel} />
            </div>
          </div>
          {!askNew && <Gloss lines={aiLine ? [aiLine] : meetLines} ai={!!aiLine} />}
          <PhraseOffer data={d} sel={sel} />
          {askNew && <NewSense sel={sel} />}
          <div className="meet">
            {sel.cands.map((id) => (
              <div key={id} className="meet-row">
                <Piece sides={[0, 1, 0, 0]} k={0.3} st={d.learn[id].stage} lb="" pos={d.pieces[id]?.pos} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{pieceGlossFor(d.pieces[id], defLang)}</b>
                  <span className="small mut"> {STAGE_NAMES[d.learn[id].stage]}</span>
                </div>
                <button className="btn mint sm" onClick={() => meetSame(id)}>
                  同一含义
                </button>
              </div>
            ))}
          </div>
          <div className="pr" style={{ marginTop: 8 }}>
            <button className="btn alt sm" onClick={() => (askNew ? useReader.getState().set({ askNew: false }) : meetNew())}>
              {askNew ? '收起' : '新义'}
            </button>
            <button className="btn alt sm" onClick={triggerAI}>
              语境解析 <kbd>Enter</kbd>
            </button>
          </div>
        </>
      )
    } else if (sel.mode === 'new') {
      const info = lexInfo(d, sel)
      const rawAi = useReader.getState().ai[selCtxKey(d, sel)] as EntryAI | undefined
      const aiSenses = rawAi && !isMetaAI(rawAi) && defLang !== 'en' ? senseList(rawAi) : []
      const enDefs = defLang === 'en' ? dictDefs(info.lemma).map(([p, t]) => (p ? `${p} ${t}` : t)) : []
      const enNew = defLang === 'en' ? EN_GLOSS[info.lemma] || DEMO_ENTRIES[info.lemma]?.ai?.en || DEMO_ENTRIES[info.lemma]?.en : ''
      const rows = sensesOfWord(info.lemma)
      const lines = rows.length ? rows.map((r) => senseLine(r, defLang)) : enNew ? [enNew] : defLang === 'en' ? enDefs : info.lines.length ? info.lines : aiSenses
      const alt = sel.part ? (sel.part.adj ? { lemma: sel.part.base, label: `按原动词 ${sel.part.base} 摘取` } : { lemma: sel.w.toLowerCase(), label: `按形容词 ${sel.w.toLowerCase()} 摘取` }) : null
      body = (
        <>
          <div className="pw-row">
            <div className="pw">
              {info.lemma}
              <span>{info.ph}</span>
              <SplitLink sel={sel} />
            </div>
            <Pills pos={info.pos} k={sel.lm} piece={false} />
          </div>
          <Gloss
            lines={sel.gloss ? [sel.gloss] : lines}
            ai={!rows.length && !info.lines.length && !sel.gloss}
            choose={sel.gloss ? undefined : (g) => useReader.getState().set({ sel: { ...sel, gloss: g } })}
          />
          {sel.gloss && (
            <div className="pr" style={{ marginTop: 4, gap: 10 }}>
              <button className="link" onClick={() => useReader.getState().set({ sel: { ...sel, gloss: undefined } })}>
                重选
              </button>
              <GlossInput value={sel.gloss} onSave={(g) => useReader.getState().set({ sel: { ...sel, gloss: g } })} />
            </div>
          )}
          <PhraseOffer data={d} sel={sel} />
          <div className="pr">
            <button className={`btn ${sel.freePh ? 'alt' : 'mint'}`} onClick={() => pickCurrent()}>
              <svg className="ico">
                <use href="#i-puzzle" />
              </svg>
              {sel.freePh ? `仅摘 ${info.lemma}` : '摘取'} <kbd>L</kbd>
            </button>
            {alt && (
              <button className="btn alt sm" onClick={() => pickCurrent(false, alt.lemma)}>
                {alt.label}
              </button>
            )}
            <button className="btn alt" onClick={triggerAI}>
              语境解析 <kbd>Enter</kbd>
            </button>
          </div>
        </>
      )
    }
  }

  return (
    <div ref={ref} className={`po${body ? ' open' : ''}`} id="po" role="dialog" aria-label="词义简释">
      {body}
    </div>
  )
}

function GlossInput({ value = '', onSave, auto = false, focus = true }: { value?: string; onSave: (g: string) => void; auto?: boolean; focus?: boolean }) {
  const [open, setOpen] = useState(auto)
  const [v, setV] = useState(value)
  if (!open)
    return (
      <button className="link" onClick={() => setOpen(true)}>
        自定义
      </button>
    )
  const save = () => {
    const g = v.trim()
    if (g) onSave(g)
    setOpen(auto)
  }
  return (
    <span className="gloss-in">
      <input autoFocus={focus} value={v} placeholder="本句中的释义" onChange={(e) => setV(e.target.value)} onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') save()
        if (e.key === 'Escape') setOpen(auto)
      }} />
      <button className="btn sm" onClick={save}>
        确定
      </button>
    </span>
  )
}

function NewSense({ sel }: { sel: Sel }) {
  const { options, suggest } = newSenseOptions(sel)
  return (
    <div className="new-sense">
      {options.map((o) => (
        <button key={o} className="mo" onClick={() => meetNew(o)}>
          {o}
        </button>
      ))}
      <GlossInput value={suggest} onSave={(g) => meetNew(g)} auto focus={!options.length} />
    </div>
  )
}

function HeadPick({ h, defLang }: { h: HeadPrompt; defLang: 'zh' | 'en' }) {
  const d = useApp((x) => x.data)
  return (
    <>
      <div className="pw-row">
        <div className="pw">
          {h.entry.lemma}
          <span>{h.head}</span>
        </div>
      </div>
      <div className="new-sense">
        {h.candidates.map((cid) => (
          <button key={cid} className="mo" onClick={() => resolveHead(cid)}>
            {pieceGlossFor(d.pieces[cid], defLang) || lemmaOf(d, cid)}
          </button>
        ))}
        <GlossInput value={h.suggest} onSave={(g) => resolveHead(undefined, g)} auto />
      </div>
    </>
  )
}
