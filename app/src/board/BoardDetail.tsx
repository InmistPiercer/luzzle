import { useState } from 'react'
import { senseById } from '../lang/senses'
import { useApp } from '../app/store'
import { today } from '../core/date'
import { lemmatize } from '../lang/lemmatize'
import { isPhraseId, lemmaOf, parentOf, pieceGlossFor, piecesOfLemma } from '../learn/pieces'
import { dueCard } from '../learn/engine'
import { accOf, isLinkedPhrase, phN, phraseGroups, phrasesOf, phraseStatus, type PhraseStatus } from '../learn/phrase'
import { PhraseDots } from '../forge/PhraseCard'
import { Label, Piece, STAGE_NAMES } from '../pieces/Piece'
import { deletePieceWithUndo } from '../app/pieceActions'
import { Meters } from '../pieces/Meters'
import { GoalSeg } from '../reader/Popover'
import { jumpToOrigin, originsOf, useReader } from '../reader/session'
import { boardChange, undoBoard } from './history'
import { compOf, islandName, moveTo, neighborsOf } from './logic'
import { morphSplit } from '../morph/actions'
import { OccLine } from '../pieces/OccLine'
import { etymKind, useEtymLine } from '../morph/etym'

const ZH_POS: Record<string, string> = {
  'v.': '动词',
  'n.': '名词',
  'adj.': '形容词',
  'adv.': '副词',
  phrase: '短语',
  'func.': '虚词',
}

const POS_RE = /^(?:(?:v|vt|vi|n|adj|adv|prep|conj|pron|det|aux|art|int|interj|num|a|ad)\.\s*(?:[&/,]\s*)?)+/i
const stripPos = (s: string) => s.replace(POS_RE, '').trim()
const zhSenseLine = (s: string) => {
  const clean = stripPos(s).replace(/[A-Za-z]+(?:\s+[A-Za-z]+)*/g, '').replace(/\(\s*\)|（）/g, '').trim()
  return clean || stripPos(s)
}

export function OriginButton({ id, className = 'btn alt sm' }: { id: string; className?: string }) {
  const d = useApp((x) => x.data)
  const n = originsOf(d, id).length
  return (
    <button
      className={className}
      onClick={(e) => {
        e.stopPropagation()
        const j = useReader.getState().jump
        jumpToOrigin(id, j?.id === id ? j.i + 1 : undefined)
      }}
    >
      <svg className="ico">
        <use href="#i-book" />
      </svg>
      跳回原文{n > 1 ? ` · ${n} 处` : ''}
    </button>
  )
}

export function openForge(id: string) {
  const s = useApp.getState()
  const r = s.data.learn[id]
  const isDueNow = !!r && (!!dueCard(r, today()) || s.again.has(id))
  useApp.setState({ forgeWord: id, forgeAll: !isDueNow, view: 'forge' })
}

export function BoardDetail() {
  const d = useApp((x) => x.data)
  const id = useApp((x) => x.boardSel)
  const say = useApp((x) => x.say)
  const setPrefs = useApp((x) => x.setPrefs)
  const defLang = d.prefs.defLang || 'en'
  const ety = useEtymLine(id && d.pieces[id] && !isPhraseId(d, id) ? d.pieces[id].lemma : null)
  if (!id || !d.learn[id]) return <aside className="binfo" id="binfo" />
  const p = d.pieces[id]
  const r = d.learn[id]
  const kind = etymKind(d, p.lemma)
  const ph = isPhraseId(d, id)
  const pId = parentOf(d, id)
  const lp = isLinkedPhrase(d.pieces, id)
  const day = today()
  const groups = !ph && phrasesOf(d, id).length ? phraseGroups(d, id, day) : null
  const siblings = ph ? [] : piecesOfLemma(d, lemmatize(p.lemma))
  const nb = neighborsOf(d, id).map((k) => lemmaOf(d, k))
  const due = !!dueCard(r, today())
  const sel = (k: string) => useApp.setState({ boardSel: k })
  const zhGloss = stripPos(pieceGlossFor(p, 'zh'))
  const enGloss = pieceGlossFor(p, 'en')
  const senseList = (p.senses?.length ? p.senses : p.dict || []).filter(Boolean)
  const curSenseIdx = (() => {
    const s = r.occ[0]?.ai?.sense ?? p.ai?.sense
    if (s && s >= 1 && s <= senseList.length) return s - 1
    const g = p.gloss || p.tile || ''
    return g ? senseList.findIndex((x) => x.includes(g)) : -1
  })()
  const occEx = r.occ[0]?.ai?.ex || p.ai?.ex
  const occEn = p.ai?.en && !/[\u4e00-\u9fff]/.test(p.ai.en) && p.ai.en !== enGloss ? p.ai.en : ''
  const cleanZh = zhSenseLine(zhGloss)
  const subTitle = defLang === 'en' ? `${p.pos || 'v.'} · ${stripPos(enGloss) || enGloss}` : `${ZH_POS[p.pos || ''] || p.pos || ''} · ${cleanZh || '—'}`
  return (
    <aside className="binfo" id="binfo">
      <div className="binfo-top">
        {pId ? (
          <button className="btn alt sm" onClick={() => sel(pId)}>
            ← 返回 {lemmaOf(d, pId)}
          </button>
        ) : (
          <span className="small mut binfo-tag" style={{ fontWeight: 700 }}>
            {ph ? '独立短语' : <span className="binfo-log">PRINT LOG · No.{String(Object.keys(d.learn).indexOf(id) + 1).padStart(3, '0')}</span>}
          </span>
        )}
        <div className="seg" role="group" aria-label="释义语言">
          {(
            [
              ['en', '英'],
              ['zh', '中'],
            ] as const
          ).map(([v, lb]) => (
            <button key={v} className={defLang === v ? 'on' : ''} onClick={() => setPrefs({ defLang: v })}>
              {lb}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Piece sides={ph ? [1, 0, 0, 0] : [-1, 1, 1, -1]} k={0.68} st={r.stage} acc={ph ? null : accOf(d, [id])} lb={<Label word={p.lemma} fixedGrid />} pos={p.pos} />
        <div>
          <div style={{ font: '800 20px var(--read)' }}>{p.lemma}</div>
          <div className="mut small" style={{ fontWeight: 700 }}>
            {subTitle}
          </div>
          <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="chip" style={{ margin: 0 }}>
              {lp ? (
                <>
                  {PH_STATUS[phraseStatus(d, id, day)]} <PhraseDots n={phN(r)} />
                </>
              ) : (
                STAGE_NAMES[r.stage]
              )}
            </span>
          </div>
        </div>
      </div>
      {siblings.length > 1 && (
        <div className="card binfo-senses">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>同词多义（{siblings.length}）</div>
          <div className="binfo-sense-row">
            {siblings.map((sid, idx) => {
              const sp = d.pieces[sid]
              const rawLabel = pieceGlossFor(sp, defLang)
              const label = defLang === 'en' ? rawLabel : stripPos(rawLabel) || sp?.pos || ''
              return (
                <button key={sid} className={`sense-pill${sid === id ? ' on' : ''}`} onClick={() => sel(sid)}>
                  <b>#{idx + 1}</b>
                  <span>{label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      <div className="card binfo-exp">
        {defLang === 'en' ? (
          <>
            <div className="binfo-exp-hd">Meaning &amp; Formation</div>
            <div className="binfo-exp-row">
              <span className="binfo-exp-k">Meaning</span>
              <b>{senseById(p.sid)?.[6] || enGloss}</b>
            </div>
            {(ety || p.etymBase) && (
              <div className="binfo-exp-row">
                <span className="binfo-exp-k">{kind === 'o' ? 'Origin' : 'Formation'}</span>
                <span>{ety || p.etymBase}</span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="binfo-exp-hd">词义与构词</div>
            <div className="binfo-exp-row">
              <span className="binfo-exp-k">释义</span>
              <b>{senseById(p.sid)?.[4] || cleanZh || '—'}</b>
            </div>
            {ety && (
              <div className="binfo-exp-row">
                <span className="binfo-exp-k">{kind === 'o' ? '词源' : '构词'}</span>
                <span>{ety}</span>
              </div>
            )}
            {senseList.length > 1 && (
              <ol className="binfo-sense-list">
                {senseList.map((s, idx) => (
                  <li key={idx} className={idx === curSenseIdx ? 'on' : ''}>
                    {zhSenseLine(s)}
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
      {!lp && (
        <div className="card binfo-learn">
          <GoalSeg id={id} goal={r.goal} />
          <Meters r={r} day={today()} />
        </div>
      )}
      {groups && <PhraseGroups id={id} groups={groups} onSel={sel} />}
      {nb.length > 0 && !ph && (
        <div className="card">
          <div style={{ fontWeight: 700 }}>{islandName(d, compOf(d, id))}</div>
          <div className="small mut" style={{ marginTop: 4 }}>
            {nb.join(' · ')}
          </div>
          <button
            className="btn alt sm"
            style={{ marginTop: 8 }}
            onClick={() => {
              boardChange(`拆开 ${lemmaOf(d, id)}`, (x) => moveTo(x, id, x.board.pos[id].x + 24, x.board.pos[id].y + 24, true))
              say('已拆开', undoBoard)
            }}
          >
            <svg className="ico">
              <use href="#i-unlink" />
            </svg>
            拆开
          </button>
        </div>
      )}
      <OccLine key={id} id={id} note={defLang === 'en' ? occEn : occEx} />
      <div className="pr" style={{ marginTop: 0 }}>
        <OriginButton id={id} />
        {!ph && (
          <button className="btn alt sm" onClick={() => morphSplit(lemmaOf(d, id))}>
            <svg className="ico">
              <use href="#i-grid" />
            </svg>
            拆词
          </button>
        )}
        <button className="btn alt sm" style={{ marginLeft: 'auto' }} onClick={() => deletePieceWithUndo(id)}>
          删除
        </button>
      </div>
      {r.goal !== 'stash' && (
        <button className="btn" onClick={() => openForge(id)}>
          {due ? '锻造' : '提前练习'}
        </button>
      )}
    </aside>
  )
}

const PH_STATUS = { learning: '学习中', pending: '未学习', mastered: '已掌握' } as const

function PhraseGroups({ id, groups, onSel }: { id: string; groups: Record<PhraseStatus, string[]>; onSel: (k: string) => void }) {
  const d = useApp((x) => x.data)
  const [drag, setDrag] = useState<string | null>(null)
  const defLang = d.prefs.defLang || 'en'
  const move = (from: string, to: string) => {
    if (from === to) return
    useApp.getState().update((x) => {
      const cur = phrasesOf(x, id)
      const fi = cur.indexOf(from)
      const ti = cur.indexOf(to)
      if (fi < 0 || ti < 0) return x
      const kids = cur.filter((k) => k !== from)
      kids.splice(ti, 0, from)
      return { ...x, pieces: { ...x.pieces, [id]: { ...x.pieces[id], childrenIds: kids } } }
    })
  }
  return (
    <div className="card ph-groups">
      {(['learning', 'pending', 'mastered'] as const).map(
        (g) =>
          groups[g].length > 0 && (
            <div key={g} className={`ph-group ${g}`}>
              <div className="ph-group-hd">
                {PH_STATUS[g]}（{groups[g].length}）
              </div>
              {groups[g].map((ch) => (
                <button
                  key={ch}
                  className={`ph-row-btn${drag === ch ? ' drag' : ''}`}
                  draggable={g === 'pending'}
                  onDragStart={() => setDrag(ch)}
                  onDragEnd={() => setDrag(null)}
                  onDragOver={(ev) => g === 'pending' && drag && ev.preventDefault()}
                  onDrop={() => drag && move(drag, ch)}
                  onClick={() => onSel(ch)}
                >
                  <div>
                    <b>{d.pieces[ch]?.lemma}</b>
                    <div className="small mut">{defLang === 'en' ? pieceGlossFor(d.pieces[ch], 'en') : stripPos(pieceGlossFor(d.pieces[ch], 'zh'))}</div>
                  </div>
                  {g === 'learning' && <PhraseDots n={phN(d.learn[ch])} />}
                </button>
              ))}
            </div>
          ),
      )}
    </div>
  )
}
