import { useState } from 'react'
import { accOf } from '../learn/phrase'
import { useApp, useDueCount } from '../app/store'
import { diffDays, today } from '../core/date'
import { lemmatize } from '../lang/lemmatize'
import { childrenOf, isAttachedPhrase, mosaicSlotsOf, pieceGloss, piecesOfLemma, rootIds, shortEnGloss, siblingGroupOf } from '../learn/pieces'
import { dueCard } from '../learn/engine'
import { Label, Piece, STAGE_NAMES, useFlip } from '../pieces/Piece'
import { BK, components, islandName } from './logic'

type GroupBy = 'stage' | 'goal' | 'due' | 'pos' | 'island' | 'doc'

interface Group {
  key: string
  title: string
  color: string
  items: string[]
}

export function Organizer({ ids }: { ids: string[] }) {
  const d = useApp((x) => x.data)
  const boardSel = useApp((x) => x.boardSel)
  const due = useDueCount()
  const flipAll = useFlip((x) => x.all)
  const flippedMap = useFlip((x) => x.flipped)
  const allWave = useFlip((x) => x.wave)
  const defLang = d.prefs.defLang || 'en'
  const [by, setBy] = useState<GroupBy>('stage')
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const needle = q.trim().toLowerCase()
  const filtered = ids.filter((id) => {
    if (!needle) return true
    const group = siblingGroupOf(d, id)
    const hay = group
      .flatMap((sid) => {
        const sp = d.pieces[sid]
        return [sp?.lemma, sp?.tile, sp?.en, sp?.ai?.zh, sp?.ai?.en, sp?.s, ...childrenOf(d, sid).map((c) => `${d.pieces[c]?.lemma} ${d.pieces[c]?.tile}`)]
      })
      .join(' ')
      .toLowerCase()
    return hay.includes(needle)
  })
  const stage = (id: string) => d.learn[id].stage
  const dueNow = (id: string) => !!dueCard(d.learn[id], today())
  const groups: Group[] = []
  const add = (key: string, title: string, color: string, items: string[]) => items.length && groups.push({ key, title, color, items })
  if (by === 'stage') {
    const colors = ['', 'var(--mut)', 'var(--s3)', 'var(--s2)', 'var(--s4)', 'var(--gold-d)']
    for (let st = 1; st <= 5; st++) add(`st_${st}`, `阶段 ${st} · ${STAGE_NAMES[st]}`, colors[st], filtered.filter((id) => stage(id) === st))
  } else if (by === 'goal') {
    add('g_use', '会用', 'var(--s4)', filtered.filter((id) => d.learn[id].goal === 'use'))
    add('g_read', '读懂', 'var(--s2)', filtered.filter((id) => d.learn[id].goal === 'read'))
    add('g_stash', '暂存', 'var(--mut)', filtered.filter((id) => d.learn[id].goal === 'stash'))
  } else if (by === 'due') {
    const t = today()
    const live = filtered.filter((id) => d.learn[id].goal !== 'stash')
    const dueDay = (id: string) => {
      const r = d.learn[id]
      const f = r.goal === 'use' && r.form ? r.form.due : null
      return f && f < r.sched.due ? f : r.sched.due
    }
    add('due_now', '今日到期 · 待锻造', 'var(--s5)', live.filter(dueNow))
    add('due_soon', '3 天内到期', 'var(--s1-d)', live.filter((id) => !dueNow(id) && diffDays(dueDay(id), t) <= 3))
    add('due_later', '3 天后到期', 'var(--s2)', live.filter((id) => !dueNow(id) && diffDays(dueDay(id), t) > 3))
  } else if (by === 'pos') {
    ;(
      [
        ['v.', '动词 v.', 'var(--s2)'],
        ['n.', '名词 n.', 'var(--s5)'],
        ['adj.', '形容词 adj.', 'var(--s1-d)'],
        ['adv.', '副词 adv.', 'var(--s3)'],
      ] as const
    ).forEach(([p, title, color]) => add(`pos_${p}`, title, color, filtered.filter((id) => (d.pieces[id]?.pos || 'v.') === p)))
    add('pos_ph', '关联短语的核心词', 'var(--s4)', filtered.filter((id) => childrenOf(d, id).length > 0))
  } else if (by === 'island') {
    const linked = new Set(d.board.links.flat())
    components(d)
      .filter((c) => c.length > 1)
      .forEach((c) => add(`isl_${c[0]}`, `${islandName(d, c)}（已咬合）`, 'var(--s2)', c.filter((id) => filtered.includes(id))))
    add('isl_loose', '未咬合孤块', 'var(--mut)', filtered.filter((id) => !linked.has(id)))
  } else {
    const byDoc: Record<string, string[]> = {}
    filtered.forEach((id) => {
      const name = d.learn[id].occ[0]?.doc || d.pieces[id]?.src || '其他语料'
      ;(byDoc[name] = byDoc[name] || []).push(id)
    })
    Object.entries(byDoc).forEach(([name, items], i) => add(`doc_${i}`, `来源：${name}`, 'var(--acc)', items))
  }
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed[g.key])
  const phrases = Object.keys(d.learn).filter((id) => isAttachedPhrase(d, id)).length
  const gold = Object.keys(d.learn).filter((id) => stage(id) === 5).length
  const barColors = ['var(--mut)', 'var(--s3)', 'var(--s2)', 'var(--s4)', 'var(--gold)']

  return (
    <div className="organizer" id="organizer" style={{ display: 'flex' }}>
      <div className="org-toolbar">
        <input type="text" className="org-search" placeholder="搜索单词、释义、短语或原句…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg" id="org-gby" role="group" aria-label="分组方式">
          {(
            [
              ['stage', '按阶段'],
              ['goal', '按目标'],
              ['due', '按到期'],
              ['pos', '按词性'],
              ['island', '按岛屿'],
              ['doc', '按文章'],
            ] as [GroupBy, string][]
          ).map(([g, lb]) => (
            <button key={g} className={by === g ? 'on' : ''} onClick={() => setBy(g)}>
              {lb}
            </button>
          ))}
        </div>
        <div className="org-summary">
          <span>
            核心词 <b>{rootIds(d).length}</b>
          </span>
          ·
          <span>
            挂靠短语 <b>{phrases}</b>
          </span>
          ·
          <span>
            待锻 <b>{due}</b>
          </span>
          ·
          <span>
            运用 <b>{gold}</b>
          </span>
          <button
            className="btn alt sm"
            style={{ padding: '3px 9px', fontSize: 11.5 }}
            onClick={() => setCollapsed(Object.fromEntries(groups.map((g) => [g.key, !allCollapsed])))}
          >
            {allCollapsed ? '全部展开' : '全部折叠'}
          </button>
        </div>
      </div>
      <div className="org-groups" id="org-groups">
        {groups.length ? (
          groups.map((g) => {
            const counts = [1, 2, 3, 4, 5].map((s) => g.items.filter((i) => stage(i) === s).length)
            return (
              <section key={g.key} className={`org-group${collapsed[g.key] ? ' collapsed' : ''}`}>
                <button className="org-ghd" onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}>
                  <span className="org-gdot" style={{ ['--gc' as string]: g.color }} />
                  <span>{g.title}</span>
                  <span className="org-gcnt">{g.items.length} 块</span>
                  <span className="org-gbar" title="阶段分布">
                    {counts.map((n, i) => (n ? <i key={i} style={{ flex: n, background: barColors[i] }} /> : null))}
                  </span>
                  <span className="org-gcar">▾</span>
                </button>
                <div className="org-gbody">
                  {g.items.map((id, idx) => {
                    const p = d.pieces[id]
                    const group = siblingGroupOf(d, id)
                    const chs = group.flatMap((sid) => childrenOf(d, sid))
                    const flipped = flipAll !== !!flippedMap[id]
                    const slots = mosaicSlotsOf(d, id, defLang, boardSel || undefined)
                    const sibs = piecesOfLemma(d, lemmatize(p?.lemma || id))
                    const senseNum = !slots.length && sibs.length > 1 ? sibs.indexOf(id) + 1 : 0
                    const active = boardSel != null && (group.includes(boardSel) || chs.includes(boardSel))
                    const due = group.some((sid) => dueNow(sid) && stage(sid) < 5)
                    const sub = flipped
                      ? defLang === 'en'
                        ? p?.tile || pieceGloss(p)
                        : shortEnGloss(p)
                      : defLang === 'en'
                        ? undefined
                        : p?.tile || pieceGloss(p)
                    return (
                      <button
                        key={id}
                        className={`org-tile${active ? ' active' : ''}${due ? ' due' : ''}`}
                        title={`${p?.lemma} · ${STAGE_NAMES[stage(id)]}`}
                        onClick={(ev) => {
                          const slotId = (ev.target as Element).closest<HTMLElement>('[data-slot-id]')?.dataset.slotId
                          useApp.setState({ boardSel: slotId || id })
                        }}
                        onDoubleClick={() => useFlip.getState().toggle([id])}
                      >
                        <Piece
                          sides={[-1, 1, 1, -1]}
                          k={BK}
                          st={stage(id)}
                          pos={p?.pos}
                          slots={slots}
                          acc={accOf(d, group)}
                          className={flipped ? 'flipped' : ''}
                          flipDelay={allWave ? Math.min(idx, 14) * 35 : 0}
                          lb={
                            <>
                              <Label word={p?.lemma || id} sub={sub} fixedGrid back={flipped} slots={slots} />
                              {senseNum > 0 && (
                                <span className="sense-dot" title={`义项 ${senseNum}`}>
                                  {senseNum}
                                </span>
                              )}
                            </>
                          }
                        />
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })
        ) : (
          <div className="card" style={{ textAlign: 'center', color: 'var(--mut)', padding: 28 }}>
            没有匹配的拼块
          </div>
        )}
      </div>
    </div>
  )
}
