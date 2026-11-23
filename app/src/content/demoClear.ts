import type { Day } from '../core/date'
import type { AppState } from '../core/types'
import { childrenOf, removePiece } from '../learn/pieces'
import { DEMO_DOCS } from './demo'
import { deleteVault, demoOn, docsInVault, paraIdsOf, purgeMarks, renameVault, type DocFlags } from './docs'
import { seedDemo } from './seed'

const DEMO_VAULTS = ['媒体研究仓库', '语言学习仓库']

const demoPids = () => new Set(DEMO_DOCS.flatMap((d) => [...paraIdsOf(d)]))

function demoPieceIds(d: AppState, day: Day): string[] {
  const recorded = d.extra.demoSeedIds
  const seedLearn = seedDemo(day).learn
  const seeded = new Set(Array.isArray(recorded) ? recorded : Object.keys(seedLearn))
  const pids = demoPids()
  return Object.keys(d.learn).filter((id) => {
    const r = d.learn[id]
    const occ = r.occ
    const fromDemo = (o: (typeof occ)[number]) => (o.pid ? pids.has(o.pid) : seeded.has(id))
    const seedReps = seedLearn[id]?.sched.reps ?? 0
    const hasReview = r.sched.reps > seedReps || !!r.sched.intro || (r.form?.reps ?? 0) > 0
    return !hasReview && (seeded.has(id) || occ.some((o) => o.pid && pids.has(o.pid))) && occ.every(fromDemo)
  })
}

export function demoSummary(d: AppState, day: Day) {
  if (!demoOn(d)) return { docs: 0, pieces: 0 }
  const ids = new Set((d.docState as { id: string; hidden?: boolean }[]).filter((x) => x.hidden).map((x) => x.id))
  return { docs: DEMO_DOCS.filter((x) => !ids.has(x.id)).length, pieces: demoPieceIds(d, day).length }
}

export function clearDemo(d: AppState, day: Day): AppState {
  const demoIds = new Set(DEMO_DOCS.map((x) => x.id))
  let next = d
  const ids = new Set(demoPieceIds(d, day))
  for (const id of ids) {
    if (next.learn[id] && childrenOf(next, id).every((child) => ids.has(child))) next = removePiece(next, id)
  }
  const morph = next.morph as { words?: Record<string, { ctx?: { docId?: string }[] }> } | null
  if (morph?.words) {
    const words = Object.fromEntries(Object.entries(morph.words).filter(([, w]) => !(w.ctx?.length && w.ctx.every((c) => c.docId && demoIds.has(c.docId)))))
    next = { ...next, morph: { ...morph, words } }
  }
  next = {
    ...next,
    marks: purgeMarks(next.marks, demoPids()),
    docState: (next.docState as { id: string }[]).filter((x) => !demoIds.has(x.id)),
    extra: { ...next.extra, noDemo: true, demoAsked: true, demoSeedIds: [] },
  }
  for (let i = next.vaults.length - 1; i >= 0; i--) {
    if (next.vaults.length > 1 && DEMO_VAULTS.includes(next.vaults[i].name) && !docsInVault(next, i).length) next = deleteVault(next, i, null)
  }
  if (next.vaults.length === 1 && DEMO_VAULTS.includes(next.vaults[0].name) && !docsInVault(next, 0).length) next = renameVault(next, 0, '我的仓库')
  return { ...next, curVault: Math.min(next.curVault, next.vaults.length - 1) }
}

export function restoreDemo(d: AppState, day: Day): AppState {
  const seed = seedDemo(day)
  const vaults = [...d.vaults]
  const indices = DEMO_VAULTS.map((name) => {
    const index = vaults.findIndex((vault) => vault.name === name)
    if (index >= 0) return index
    vaults.push({ name })
    return vaults.length - 1
  })
  const demoIds = new Set(DEMO_DOCS.map((doc) => doc.id))
  const demoFlags = new Map((seed.docState as DocFlags[]).map((flags) => [flags.id, flags]))
  const previous = Array.isArray(d.extra.demoSeedIds) ? d.extra.demoSeedIds : demoOn(d) ? demoPieceIds(d, day) : []
  const ids = new Set(Object.keys(seed.learn).filter((id) => !d.pieces[id] && !d.learn[id]))
  for (const id of ids) {
    const parent = seed.pieces[id].parentId
    if (parent && !ids.has(parent) && !previous.includes(parent)) ids.delete(id)
  }
  const pick = <T>(obj: Record<string, T>) => Object.fromEntries(Object.entries(obj).filter(([id]) => ids.has(id)))
  return {
    ...d,
    vaults,
    docState: [
      ...(d.docState as DocFlags[]).filter((flags) => !demoIds.has(flags.id)),
      ...DEMO_DOCS.map((doc) => ({ ...demoFlags.get(doc.id), id: doc.id, vault: indices[doc.vault] ?? 0 })),
    ],
    pieces: { ...pick(seed.pieces), ...d.pieces },
    learn: { ...pick(seed.learn), ...d.learn },
    board: {
      ...d.board,
      pos: { ...pick(seed.board.pos), ...d.board.pos },
      links: [...d.board.links, ...seed.board.links.filter(([a, b]) => ids.has(a) && ids.has(b))],
    },
    morph: d.morph ?? seed.morph,
    extra: { ...d.extra, noDemo: false, demoAsked: d.docs.length > 0 || d.extra.demoAsked, demoSeedIds: [...new Set([...previous, ...ids])] },
  }
}
