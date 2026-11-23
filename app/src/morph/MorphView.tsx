import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useApp } from '../app/store'
import { OriginButton, openForge } from '../board/BoardDetail'
import { pieceGlossFor } from '../learn/pieces'
import type { Morpheme, Part } from './data'
import { CORE_IDS, TYPE } from './data'
import { useMorphData } from './local'
import { MorphEngine } from './engine'
import { Label, Piece, type Sides } from '../pieces/Piece'
import { formulaOf, morphEn } from './etym'
import { EN_GLOSS } from '../lang/lexicon'
import { sensesOfWord } from '../lang/senses'
import { useDataSeq } from '../core/shards'
import { addToVocab, aiSplit, deleteMorph, mergeMorph, morphSplit, refreshBasic, useMx, vocabPieces } from './actions'

const PART_POS: Record<string, string> = { pre: 'adv.', root: 'n.', base: 'n.', suf: 'v.' }
const sidesAt = (i: number, n: number): Sides => [0, i < n - 1 ? 1 : 0, 0, i > 0 ? -1 : 0]

function Explode({ e, parts, w }: { e: MorphEngine; parts: Part[]; w: string }) {
  const d = useApp((x) => x.data)
  const set = useMx((x) => x.set)
  const selM = useMx((x) => x.selM)
  const en = d.prefs.defLang !== 'zh'
  const n = parts.length
  const rows = parts.map(([s, id, b]) => {
    const mid = id === 'base' ? `base:${b || s}` : id
    const m = e.morpheme(mid)
    const t = m?.t || 'base'
    const mean = (en ? morphEn(m?.id || '') : m?.zh.split(/[，,；;]/)[0]) || ''
    return { s, mid, m, t, mean }
  })
  const W = 720
  const ka = 0.6
  const kb = 0.86
  const x0 = W / 2 - (n * 100 * ka) / 2
  const cx = (i: number) => (W * (i + 0.5)) / n
  const formula = formulaOf(d, w, parts)
  return (
    <>
      <div className="mx-explode" style={{ width: W }}>
        <svg className="mx-lead" width={W} height={250} aria-hidden="true">
          {rows.map((_, i) => (
            <path key={i} d={`M${x0 + (i + 0.5) * 100 * ka} ${12 + 122 * ka}L${cx(i)} ${118 + 22 * kb}`} />
          ))}
        </svg>
        {rows.map((r, i) => (
          <span key={`a${i}`} className="mx-ex-a" style={{ left: x0 + i * 100 * ka - 24 * ka, top: 12 - 22 * ka }}>
            <Piece sides={sidesAt(i, n)} k={ka} st={3} pos={PART_POS[r.t]} lb={<Label word={r.s} />} />
          </span>
        ))}
        {rows.map((r, i) => (
          <button key={`b${i}`} className={`mx-ex-b t-${r.t}${selM === r.mid ? ' on' : ''}`} style={{ left: cx(i) - 50 * kb - 24 * kb, top: 118 - 22 * kb }} onClick={() => r.m && set({ selM: r.mid })}>
            <Piece sides={sidesAt(i, n)} k={kb} st={selM === r.mid ? 4 : 3} pos={PART_POS[r.t]} lb={<Label word={r.s} />} />
            <i className="mx-ex-no">{i + 1}</i>
            <small>
              {TYPE[r.t]}
              {r.mean ? ` · ${r.mean}` : ''}
            </small>
          </button>
        ))}
      </div>
      <table className="mx-table">
        <thead>
          <tr>
            <td>No.</td>
            <td>零件</td>
            <td>类型</td>
            <td>含义</td>
            <td>变体</td>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={selM === r.mid ? 'on' : ''}>
              <td>{i + 1}</td>
              <td className="mono">{r.m && r.t === 'pre' ? `${r.s}-` : r.m && r.t === 'suf' ? `-${r.s}` : r.s}</td>
              <td>{TYPE[r.t]}</td>
              <td>{r.mean}</td>
              <td className="mono">{r.m?.vars.map((v) => (r.t === 'pre' ? `${v}-` : r.t === 'suf' ? `-${v}` : v)).join(' / ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {formula && <div className="mx-formula">{formula}</div>}
    </>
  )
}

function Assemble({ e, parts, w }: { e: MorphEngine; parts: Part[]; w: string }) {
  const d = useApp((x) => x.data)
  const set = useMx((x) => x.set)
  const selM = useMx((x) => x.selM)
  const en = d.prefs.defLang !== 'zh'
  const formula = formulaOf(d, w, parts)
  return (
    <>
      <div className="mx-asm">
        {parts.map(([s, id, b], i) => {
          const mid = id === 'base' ? `base:${b || s}` : id
          const m = e.morpheme(mid)
          const t = m?.t || 'base'
          const mean = (en ? morphEn(m?.id || '') : m?.zh.split(/[，,；;]/)[0]) || ''
          return (
            <button key={i} className={`mx-asm-u t-${t}${selM === mid ? ' on' : ''}`} onClick={() => m && set({ selM: mid })}>
              <Piece sides={sidesAt(i, parts.length)} k={0.9} st={4} pos={PART_POS[t]} lb={<Label word={s} fixedGrid />} />
              <small>
                {TYPE[t]}
                {mean ? ` · ${mean}` : ''}
              </small>
            </button>
          )
        })}
      </div>
      {formula && <div className="mx-formula">{formula}</div>}
    </>
  )
}

function Lightbox({ e, parts, w }: { e: MorphEngine; parts: Part[]; w: string }) {
  const d = useApp((x) => x.data)
  const set = useMx((x) => x.set)
  const selM = useMx((x) => x.selM)
  const en = d.prefs.defLang !== 'zh'
  const formula = formulaOf(d, w, parts)
  const units = parts.map(([s, id, b]) => {
    const mid = id === 'base' ? `base:${b || s}` : id
    const m = e.morpheme(mid)
    const t = m?.t || 'base'
    return { s, mid, m, t, mean: (en ? morphEn(m?.id || '') : m?.zh.split(/[，,；;]/)[0]) || '' }
  })
  const sel = units.find((u) => u.mid === selM) || units.find((u) => u.t === 'root' || u.t === 'base') || units[0]
  return (
    <div className="mx-lbx">
      <div className="mx-film" style={{ '--n': units.length } as CSSProperties}>
        {units.map((u, i) => (
          <button key={i} className={`mx-frame t-${u.t}${u === sel ? ' on' : ''}`} onClick={() => u.m && set({ selM: u.mid })}>
            <span className="mx-sq">{u.s}</span>
            {u === sel && (
              <svg className="mx-ring" viewBox="0 0 140 140" aria-hidden="true">
                <path d="M70 6C112 4 136 34 134 72C132 110 104 136 66 134C28 132 4 104 6 68C8 36 30 10 74 8C60 12 40 20 30 34" />
              </svg>
            )}
          </button>
        ))}
      </div>
      {sel && (
        <div className="mx-lbx-note">
          ← {TYPE[sel.t]}
          {sel.mean ? ` · ${sel.mean}` : ''}
        </div>
      )}
      {formula && <div className="mx-formula">{formula}</div>}
      <div className="mx-lbx-k">
        {units
          .filter((u) => u !== sel)
          .map((u) => [u.s, TYPE[u.t], u.mean].filter(Boolean).join(' · '))
          .join('  ·  ')}
      </div>
    </div>
  )
}

function rootMarked(word: string, m: Morpheme | undefined) {
  const vars = (m ? [m.main, ...m.vars] : []).map((v) => v.replace(/[-()]/g, '')).filter((v) => v.length >= 2).sort((a, b) => b.length - a.length)
  const v = vars.find((x) => word.toLowerCase().includes(x))
  if (!v) return word
  const i = word.toLowerCase().indexOf(v)
  return (
    <>
      {word.slice(0, i)}
      <em className="mx-root">{word.slice(i, i + v.length)}</em>
      {word.slice(i + v.length)}
    </>
  )
}

function MergePick({ e, m }: { e: MorphEngine; m: Morpheme }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const all = e.morphemes().filter((x) => x.id !== m.id && !x.ai)
  const near = (o: Morpheme) => {
    const a = m.main.replace(/-/g, '')
    const b = o.main.replace(/-/g, '')
    let i = 0
    while (i < a.length && a[i] === b[i]) i++
    const zh = [...o.zh].filter((c) => /[\u4e00-\u9fff]/.test(c) && m.zh.includes(c)).length
    return (i >= 3 ? i * 2 : 0) + zh * 3 + (o.vars.some((v) => m.vars.includes(v)) ? 6 : 0) + (o.t === m.t ? 1 : 0)
  }
  const t = q.trim().toLowerCase()
  const shown = t
    ? all.filter((o) => o.main.includes(t) || o.vars.some((v) => v.startsWith(t)) || o.zh.includes(t)).slice(0, 8)
    : all
        .map((o) => [o, near(o)] as const)
        .filter(([, n]) => n > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([o]) => o)
  if (!open)
    return (
      <button className="btn alt sm" onClick={() => setOpen(true)}>
        合并到…
      </button>
    )
  return (
    <div className="mx-mpop">
      <input autoFocus placeholder="搜索" value={q} onChange={(ev) => setQ(ev.target.value)} onKeyDown={(ev) => ev.key === 'Escape' && setOpen(false)} />
      <div className="mx-blks">
        {shown.map((o) => (
          <button key={o.id} className={`mx-blk t-${o.t}`} onClick={() => mergeMorph(m.id, o.id)}>
            {o.main}
            <small>{o.zh}</small>
          </button>
        ))}
        <button className="btn alt sm" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
    </div>
  )
}

function Rules({ e, parts }: { e: MorphEngine; parts: Part[] }) {
  const r = e.rulesOf(parts)
  if (!r.length) return null
  return (
    <ul className="mx-rules">
      {r.map((x) => (
        <li key={x.s}>
          <b>{x.s}</b>：{x.r}
        </li>
      ))}
    </ul>
  )
}

function VocabActs({ w, info }: { w: string; info?: { z?: string; p?: string } | null }) {
  const d = useApp((x) => x.data)
  const ids = vocabPieces(w)
  const [chosen, choose] = useState('')
  const id = ids.length === 1 ? ids[0] : ids.includes(chosen) ? chosen : ''
  if (ids.length > 1 && !id) {
    return ids.map((key) => (
      <button key={key} className="btn alt sm" onClick={() => choose(key)}>
        {pieceGlossFor(d.pieces[key], d.prefs.defLang || 'en') || d.pieces[key].lemma}
      </button>
    ))
  }
  if (id)
    return (
      <>
        <span className="mx-vocab">已在词库 · 第 {d.learn[id]?.stage} 阶</span>
        {ids.length > 1 && <button className="link" onClick={() => choose('')}>选择义项</button>}
        <button className="btn sm" onClick={() => openForge(id)}>
          去锻造
        </button>
        <OriginButton id={id} />
      </>
    )
  return (
    <button className="btn sm" onClick={() => addToVocab(w, info || undefined)}>
      收入词库
    </button>
  )
}

export function MorphView() {
  const data = useApp((x) => x.data)
  useApp((x) => x.dictSeq)
  useMorphData((x) => x.seq)
  useDataSeq((x) => x.seq)
  const ui = useMx()
  const draft = data.prefs.style === 'draft'
  const neon = data.prefs.style === 'neon'
  const en = data.prefs.defLang !== 'zh'
  const morphGloss = (m: Morpheme) => (en ? morphEn(m.id) || (m.t === 'base' ? sensesOfWord(m.main)[0]?.[5] || EN_GLOSS[m.main] || '' : '') : m.zh)
  const wordGloss = (ww: string, z?: string) => (en ? sensesOfWord(ww)[0]?.[5] || EN_GLOSS[ww] || '' : z || '')
  useEffect(() => {
    void refreshBasic()
  }, [])
  const [q, setQ] = useState('')
  const [shelfQ, setShelfQ] = useState('')
  const [mcat, setMcat] = useState<'all' | 'pre' | 'root' | 'suf' | 'words'>('all')
  const [showAllMine, setShowAllMine] = useState(false)
  const [showMine, setShowMine] = useState(true)
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({})
  useEffect(() => {
    setShowAllMine(false)
  }, [ui.selM])
  const e = useMemo(() => new MorphEngine(data.morph as never, data), [data])

  const sq = shelfQ.trim().toLowerCase()
  const matchCat = (m: Morpheme) => mcat === 'all' || (mcat === 'root' ? m.t === 'root' || m.t === 'base' : m.t === mcat)
  const matchM = (m: Morpheme) => !sq || m.main.toLowerCase().includes(sq) || m.vars.some((v) => v.toLowerCase().includes(sq)) || m.zh.toLowerCase().includes(sq)
  const list = [...e.morphemes(), ...e.bases()].map((m) => ({ m, n: e.relatedWords(m.id).length }))
  const mine = list.filter((x) => (x.n || x.m.ai) && matchCat(x.m) && matchM(x.m)).sort((a, b) => b.n - a.n)
  const seedAll = list.filter((x) => !x.n && !x.m.ai && matchCat(x.m))
  const seed = sq ? seedAll.filter((x) => matchM(x.m)) : seedAll.filter((x) => CORE_IDS.has(x.m.id))
  const myWords = [...e.myWords()]
    .reverse()
    .filter((sw) => !sq || sw.includes(sq) || (e.lookupWord(sw)?.z || '').toLowerCase().includes(sq))
  const wordList = (emptyMsg: string) => (
    <div style={{ display: 'grid', gap: 6 }}>
      {myWords.length ? (
        myWords.map((sw) => {
          const swEntry = e.ms.words[sw]
          const info = e.lookupWord(sw)
          return (
            <button
              key={sw}
              className={`mx-morph t-word got${ui.cur === sw && !ui.preview ? ' on' : ''}`}
              onClick={() => ui.set({ cur: sw, preview: null, selM: e.rootOf(swEntry.parts) || ui.selM })}
            >
              <span className="mx-mn">{sw}</span>
              <span className="mx-mz">{info?.z || swEntry.parts.map((p) => p[0]).join(' + ')}</span>
              <span className="mx-cnt">{swEntry.parts.length}</span>
            </button>
          )
        })
      ) : (
        <div className="small mut">{emptyMsg}</div>
      )}
    </div>
  )
  const Card = ({ m, n }: (typeof list)[number]) => (
    <button
      key={m.id}
      className={`mx-morph t-${m.t} ${n || m.ai ? 'got' : 'locked'}${ui.selM === m.id ? ' on' : ''}`}
      onClick={() => ui.set({ selM: m.id })}
    >
      <span className="mx-mn">
        {m.main}
        {m.ai && <i className="mx-ai">AI</i>}
      </span>
      <span className="mx-mz">{morphGloss(m)}</span>
      {n > 0 && <span className="mx-cnt">{n}</span>}
    </button>
  )

  const aiBtn = (
    <button className="btn alt sm" onClick={() => void aiSplit(ui.cur)}>
      AI 精细拆解
    </button>
  )

  let wordCard: ReactNode
  const w = ui.cur
  const entry = w ? e.ms.words[w] : undefined
  if (!w || (!ui.preview && !entry)) wordCard = <div className="mx-empty">在阅读中点「拆词」，或在上方输入单词</div>
  else if (ui.preview) {
    const P = ui.preview
    const title = { opaque: '不建议拆解', refuse: '不拆解', unknown: '暂无可靠拆解' }[P.kind]
    const opEty = P.kind === 'opaque' ? (en ? e.etym(w)?.[2] || '' : P.ety) : ''
    wordCard = (
      <div className="mx-card">
        <div className="mx-head">
          <div className="mx-w">{w}</div>
          <span className="mx-layer warn">{title}</span>
        </div>
        {P.kind === 'opaque' ? opEty && <div className="ety-line">{opEty}</div> : <div className="mx-note">{P.note}</div>}
        {P.kind !== 'refuse' && <div className="pr">{aiBtn}</div>}
      </div>
    )
  } else if (entry) {
    const info = e.lookupWord(w)
    const layer = { exact: ['精确拆解', ''], basic: ['基础切分', 'basic'], ai: ['AI 拆解', 'ai'] }[entry.layer]
    const ext = e.cls(w, entry.parts) === 'x'
    const chain = ext ? (en ? e.etym(w)?.[2] : e.etym(w)?.[1]) || '' : ''
    const wg = wordGloss(w, info?.z)
    wordCard = (
      <div className="mx-card">
        <div className="mx-head">
          <div className="mx-w">{w}</div>
          <span className={`mx-layer ${layer[1]}`}>{layer[0]}</span>
          {ext && <span className="mx-layer warn">引申</span>}
          {wg && (
            <span className="small mut">
              {info?.p || ''} {wg}
            </span>
          )}
        </div>
        {draft ? <Explode key={w} e={e} parts={entry.parts} w={w} /> : neon ? <Lightbox key={w} e={e} parts={entry.parts} w={w} /> : <Assemble key={w} e={e} parts={entry.parts} w={w} />}
        {chain && <div className="ety-line">{chain}</div>}
        <Rules e={e} parts={entry.parts} />
        {entry.ctx.length > 0 && (
          <div className="mx-ctx">
            {entry.ctx.slice(-3).map((c, i) => (
              <div key={i}>
                “{c.s}”<span>{c.doc || ''}</span>
              </div>
            ))}
          </div>
        )}
        <div className="pr" style={{ marginTop: 4 }}>
          <VocabActs w={w} info={info} />
          {aiBtn}
        </div>
      </div>
    )
  }

  const m = e.morpheme(ui.selM)
  let browse: ReactNode = null
  if (m) {
    const mineW = e.relatedWords(m.id)
    const shownMineW = showAllMine ? mineW : mineW.slice(0, 6)
    const rels = e.relatedMorphemes(m.id)
    const fam = e.family(m.id).filter((x) => !mineW.includes(x.w))
    const Node = ({ w: nw, z, p, kind }: { w: string; z?: string; p?: string; kind: string }) => {
      const vid = vocabPieces(nw)[0]
      return (
        <div className={`mx-node ${kind}`}>
          <button className="mx-nw" onClick={() => morphSplit(nw)}>
            <b>
              {vid && <Piece sides={[-1, 1, 1, -1]} k={0.24} st={data.learn[vid]?.stage || 1} pos={data.pieces[vid]?.pos} lb="" />}
              <span>{rootMarked(nw, m)}</span>
            </b>
            <small>
              {p || ''} {wordGloss(nw, z)}
            </small>
          </button>
          <div className="mx-nacts">
            <VocabActs w={nw} info={{ z, p }} />
          </div>
        </div>
      )
    }
    browse = (
      <>
        <div className="mx-fam">
          <div className="mx-fhead">
            <span className={`mx-part t-${m.t} big`}>
              <b>{m.main}</b>
              <small>
                {TYPE[m.t]}
                {morphGloss(m) ? ` · ${morphGloss(m)}` : ''}
              </small>
            </span>
            <span className="small mut">变体 {m.vars.join(' / ')}</span>
            {rels.length > 0 && (
              <span className="small mut" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                关联
                {rels.map((rm) => (
                  <button key={rm.id} className="chip" style={{ margin: 0 }} onClick={() => ui.set({ selM: rm.id })}>
                    {rm.main}
                  </button>
                ))}
              </span>
            )}
            <span className="mx-aiops">
              {m.ai && (
                <>
                  <MergePick key={m.id} e={e} m={m} />
                  <button className="btn alt sm" onClick={() => deleteMorph(m.id)}>
                    删除
                  </button>
                </>
              )}
            </span>
          </div>
          {mineW.length > 0 && (
            <>
              <button className="mx-fold" onClick={() => setClosedGroups((g) => ({ ...g, mineW: !g.mineW }))}>
                我拆过的（{mineW.length}） {closedGroups.mineW ? '▾' : '▴'}
              </button>
              {!closedGroups.mineW && (
                <>
                  <div className="mx-nodes">
                    {shownMineW.map((x) => {
                      const i = e.lookupWord(x)
                      return <Node key={x} w={x} z={i?.z} p={i?.p} kind="lit" />
                    })}
                  </div>
                  {mineW.length > 6 && (
                    <button className="btn alt sm" style={{ justifySelf: 'start' }} onClick={() => setShowAllMine((v) => !v)}>
                      {showAllMine ? '收起' : `展开全部 (${mineW.length})`}
                    </button>
                  )}
                </>
              )}
            </>
          )}
          {(
            [
              ['常见同根词', fam.filter((f) => !f.ext)],
              ['引申', fam.filter((f) => f.ext)],
            ] as const
          ).map(([title, list]) => {
            if (!list.length) return null
            const closed = !!closedGroups[title]
            return (
              <div key={title} style={{ display: 'grid', gap: 6 }}>
                <button className="mx-fold" onClick={() => setClosedGroups((g) => ({ ...g, [title]: !g[title] }))}>
                  {title}（{list.length}） {closed ? '▾' : '▴'}
                </button>
                {!closed && (
                  <div className="mx-nodes">
                    {list.slice(0, 5).map((f) => (
                      <Node key={f.w} w={f.w} z={f.z} p={f.p} kind="ref" />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </>
    )
  }

  return (
    <>
      <div className="vh">
        <h2>构词</h2>
        <div className="mx-search">
          <input
            id="mx-inp"
            placeholder="输入单词拆解"
            autoComplete="off"
            spellCheck={false}
            value={q}
            onChange={(ev) => setQ(ev.target.value)}
            onKeyDown={(ev) => ev.key === 'Enter' && morphSplit(q)}
          />
          <button className="btn sm" id="mx-go" onClick={() => morphSplit(q)}>
            拆词
          </button>
        </div>
      </div>
      <div className="mx-wrap">
        <aside className="mx-shelf" id="mx-shelf" aria-label="词素收集架">
          <input
            type="search"
            placeholder="筛选词素或已拆词"
            autoComplete="off"
            spellCheck={false}
            value={shelfQ}
            onChange={(ev) => setShelfQ(ev.target.value)}
            style={{ width: '100%', padding: '6px 10px', borderRadius: 'var(--rad-sm)', border: 'var(--bdr) solid var(--line)', background: 'var(--sheet)', font: '600 12.5px var(--ui)', color: 'var(--ink)' }}
          />
          <div className="seg" id="mx-cat" role="group">
            {(
              [
                ['all', '全部'],
                ['pre', '前缀'],
                ['root', '词根/词基'],
                ['suf', '后缀'],
                ['words', `已拆词${e.myWords().length ? ` ${e.myWords().length}` : ''}`],
              ] as const
            ).map(([c, lb]) => (
              <button key={c} className={mcat === c ? 'on' : ''} onClick={() => setMcat(c)}>
                {lb}
              </button>
            ))}
          </div>
          {mcat === 'words' ? (
            <>
              <button className="mx-fold" onClick={() => setClosedGroups((g) => ({ ...g, myWords: !g.myWords }))}>
                已拆过的词（{myWords.length}） {closedGroups.myWords ? '▾' : '▴'}
              </button>
              {!closedGroups.myWords && wordList(sq ? '没有匹配的已拆词' : '拆一个词开始')}
            </>
          ) : (
            <>
              <button className="mx-fold" onClick={() => setShowMine((v) => !v)}>
                我的词素（{mine.length}） {showMine ? '▴' : '▾'}
              </button>
              {showMine && <div className="mx-grid">{mine.length ? mine.map(Card) : <div className="small mut">{sq ? '没有匹配的词素' : '拆一个词开始'}</div>}</div>}
              {sq && myWords.length > 0 && (
                <>
                  <div className="mx-sec">已拆词（{myWords.length}）</div>
                  {wordList('')}
                </>
              )}
              <button className="mx-fold" onClick={() => ui.set({ showSeed: !ui.showSeed })}>
                常用词素参考（{seed.length}） {ui.showSeed || sq ? '▴' : '▾'}
              </button>
              {(ui.showSeed || !!sq) && <div className="mx-grid">{seed.length ? seed.map(Card) : <div className="small mut">没有更多参考词素</div>}</div>}
            </>
          )}
        </aside>
        <div className="mx-desk" id="mx-desk">
          {wordCard}
          {browse}
        </div>
      </div>
    </>
  )
}
