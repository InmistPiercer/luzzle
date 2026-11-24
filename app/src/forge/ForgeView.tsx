import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { aiErr, askJSON } from '../ai/ask'
import { recordReview } from '../app/review'
import { EMPTY_SET, useApp } from '../app/store'
import { diffDays, today } from '../core/date'
import { useDataSeq } from '../core/shards'
import { ensureEx } from '../lang/examples'
import { ensureSenses } from '../lang/senses'
import { highlightParts } from '../core/text'
import type { CardKind, Grade } from '../core/types'
import { cardOf, confirmUse, dueCard, EASIER, forgeQueue, hasSharedSpell, pendingUseOf, taskFor, type Task } from '../learn/engine'
import { isPhraseId, lemmaOf, mosaicSlotsOf, parentOf, pieceGloss, pieceGlossFor, shortEnGloss } from '../learn/pieces'
import { whenOf } from '../pieces/Meters'
import { calcWu, Label, Piece, STAGE_NAMES, useFlip } from '../pieces/Piece'
import { startFloat } from '../app/drag'
import { useEtymLine } from '../morph/etym'
import { Ans, Choices, Reveal } from './quiz'
import { confOf, freshSentence, hasMeaning, isPoly, localJudge, maskParts, matchesForm, matchesWord, meaningChoices, meaningOf, norm, senseSentence, sensesOfPiece, shuffle, srcSentence, scenePage, stableRows, todayDone, wordDefOf, type Sentence } from './logic'
import { DarkroomLine, Scene, type Cell, type Outcome } from './Scene'
import { styleOf } from '../theme/styles'
import { jumpToOrigin, originsOf } from '../reader/session'
import { POLICY_CONFIG } from '../learn/policy'
import { stabilityOf } from '../learn/scheduler'
import { db } from '../storage/db'
import { accOf, applyPhrase, isLinkedPhrase, parentAsks, phN, phraseFor } from '../learn/phrase'
import { PhraseCard, PhraseDots } from './PhraseCard'

type Feedback = { kind: 'hint'; node: ReactNode; retry: boolean } | null

const BLIND_TASKS: Task[] = ['spell', 'fill', 'choose']


type Sent = Sentence & { k?: number }

function Masked({ s, form, blank, id, lemma }: { s: string; form: string; blank?: string | null; id?: string; lemma?: string }) {
  const [a, b] = maskParts(s, form)
  return (
    <>
      “{a}
      <span className={`blank${id && blank ? ' filled' : ''}`} id={id}>
        {id && blank ? blank : '？'}
      </span>
      {lemma && <span className="blank-lemma">({lemma})</span>}
      {b}”
    </>
  )
}

function Marked({ s, form }: { s: string; form: string }) {
  const hp = highlightParts(s, form)
  return (
    <>
      “
      {hp ? (
        <>
          {hp[0]}
          <mark>{hp[1]}</mark>
          {hp[2]}
        </>
      ) : (
        s
      )}
      ”
    </>
  )
}

export function ForgeView() {
  const epoch = useApp((x) => x.dataEpoch)
  const day = useApp(() => today())
  return <ForgeSession key={`${epoch}|${day}`} />
}

function ForgeSession() {
  const d = useApp((x) => x.data)
  const rawAgain = useApp((x) => x.again)
  const againDay = useApp((x) => x.againDay)
  const forgeAll = useApp((x) => x.forgeAll)
  const view = useApp((x) => x.view)
  const [qmode, setQmode] = useState<'due' | 'all'>('due')
  const [aheadDone, setAheadDone] = useState<string[]>([])
  const [allRound, setAllRound] = useState(0)
  const day = today()
  const again = againDay === day ? rawAgain : EMPTY_SET
  const due = forgeQueue(d.learn, day, d.caps.newDaily, again, d.pieces).length
  const ids = Object.keys(d.learn).filter((id) => !isLinkedPhrase(d.pieces, id))
  const gold = ids.filter((x) => d.learn[x].stage === 5).length
  const total = ids.filter((x) => d.learn[x].goal !== 'stash').length
  const setQ = (m: 'due' | 'all') => {
    setQmode(m)
    setAheadDone([])
    setAllRound((r) => r + 1)
    useApp.setState({ forgeWord: null, forgeAll: m === 'all' })
  }
  useEffect(() => {
    if (view !== 'forge') return
    if (forgeAll) {
      if (qmode !== 'all') setAllRound((r) => r + 1)
      setQmode('all')
      const fw = useApp.getState().forgeWord
      if (fw) setAheadDone((xs) => (xs.includes(fw) ? xs.filter((x) => x !== fw) : xs))
    } else if (due > 0 && qmode === 'all') {
      setQmode('due')
      setAheadDone([])
    }
  }, [view, forgeAll])
  return (
    <>
      <Header qmode={qmode} setQmode={setQ} due={due} total={total} gold={gold} sub={styleOf(d.prefs.style).forge} />
      <WordForge qmode={qmode} setQmode={setQmode} setQ={setQ} aheadDone={aheadDone} setAheadDone={setAheadDone} allRound={allRound} />
    </>
  )
}

function WordForge({
  qmode,
  setQmode,
  setQ,
  aheadDone,
  setAheadDone,
  allRound,
}: {
  qmode: 'due' | 'all'
  setQmode: (m: 'due' | 'all') => void
  setQ: (m: 'due' | 'all') => void
  aheadDone: string[]
  setAheadDone: (v: string[] | ((xs: string[]) => string[])) => void
  allRound: number
}) {
  const d = useApp((x) => x.data)
  const k = useApp((x) => x.forgeWord)
  const rawAgain = useApp((x) => x.again)
  const rawAgainStep = useApp((x) => x.againStep)
  const againDay = useApp((x) => x.againDay)
  const style = useApp((x) => x.data.prefs.style)
  const view = useApp((x) => x.view)
  const hasKey = useApp((x) => !!x.ai.apiKey)
  const defLang = d.prefs.defLang || 'en'
  const flipAll = useFlip((x) => x.all)
  const flippedMap = useFlip((x) => x.flipped)
  useDataSeq((x) => x.seq)
  const { pulse, update } = useApp.getState()
  const [over, setOver] = useState<Task | null>(null)
  const [down, setDown] = useState<Task | null>(null)
  const [graded, setGraded] = useState(false)
  const [fb, setFb] = useState<Feedback>(null)
  const [res, setRes] = useState<{ o: Outcome; from: number }>({ o: null, from: 0 })
  const [wrongMo, setWrongMo] = useState<string[]>([])
  const [rightMo, setRightMo] = useState<string | null>(null)
  const [blank, setBlank] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [ph, setPh] = useState('拼写')
  const [revealed, setRevealed] = useState(false)
  const flags = useRef({ hint: false })
  const [seq, setSeq] = useState(0)
  const [item, setItem] = useState<{ key: string; kind: CardKind; base: { task: Task; hint: boolean }; dueNow: boolean; pend: { s: string } | null; sents: Partial<Record<Task, Sent>> } | null>(null)
  const [phq, setPhq] = useState<{ id: string; counted: boolean } | null>(null)
  const [phOut, setPhOut] = useState<Outcome>(null)
  const root = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const request = useRef<AbortController | null>(null)
  const [aiBusy, setAIBusy] = useState<'judge' | 'example' | null>(null)
  const day = today()
  const again = againDay === day ? rawAgain : EMPTY_SET
  const againStep = againDay === day ? rawAgainStep : {}
  const ety = useEtymLine(k && d.pieces[k] && !isPhraseId(d, k) ? d.pieces[k].lemma : null)

  const aheadSet = new Set(aheadDone)
  const aheadRef = useRef<Set<string>>(aheadSet)
  aheadRef.current = aheadSet
  const qmodeRef = useRef(qmode)
  qmodeRef.current = qmode
  const markAhead = (id: string) => {
    if (aheadRef.current.has(id)) return
    const next = new Set(aheadRef.current)
    next.add(id)
    aheadRef.current = next
    setAheadDone([...next])
  }

  const due = forgeQueue(d.learn, day, d.caps.newDaily, again, d.pieces)
  const all = Object.keys(d.learn).filter((id) => d.learn[id].goal !== 'stash' && !isLinkedPhrase(d.pieces, id))
  const rawSortedAll = [...all].sort((a, b) => (d.learn[a].sched.due > d.learn[b].sched.due ? 1 : d.learn[a].sched.due < d.learn[b].sched.due ? -1 : 0))
  const [allOrder, setAllOrder] = useState<{ round: number; ids: string[] }>({ round: -1, ids: [] })
  const prevAll = allOrder.round === allRound && allOrder.ids.length ? allOrder.ids.filter((id) => all.includes(id)) : []
  const sortedAll = prevAll.length ? [...prevAll, ...rawSortedAll.filter((id) => !prevAll.includes(id))] : rawSortedAll
  if (qmode === 'all' && (allOrder.round !== allRound || sortedAll.join() !== allOrder.ids.join())) setAllOrder({ round: allRound, ids: sortedAll })
  const allIdsRef = useRef<string[]>(sortedAll)
  allIdsRef.current = sortedAll
  const list = qmode === 'due' ? due : sortedAll
  const open = qmode === 'due' ? due : sortedAll.filter((id) => !aheadSet.has(id))
  const [logged, setLogged] = useState<string[]>([])
  useEffect(() => {
    void db.reviews
      .where('day')
      .equals(day)
      .sortBy('at')
      .then((rs) => setLogged([...new Set(rs.map((x) => x.piece))]))
      .catch(() => undefined)
  }, [day])
  const done = qmode === 'due' ? todayDone(d.learn, day, due, again, d.pieces) : sortedAll.filter((id) => aheadSet.has(id))
  const [order, setOrder] = useState<{ day: string; ids: string[] }>({ day: '', ids: [] })
  const prevIds = order.day === day && order.ids.length ? order.ids : logged.filter((x) => done.includes(x))
  const rows = qmode === 'due' ? stableRows(prevIds, done, due) : list
  if (qmode === 'due' && (order.day !== day || rows.join() !== order.ids.join())) setOrder({ day, ids: rows })

  const resetItem = () => {
    request.current?.abort()
    request.current = null
    setAIBusy(null)
    setOver(null)
    setDown(null)
    setGraded(false)
    setFb(null)
    setRes({ o: null, from: 0 })
    setWrongMo([])
    setRightMo(null)
    setBlank(null)
    setInput('')
    setPh('拼写')
    setRevealed(false)
    setPhq(null)
    setPhOut(null)
    flags.current = { hint: false }
    useFlip.getState().reset()
    setSeq((x) => x + 1)
  }

  const select = (id: string | null) => {
    clearTimeout(timer.current)
    useApp.setState({ forgeWord: id })
    resetItem()
  }

  const idle = !graded && !revealed && !down && !phq
  useEffect(() => {
    if (!k || !d.learn[k] || d.learn[k].goal === 'stash' || (idle && (qmode === 'due' ? !due.includes(k) : aheadSet.has(k)))) {
      select(open[0] || null)
    }
  }, [k, qmode, day, idle, open.join(',')])

  useEffect(() => {
    if (k && d.learn[k] && !due.includes(k) && qmode === 'due' && !dueCard(d.learn[k], day) && !again.has(k) && idle) {
      setQmode('all')
    }
  }, [k])

  useEffect(() => () => {
    clearTimeout(timer.current)
    request.current?.abort()
  }, [])
  useEffect(() => {
    if (view !== 'forge') request.current?.abort()
  }, [view])
  useEffect(() => {
    if (k && d.pieces[k]) {
      void ensureEx(d.pieces[k].lemma)
      void ensureSenses(d.pieces[k].lemma)
    }
  }, [k])

  const keyAct = useRef<(ev: KeyboardEvent) => void>(() => undefined)
  keyAct.current = () => undefined
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => keyAct.current(ev)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const r = k ? d.learn[k] : undefined
  const e = k ? d.pieces[k] : undefined
  const curDue = r ? dueCard(r, day) : null
  const replayKind: CardKind | null = k && again.has(k) ? (r?.form?.last === day ? 'form' : 'meaning') : null
  const effKind: CardKind = curDue || replayKind || 'meaning'
  const step = (k && againStep[k]) || 0
  const reps = r ? r.sched.reps + (r.form?.reps || 0) : 0
  const sentSeed = (t: Task) => `${k}|${day}|${t}|${reps}|${step}|${allRound}`
  const key = `${k}|${day}|${qmode}|${defLang}|${seq}`
  let it = item
  if (r && k && (it?.key !== key || (!graded && (Boolean(curDue) !== it.dueNow || it.kind !== effKind)))) {
    let b = taskFor(r, effKind, hasMeaning(d, k), isPoly(e, defLang))
    if (b.task === 'spell' && hasSharedSpell(d, k)) b = { task: 'fill', hint: false }
    if (b.task === 'sense' && !senseSentence(d, k, sentSeed('sense'))) b = { ...b, task: 'recallNew' }
    it = { key, kind: effKind, base: b, dueNow: !!curDue, pend: pendingUseOf(r, day), sents: {} }
    setItem(it)
  }
  const pending = it?.pend && it.pend === r?.pendingUse ? it.pend : null
  const kind: CardKind = it?.kind || 'meaning'
  const base = it?.base || { task: 'pick' as Task, hint: false }
  const dueNow = !!it?.dueNow
  const isDown = !!down
  const isAgainDrill = !dueNow && !!k && again.has(k)
  const autoTask: Task = (() => {
    if (!isAgainDrill || step < 2) return base.task
    const t1 = EASIER[base.task] || base.task
    const t2 = step >= 3 ? EASIER[t1] || t1 : t1
    return t2 === 'pick' && k && !hasMeaning(d, k) ? 'recall' : t2
  })()
  const routed = down || over || autoTask
  const task: Task = routed
  const isAhead = !dueNow && (!k || !again.has(k))
  const practice = isDown || !dueNow
  const needFresh = task === 'recallNew' || task === 'fill'
  let sent: Sent = it?.sents[task] || { s: '', fresh: false }
  if (it && k && (!it.sents[task] || (!graded && !revealed && !input && !sent.fresh))) {
    const original: Sent = { s: srcSentence(d, k), fresh: false }
    const next = task === 'sense'
      ? senseSentence(d, k, sentSeed(task)) || original
      : needFresh ? freshSentence(d, k, sentSeed(task), practice && task === 'fill') : original
    if (!it.sents[task] || next.s !== sent.s) {
      sent = next
      setItem({ ...it, sents: { ...it.sents, [task]: next } })
    }
  }

  const startRequest = (kind: 'judge' | 'example') => {
    if (request.current) return null
    const controller = new AbortController()
    request.current = controller
    setAIBusy(kind)
    return controller
  }

  const finishRequest = (controller: AbortController) => {
    if (request.current !== controller) return
    request.current = null
    setAIBusy(null)
  }

  const requestIsCurrent = (controller: AbortController) => {
    const state = useApp.getState()
    return !controller.signal.aborted && request.current === controller && state.forgeWord === k && state.view === 'forge' && today() === day
  }

  const generateExample = async () => {
    if (!k || !e) return
    const controller = startRequest('example')
    if (!controller) return
    const meaning = meaningOf(e)
    const target = e.form || e.lemma
    try {
      const { s, a } = await askJSON<{ s: string; a: string[] }>(
        `Write one new, natural English sentence (12-25 words) that uses "${target}" in the sense "${meaning}". Reply ONLY JSON {"s":"the sentence with the target word replaced by ___","a":["accepted answers in lowercase"]}`,
        { jsonMode: true, maxTokens: 160, estOut: 80, signal: controller.signal },
      )
      if (!requestIsCurrent(controller)) return
      const valid = typeof s === 'string' && s.split('___').length === 2 && Array.isArray(a) && a.length > 0 && a.every((answer) => typeof answer === 'string' && answer.trim())
      if (!valid || norm(s.replace('___', target)) === norm(srcSentence(d, k))) {
        useApp.getState().say('未能生成新例句，请重试')
        return
      }
      update((state) => {
        const piece = state.pieces[k]
        if (!piece) return state
        return { ...state, pieces: { ...state.pieces, [k]: { ...piece, alt: [...(piece.alt || []), { s, a }] } } }
      })
    } catch (error) {
      if (requestIsCurrent(controller)) useApp.getState().say(aiErr(error, '未能生成新例句，请重试'))
    } finally {
      finishRequest(controller)
    }
  }

  const okDelay = style === 'neon' ? 1140 : 920
  const upDelay = style === 'neon' ? 1360 : 1320

  const later = (ms: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const s = useApp.getState()
      if (today() !== day) return
      const cur = s.forgeWord
      if (qmodeRef.current === 'all') {
        const curSet = new Set(Object.keys(s.data.learn).filter((id) => s.data.learn[id].goal !== 'stash' && !isLinkedPhrase(s.data.pieces, id)))
        const curAll = allIdsRef.current.filter((id) => curSet.has(id))
        for (const id of curSet) if (!curAll.includes(id)) curAll.push(id)
        const doneSet = aheadRef.current
        const idx = cur ? curAll.indexOf(cur) : -1
        const rotated = idx >= 0 ? [...curAll.slice(idx + 1), ...curAll.slice(0, idx + 1)] : curAll
        const next = rotated.find((x) => x !== cur && !doneSet.has(x)) || rotated.find((x) => !doneSet.has(x)) || null
        select(next)
        return
      }
      const curDay = today()
      const q = forgeQueue(s.data.learn, curDay, s.data.caps.newDaily, s.againDay === curDay ? s.again : EMPTY_SET, s.data.pieces)
      const idx = cur ? q.indexOf(cur) : -1
      const rotated = idx >= 0 ? [...q.slice(idx + 1), ...q.slice(0, idx + 1)] : q
      select(rotated.find((x) => x !== cur) || rotated[0] || null)
    }, ms)
  }

  const setAgain = useApp.getState().markAgain
  const hint = (node: ReactNode, retry = true) => setFb({ kind: 'hint', node, retry })
  const shake = (sel: string) => {
    const el = root.current?.querySelector(sel)
    el?.classList.add('shake')
    setTimeout(() => el?.classList.remove('shake'), 400)
  }
  const strike = () => pulse()
  const follow = (counted: boolean) => {
    const st = useApp.getState().data
    if (!k || !parentAsks(st.learn[k])) return false
    const id = phraseFor(st, k, day)
    if (!id) return false
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { if (today() === day) setPhq({ id, counted }) }, style === 'neon' ? 1060 : 700)
    return true
  }
  const answerPhrase = (id: string, counted: boolean, ok: boolean) => {
    setPhOut(ok ? 'ok' : 'bad')
    if (counted) useApp.getState().setLearn((l) => applyPhrase(l, id, ok, day))
    if (ok && qmodeRef.current === 'all' && k && isLinkedPhrase(d.pieces, k)) markAhead(k)
    if (ok) later(900)
  }


  const sub = styleOf(style).forge
  const heroK = style === 'draft' ? 1.06 : style === 'classic' ? 0.96 : 0.86
  const rowLabel = (id: string) => {
    const pe = d.pieces[id]
    const rr = d.learn[id]
    if (!pe || !rr) return ''
    const settled = done.includes(id) || (id === k && res.o === 'ok')
    const isForm = dueCard(rr, day) === 'form' || (again.has(id) && rr.form?.last === day)
    return !isLinkedPhrase(d.pieces, id) && isForm && !settled ? `${(defLang === 'zh' ? pe.tile || pieceGlossFor(pe, 'zh') : pieceGlossFor(pe, 'en')) || ''} · ?` : pe.lemma
  }
  const page = scenePage(style)
  const cellsOf = (at: number): Cell[] => {
    const start = Math.max(0, Math.floor(at / page) * page)
    return rows.slice(start, start + page).map((id, i) => ({
      id,
      label: rowLabel(id),
      st: d.learn[id]?.stage || 1,
      pos: d.pieces[id]?.pos || 'v.',
      filled: done.includes(id),
      cur: start + i === at,
    }))
  }
  const withOk = (a: ReturnType<typeof accOf>) => (a && phOut === 'ok' ? { ...a, ok: true } : a)
  const detailOf = (id: string) => {
    const pe = d.pieces[id]
    const at = accOf(d, [pe?.parentId || ''], id)?.hl ?? 0
    return { mark: 'AB'[at] || 'A', lemma: pe?.lemma || '', core: d.pieces[pe?.parentId || '']?.lemma || '', n: phN(d.learn[id]), outcome: phOut }
  }
  const qProps = { rows, done, k, qmode, outcome: k && isLinkedPhrase(d.pieces, k) ? phOut : res.o, again, onPick: select, asking: phq?.id || null }

  if (!k || !r || !e) {
    const golds = all.filter((id) => d.learn[id].stage === 5).length
    const dueDayOf = (id: string) => {
      const rec = d.learn[id]
      const f = rec.goal === 'use' && rec.form ? rec.form.due : null
      return f && f < rec.sched.due ? f : rec.sched.due
    }
    const rest = all.filter((id) => !dueCard(d.learn[id], day))
    const soon = rest.filter((id) => diffDays(dueDayOf(id), day) <= 1).length
    const empty = !all.length
    return (
      <div className={`forge-wrap${rows.length ? '' : ' solo'}`}>
        {!!rows.length && <Queue {...qProps} k={null} />}
        <div className="forge-main f-done" id="f-main">
          {style === 'neon' && done.length > 0 && <DarkroomLine cells={cellsOf(Math.max(0, rows.length - 1))} state="dev" doneWave />}
          <div className="done-card">
            <span className="done-badge">
              <Piece sides={[-1, 1, 1, -1]} wu={100} k={0.84} st={empty ? 0 : 5} lb={<b className="done-check">{empty ? '?' : '✓'}</b>} pos="v." />
            </span>
            <h3>{empty ? '锻造台还空着' : qmode === 'all' ? `全部${sub}完成` : `今日${sub}完成`}</h3>
            {!empty && (
              <>
                <div className="done-stats">
                  <div>
                    <b>{qmode === 'all' ? done.length : 0}</b>
                    <span>{qmode === 'all' ? '本轮完成' : '今日待锻'}</span>
                  </div>
                  <div>
                    <b>{all.length}</b>
                    <span>词库总计</span>
                  </div>
                  <div className="gold">
                    <b>{golds}</b>
                    <span>已达运用</span>
                  </div>
                </div>
                <div className="done-next">
                  明日待复习 <b>{soon}</b> 块 · 后续排程 <b>{rest.length - soon}</b> 块
                </div>
              </>
            )}
            <div className="done-acts">
              {!empty && (
                <button className="btn alt sm" onClick={() => setQ('all')}>
                  {qmode === 'all' ? `再练一轮 (${all.length})` : `提前练习全部 (${all.length})`}
                </button>
              )}
              <button className="btn sm" onClick={() => useApp.getState().go('read')}>
                去阅读
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const handlePhraseKey = (ev: KeyboardEvent) => {
    if ((ev.key === ' ' || ev.key === 'Enter') && phOut === 'bad') {
      ev.preventDefault()
      later(0)
      return
    }
    if (phOut !== null) return
    if (ev.key === 'Backspace') {
      const slots = root.current?.querySelectorAll<HTMLElement>('.forge-card .ph-slot.on')
      const last = slots?.[slots.length - 1]
      if (last) {
        ev.preventDefault()
        last.click()
      }
      return
    }
    if (/^[1-6]$/.test(ev.key)) {
      const blks = root.current?.querySelectorAll<HTMLButtonElement>('.forge-card .ph-blk')
      const blk = blks?.[Number(ev.key) - 1]
      if (blk && !blk.disabled) {
        ev.preventDefault()
        blk.click()
      }
    }
  }

  if (isLinkedPhrase(d.pieces, k)) {
    const pid = e.parentId as string
    const pe = d.pieces[pid]
    const pr = d.learn[pid]
    const flipped = phOut !== null && flipAll !== !!flippedMap[pid]
    const flip = () => {
      if (phOut !== null) useFlip.getState().toggle([pid])
    }
    const no = rows.indexOf(k) + 1
    keyAct.current = (ev: KeyboardEvent) => {
      if (useApp.getState().view !== 'forge' || ev.metaKey || ev.ctrlKey || ev.altKey) return
      if (ev.defaultPrevented || (ev.target as Element).closest('input, textarea, select, [aria-modal="true"]')) return
      if (ev.key.toLowerCase() === 'f' && phOut !== null) {
        ev.preventDefault()
        flip()
        return
      }
      handlePhraseKey(ev)
    }
    return (
      <div className="forge-wrap">
        <Queue {...qProps} />
        <div className="forge-main" id="f-main" ref={root}>
          {pr && (
            <Scene
              style={style}
              no={no || 1}
              part={pe.lemma}
              pos={pe.pos || 'v.'}
              stage={pr.stage}
              from={pr.stage}
              outcome={null}
              cells={cellsOf(no - 1)}
              phrase={detailOf(k)}
              piece={(sides) => (
                <span className="f-piece-stage" onDoubleClick={flip}>
                  <Piece sides={sides || [-1, 1, 1, -1]} k={heroK} st={pr.stage} acc={withOk(accOf(d, [pid], k))} className={flipped ? 'flipped' : ''} lb={<Label word={pe.lemma} sub={flipped ? pieceGlossFor(pe, defLang === 'en' ? 'zh' : 'en') : undefined} fixedGrid back={flipped} />} pos={pe.pos || 'v.'} wu={100} />
                </span>
              )}
            />
          )}
          <div className="forge-card">
            <PhraseCard
              key={key}
              id={k}
              core={pe.lemma}
              onAnswer={(ok) => {
                answerPhrase(k, qmode === 'due', ok)
              }}
              onNext={() => later(0)}
            />
          </div>
        </div>
      </div>
    )
  }

  const pos = e.pos || 'v.'
  const zh = meaningOf(e, defLang)
  const form = sent.form || e.form || e.lemma
  const answer = sent.form || e.ans || form
  const blind = BLIND_TASKS.includes(task) && !revealed && !graded
  const pId = parentOf(d, k)
  const canFlip = graded || revealed
  const heroSlots = mosaicSlotsOf(d, k, defLang, k)
  const multiWord = /\s/.test(e.lemma) && !blind && heroSlots.length < 2
  const heroWu = multiWord ? calcWu(e.lemma) : 100
  const flipped = canFlip && flipAll !== !!flippedMap[k]
  const backSub = defLang === 'en' ? e.tile || pieceGloss(e) : shortEnGloss(e)

  const grade = (g: Grade, fresh = false, failNode?: ReactNode, extra?: { verified?: boolean; sentence?: string }) => {
    if (graded) return
    setGraded(true)
    setRes({ o: g >= 2 ? 'ok' : 'bad', from: r.stage })
    if (isDown) {
      if (g >= 2) {
        return later(okDelay)
      }
      if (g === 1) {
        return later(900)
      }
      if (failNode) hint(failNode, false)
      return
    }
    if (isAgainDrill) {
      if (g >= 2) {
        setAgain(k, false)
        if (qmodeRef.current === 'all') markAhead(k)
        pulse()
        return later(okDelay)
      }
      if (g === 1) {
        setAgain(k, false)
        if (qmodeRef.current === 'all') markAhead(k)
        useApp.getState().say('已排入近期复习')
        return later(700)
      }
      setAgain(k, true)
      if (failNode) hint(failNode, false)
      return
    }
    if (isAhead) {
      if (g >= 2) {
        setAgain(k, false)
        markAhead(k)
        strike()
        if (follow(false)) return
        return later(okDelay)
      }
      if (g === 1) return later(900)
      if (failNode) hint(failNode, false)
      return
    }
    const before = r.stage
    if (!recordReview(k, { kind, task, grade: g, fresh, day, ...extra }, 'forge')) return later(0)
    const after = useApp.getState().data.learn[k]
    setAgain(k, g < 2)
    if (g >= 2 && qmodeRef.current === 'all') markAhead(k)
    if (g >= 2) {
      strike()
      if (follow(true)) return
      return later(after.stage > before ? upDelay : okDelay)
    }
    if (g === 1) {
      return later(900)
    }
    if (failNode) hint(failNode, false)
  }

  const practiceEasier = () => {
    const next = EASIER[task] || task
    resetItem()
    setDown(next)
  }

  const answerPick = (o: string, ans: string, owner: Record<string, string>) => {
    if (graded) return
    if (o !== ans) {
      setWrongMo((w) => (w.includes(o) ? w : [...w, o]))
      const w = owner[o]
      const node = <Ans label={w ? o : '答案'} v={w || ans} />
      return grade(0, false, node)
    }
    setRightMo(o)
    setRevealed(true)
    grade(2)
  }

  const conf = confOf(d, k)
  const answerChoose = (o: string) => {
    if (graded) return
    if (o !== conf.opts[0]) {
      shake('#f-blank')
      return grade(
        0,
        false,
        <Ans v={conf.opts[0]} />,
      )
    }
    setBlank(o)
    setRevealed(true)
    grade(2)
  }

  const answers = [answer.toLowerCase(), ...(sent.ans || [])]
  const checkTyped = () => {
    const v = norm(input)
    if (!v || graded) return
    if (!(task === 'fill' ? matchesForm(v, answers) : matchesWord(e, v, answers))) {
      shake('#f-input')
      return grade(
        0,
        false,
        <Ans v={answer} />,
      )
    }
    setRevealed(true)
    grade(flags.current.hint ? 0 : 2, task === 'fill' && sent.fresh, flags.current.hint ? <Ans v={answer} /> : undefined)
  }

  const evalSentence = async () => {
    const v = input.trim()
    const err = localJudge(d, k, v)
    if (err) return hint(err)
    if (!useApp.getState().ai.apiKey) {
      setRevealed(true)
      return grade(2, false, undefined, { sentence: v })
    }
    const controller = startRequest('judge')
    if (!controller) return
    const judgeMeaning = zh || meaningOf(e, 'zh')
    try {
      const out = await askJSON<{ ok?: boolean; reason?: string }>(
        `Target: "${e.lemma}" meaning "${judgeMeaning}"${e.ai?.en ? ` (${e.ai.en})` : ''}. Learner sentence: "${v}". Is the target used correctly AND in this specific sense? Reply ONLY JSON {"ok":true|false,"reason":"中文,<=20字"}`,
        { signal: controller.signal },
      )
      if (!requestIsCurrent(controller)) return
      if (out.ok === true) grade(2, false, undefined, { verified: true })
      else if (out.ok === false) grade(0, false, out.reason || '义项不符')
      else hint('AI 判定失败，稍后再试')
    } catch (er) {
      if (requestIsCurrent(controller)) hint(aiErr(er, 'AI 判定失败，稍后再试'))
    } finally {
      finishRequest(controller)
    }
  }

  const settleUse = (ok: boolean) => {
    useApp.getState().setLearn((l) => confirmUse(l, k, ok, day))
  }

  let body: ReactNode = null
  if (task === 'pick') {
    const { opts, owner } = meaningChoices(d, k, defLang)
    const shown = shuffle(opts, k + day)
    body = (
      <>
        <div className="card" style={{ font: '17px/1.85 var(--read)' }}>
          <Marked s={sent.s} form={form} />
        </div>
        <Choices opts={shown} onPick={(o) => answerPick(o, opts[0], owner)} wrong={wrongMo} right={rightMo} lock={graded || revealed} />
        {!graded && (
          <div className="pr" style={{ marginTop: 0 }}>
            {!down && kind === 'meaning' && r.sched.state === 0 && (
              <button className="btn alt sm" onClick={() => setOver('recall')}>
                我认识
              </button>
            )}
            <button
              className="btn alt sm"
              onClick={() => {
                setRightMo(opts[0])
                setRevealed(true)
                if (down) return later(1200)
                grade(
                  0,
                  false,
                  <Ans v={opts[0]} />,
                )
              }}
            >
              看答案
            </button>
          </div>
        )}
      </>
    )
  } else if (task === 'recall' || task === 'recallNew') {
    const defText = wordDefOf(e, defLang) || zh || '—'
    body = (
      <>
        <div className="card" style={{ font: '17px/1.85 var(--read)' }}>
          <Marked s={sent.s} form={form} />
        </div>
        {revealed ? (
          <>
            <div className="recall-ans">
              {pos !== 'phrase' && <span className="recall-pos">{pos}</span>}
              <b>{defText}</b>
            </div>
            {!graded && (
              <div className="pr recall-btns" style={{ marginTop: 0 }}>
                <button className="btn mint sm" onClick={() => grade(2, task === 'recallNew' && sent.fresh)}>
                  认识
                </button>
                <button className="btn amber sm" onClick={() => grade(1, task === 'recallNew' && sent.fresh)}>
                  模糊
                </button>
                <button className="btn rose sm" onClick={() => grade(0, false, <Ans label="记下" v={defText} />)}>
                  忘记
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="pr" style={{ marginTop: 0 }}>
            <button className="btn sm" onClick={() => setRevealed(true)}>
              显示意思
            </button>
          </div>
        )}
      </>
    )
  } else if (task === 'sense') {
    const opts = sensesOfPiece(e, defLang)
    const right = opts[(sent.k || 1) - 1]
    body = (
      <>
        <div className="card" style={{ font: '17px/1.85 var(--read)' }}>
          <Marked s={sent.s} form={form} />
        </div>
        <Choices
          opts={opts}
          wrong={wrongMo}
          right={rightMo}
          lock={graded}
          onPick={(o) => {
            if (graded) return
            setRevealed(true)
            if (o === right) {
              setRightMo(o)
              return grade(2, sent.fresh)
            }
            setWrongMo((w) => (w.includes(o) ? w : [...w, o]))
            setRightMo(right)
            grade(0, false, <Ans v={right} />)
          }}
        />
      </>
    )
  } else if (task === 'choose') {
    const opts = shuffle(conf.opts, k)
    body = (
      <>
        <div className="card" style={{ font: '16.5px/2.1 var(--read)' }}>
          <Masked s={sent.s} form={form} blank={blank} id="f-blank" />
        </div>
        <div className="small mut" style={{ fontWeight: 700 }}>
          {pos} {zh}
        </div>
        <div className="opts">
          {opts.map((o) => (
            <button
              key={o}
              className="opt"
              onClick={() => answerChoose(o)}
              onPointerDown={(ev) =>
                startFloat(ev, ev.currentTarget, {
                  targets: '#f-blank',
                  drop: (over) => {
                    if (!over) return false
                    answerChoose(o)
                  },
                })
              }
            >
              <Piece sides={[0, 1, 0, -1]} k={0.62} st={3} lb={<Label word={o} fixedGrid />} pos={pos} wu={100} />
            </button>
          ))}
        </div>
      </>
    )
  } else if (task === 'spell' || task === 'fill') {
    body = (
      <>
        <div className="card" style={{ font: '16.5px/1.85 var(--read)' }}>
          <Masked s={sent.s} form={form} lemma={task === 'fill' ? e.lemma : undefined} />
        </div>
        <div className="small mut" style={{ fontWeight: 700 }}>
          {pos} {zh}
        </div>
        <div className="recall-row">
          <input
            className="forge-input"
            id="f-input"
            placeholder={task === 'fill' ? '填词' : ph}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            disabled={graded}
            value={input}
            onChange={(ev) => setInput(ev.target.value)}
            onKeyDown={(ev) => ev.key === 'Enter' && checkTyped()}
          />
          <button className="btn" disabled={graded} onClick={checkTyped}>
            提交
          </button>
        </div>
        {!graded && (
          <div className="pr" style={{ marginTop: 0 }}>
            {base.hint && task === 'spell' && (
              <button
                className="btn alt sm"
                onClick={() => {
                  flags.current.hint = true
                  setPh(`${answer[0]}${'_'.repeat(Math.max(1, answer.length - 1))}`)
                  root.current?.querySelector<HTMLInputElement>('#f-input')?.focus()
                }}
              >
                首字母
              </button>
            )}
            <button
              className="btn alt sm"
              onClick={() => {
                setRevealed(true)
                grade(
                  0,
                  false,
                  <Ans v={answer} />,
                )
              }}
            >
              看答案
            </button>
          </div>
        )}
      </>
    )
  } else {
    body = (
      <>
        <textarea className="forge-input" id="f-input" rows={2} placeholder={`用 ${e.lemma} 造句`} value={input} onChange={(ev) => setInput(ev.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey) || event.nativeEvent.isComposing || graded) return
            event.preventDefault()
            void evalSentence()
          }}
        />
        <div>
          <button className="btn mint sm" disabled={graded || aiBusy === 'judge'} onClick={() => void evalSentence()}>
            {aiBusy === 'judge' ? '判定中…' : '提交'}
          </button>
        </div>
      </>
    )
  }

  const origin = originsOf(d, k)
  const no = rows.indexOf(k) + 1
  const pct = Math.min(100, (stabilityOf(cardOf(r, kind)) / POLICY_CONFIG.mixAt) * 100)
  const nextEasier = EASIER[task] && (EASIER[task] !== 'pick' || hasMeaning(d, k)) ? EASIER[task] : null

  keyAct.current = (ev: KeyboardEvent) => {
    if (useApp.getState().view !== 'forge' || ev.metaKey || ev.ctrlKey || ev.altKey) return
    if (ev.defaultPrevented || (ev.target as Element).closest('input, textarea, select, [aria-modal="true"]')) return
    const lk = ev.key.toLowerCase()
    if (lk === 'f' && (graded || revealed)) {
      ev.preventDefault()
      useFlip.getState().toggle([k])
      return
    }
    if (phq) {
      handlePhraseKey(ev)
      return
    }
    if (pending) {
      if (ev.key === '1') {
        ev.preventDefault()
        settleUse(true)
      } else if (ev.key === '2') {
        ev.preventDefault()
        settleUse(false)
      }
      return
    }
    if (ev.key === ' ' || ev.key === 'Enter') {
      if (fb?.kind === 'hint' && (graded || !fb.retry)) {
        ev.preventDefault()
        later(0)
        return
      }
      if ((task === 'recall' || task === 'recallNew') && !revealed && !graded) {
        ev.preventDefault()
        setRevealed(true)
        return
      }
    }
    if (!graded && (task === 'recall' || task === 'recallNew') && revealed) {
      const defText = wordDefOf(e, defLang) || zh || '—'
      if (ev.key === '1') {
        ev.preventDefault()
        grade(2, task === 'recallNew' && sent.fresh)
      } else if (ev.key === '2') {
        ev.preventDefault()
        grade(1, task === 'recallNew' && sent.fresh)
      } else if (ev.key === '3') {
        ev.preventDefault()
        grade(0, false, <Ans label="记下" v={defText} />)
      }
      return
    }
    if (!graded && !revealed && (task === 'pick' || task === 'sense' || task === 'choose') && /^[1-6]$/.test(ev.key)) {
      const btns = root.current?.querySelectorAll<HTMLButtonElement>('.forge-card .mo, .forge-card .opt')
      const btn = btns?.[Number(ev.key) - 1]
      if (btn && !btn.disabled) {
        ev.preventDefault()
        btn.click()
      }
    }
  }
  return (
    <div className="forge-wrap">
      <Queue {...qProps} />
      <div className="forge-main" id="f-main" ref={root}>
        <Scene
          style={style}
          no={no || 1}
          part={blind ? '?' : e.lemma}
          pos={pos}
          stage={r.stage}
          from={res.o ? res.from : r.stage}
          outcome={res.o}
          cells={cellsOf(no - 1)}
          phrase={phq ? detailOf(phq.id) : undefined}
          piece={(sides) => (
            <span className="f-piece-stage" id="f-piece" onDoubleClick={() => canFlip && useFlip.getState().toggle([k])}>
              <Piece
                key={key}
                sides={sides || (pId ? [1, 0, 0, 0] : [-1, 1, 1, -1])}
                k={heroK}
                st={r.stage}
                slots={heroSlots}
                acc={withOk(accOf(d, [k], phq?.id))}
                className={flipped ? 'flipped' : ''}
                lb={<Label word={blind ? '?' : e.lemma} sub={blind || !flipped ? undefined : backSub} fixedGrid={sides ? true : !multiWord} back={flipped} slots={heroSlots} />}
                pos={pos}
                wu={sides ? 100 : heroWu}
              />
            </span>
          )}
        />
        <div className="forge-card">
          {phq ? (
            <PhraseCard key={phq.id} id={phq.id} core={e.lemma} onAnswer={(ok) => answerPhrase(phq.id, phq.counted, ok)} onNext={() => later(0)} />
          ) : (
            <>
              <div className="f-trk">
                <span>{kind === 'form' ? '形' : '义'}</span>
                <i>
                  <b style={{ width: `${pct}%` }} />
                </i>
                <span>{isAgainDrill ? (step >= 2 && autoTask !== base.task ? '降阶重练' : '当日重练') : !dueNow ? '提前练习' : STAGE_NAMES[r.stage]}</span>
              </div>
              {pId && <div className="small mut">挂靠于 {lemmaOf(d, pId)}</div>}
              {pending ? (
                <div className="fb-card ok">
                  <div>{wordDefOf(e, defLang) || '—'}</div>
                  <div style={{ font: '16px/1.8 var(--read)' }}>
                    <Marked s={pending.s} form={e.lemma} />
                  </div>
                  <div className="pr recall-btns">
                    <button className="btn mint sm" onClick={() => settleUse(true)}>
                      用对了
                    </button>
                    <button className="btn rose sm" onClick={() => settleUse(false)}>
                      用错了
                    </button>
                  </div>
                </div>
              ) : body}
              {!pending && needFresh && !sent.fresh && hasKey && !graded && !revealed && !input && (
                <button className="btn alt sm" disabled={!!aiBusy} onClick={() => void generateExample()}>
                  {aiBusy === 'example' ? '正在生成…' : '用 AI 生成例句'}
                </button>
              )}
              <div id="f-feedback">
                {fb?.kind === 'hint' && (
                  <Reveal
                    actions={
                      fb.retry ? (
                        <button className="btn alt sm" onClick={() => setFb(null)}>
                          再试一次
                        </button>
                      ) : (
                        <>
                          {graded && !down && nextEasier && (
                            <button className="btn alt sm" onClick={practiceEasier}>
                              再练一次
                            </button>
                          )}
                          {graded && isAgainDrill && step >= 3 && (
                            <button
                              className="btn alt sm"
                              onClick={() => {
                                setAgain(k, false)
                                useApp.getState().say('已留到明日复习')
                                later(0)
                              }}
                            >
                              留到明天
                            </button>
                          )}
                        </>
                      )
                    }
                    onNext={graded || !fb.retry ? () => later(0) : undefined}
                  >
                    {fb.node}
                  </Reveal>
                )}
              </div>
              {!blind && origin.length > 0 && (
                <button className="btn alt sm f-jump" onClick={() => jumpToOrigin(k, 0)}>
                  跳回原文
                </button>
              )}
            </>
          )}
        </div>
        {(graded || revealed) && ety && <div className="ety-line f-ety">{ety}</div>}
      </div>
    </div>
  )
}

function Header({
  qmode,
  setQmode,
  due,
  total,
  gold,
  sub,
}: {
  qmode: 'due' | 'all'
  setQmode: (m: 'due' | 'all') => void
  due: number
  total: number
  gold: number
  sub: string
}) {
  return (
    <div className="vh">
      <h2>
        锻造台<small className="vh-sub">· {sub}</small>
      </h2>
      <div className="vh-r">
        <div className="seg" id="f-qmode">
          <button className={qmode === 'due' ? 'on' : ''} onClick={() => setQmode('due')}>
            今日{due ? ` ${due}` : ''}
          </button>
          <button className={qmode === 'all' ? 'on' : ''} onClick={() => setQmode('all')}>
            全部 {total}
          </button>
        </div>
        <span className="gold-stat" id="forge-stat">
          运用 {gold}
        </span>
      </div>
    </div>
  )
}

function Queue({
  rows,
  done,
  k,
  qmode,
  outcome,
  again,
  onPick,
  asking = null,
}: {
  rows: string[]
  done: string[]
  k: string | null
  qmode: 'due' | 'all'
  outcome: Outcome
  again: ReadonlySet<string>
  onPick: (id: string) => void
  asking?: string | null
}) {
  const d = useApp((x) => x.data)
  const day = today()
  const n = done.length
  return (
    <aside className="forge-queue" id="f-queue">
      {rows.length > 0 && (
        <div className="fq-head">
          <b>
            {qmode === 'due' ? '今日' : '本轮'} {n} / {rows.length}
          </b>
          <i>
            <span style={{ width: `${(n / rows.length) * 100}%` }} />
          </i>
        </div>
      )}
      {rows.length ? (
        rows.map((q, i) => {
          const r = d.learn[q]
          const e = d.pieces[q]
          if (!r || !e) return null
          const lp = isLinkedPhrase(d.pieces, q)
          const kind = lp ? null : dueCard(r, day) || (again.has(q) ? (r.form?.last === day ? 'form' : 'meaning') : null)
          const fin = done.includes(q)
          const cur = q === k
          const mark = cur && outcome ? outcome : fin ? 'ok' : again.has(q) ? 'bad' : ''
          const pId = isPhraseId(d, q) ? parentOf(d, q) : null
          const c = kind ? cardOf(r, kind) : r.sched
          const sub = qmode === 'due' && !lp && parentAsks(r) ? phraseFor(d, q, day) : null
          return (
            <Fragment key={q}>
              <button className={`fq-item${cur ? ' on' : ''}${fin ? ' fin' : ''}`} onClick={() => !fin && onPick(q)} disabled={fin}>
                <span className={`fq-no${mark ? ` ${mark}` : ''}`}>{String(i + 1).padStart(2, '0')}</span>
                <Piece sides={[0, 1, 0, -1]} k={0.34} st={r.stage} lb="" pos={e.pos} />
                <div className="fq-txt">
                  <b>{kind === 'form' && !fin ? `${(d.prefs.defLang === 'zh' ? e.tile || pieceGlossFor(e, 'zh') : pieceGlossFor(e, 'en')) || ''} · ?` : e.lemma}</b>
                  <span>
                    {pId ? `挂靠 ${lemmaOf(d, pId)} · ` : ''}
                    {lp ? <PhraseDots n={phN(r)} /> : STAGE_NAMES[r.stage]}
                  </span>
                </div>
                {fin ? <span className="fq-ok">✓</span> : qmode === 'all' ? <span className="due-tag">{whenOf(c, day)}</span> : kind && <span className="card-tag">{kind === 'form' ? '形' : '义'}</span>}
              </button>
              {sub && (!fin || sub === asking || d.learn[sub].ph?.last === day) && (
                <div className={`fq-sub${sub === asking ? ' on' : d.learn[sub].ph?.last === day ? ' fin' : ''}`}>
                  <span>{lemmaOf(d, sub)}</span>
                  <PhraseDots n={phN(d.learn[sub])} />
                </div>
              )}
            </Fragment>
          )
        })
      ) : (
        <div className="small mut fq-empty">暂无待锻拼块</div>
      )}
    </aside>
  )
}
