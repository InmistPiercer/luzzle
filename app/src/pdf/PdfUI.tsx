import { create } from 'zustand'
import { useApp } from '../app/store'
import { allDocs, setDocFlags } from '../content/docs'
import type { DocData } from '../core/types'
import { useReader } from '../reader/session'
import { paginate } from '../reader/paginate'
import { buildDoc, parsePdf, type ParsedPdf } from './importPdf'
import { PROMPT } from './extract'
import { rebuildDoc, rebuildPlan, rebuildRequestText } from './rebuild'
import { aiDeps, aiErr, requireKey } from '../ai/ask'
import { confirmAI, planOf, type ScopeOption } from '../ai/Confirm'
import { buildEpubDoc, parseEpub, type ParsedEpub } from '../epub/importEpub'

interface PickUnit {
  title: string
  section: string
  meta: string
  words: number
}

interface Pick {
  title: string
  units: PickUnit[]
  commit: (picked: Set<number>) => void
}

interface PdfState {
  busy: string
  pick: Pick | null
  picked: Set<number>
  running: { docId: string; done: number; total: number } | null
  set: (p: Partial<PdfState>) => void
}

export const usePdf = create<PdfState>((set) => ({ busy: '', pick: null, picked: new Set(), running: null, set: (p) => set(p) }))

const app = () => useApp.getState()
let rebuildRequest: AbortController | null = null

useApp.subscribe((state, previous) => {
  if (state.dataEpoch === previous.dataEpoch) return
  rebuildRequest?.abort()
  rebuildRequest = null
  usePdf.getState().set({ pick: null, running: null })
})

export const SKIP_UNIT = /^(cover|front ?matter|half title|title page|copyright|dedication|(table of )?contents?|list of (figures|tables|illustrations)|in this issue|references|bibliography|notes|endnotes|index|acknowledge?ments?|about the authors?|about this e-?book|also by|a note on the type|colophon)\b/i

export async function startPdfImport(f: File) {
  const epoch = app().dataEpoch
  usePdf.getState().set({ busy: `正在解析 ${f.name}…` })
  try {
    const buf = await f.arrayBuffer()
    const parsed = await parsePdf(buf, f.name)
    if (epoch !== app().dataEpoch) return usePdf.getState().set({ busy: '' })
    if (parsed.scanned) {
      usePdf.getState().set({ busy: '' })
      return app().say('这是扫描版 PDF，暂不支持')
    }
    if (parsed.units.length === 1) {
      usePdf.getState().set({ busy: '' })
      return commitImport(parsed, new Set([0]))
    }
    await openPick({
      title: parsed.title,
      units: parsed.units.map((u) => ({ title: u.title, section: u.section, meta: `p.${u.from.pi + 1}`, words: u.words })),
      commit: (picked) => commitImport(parsed, picked),
    })
  } catch {
    usePdf.getState().set({ busy: '' })
    app().say('无法读取这个 PDF')
  }
}

function openPick(p: Pick) {
  const picked = new Set(p.units.map((u, i) => (u.words >= 150 && !SKIP_UNIT.test(u.title.trim()) ? i : -1)).filter((i) => i >= 0))
  usePdf.getState().set({ busy: '', pick: p, picked })
  return new Promise<void>((resolve) => {
    const unsubscribe = usePdf.subscribe((state) => {
      if (state.pick === p) return
      unsubscribe()
      resolve()
    })
  })
}

let lastImportTime = 0

function addDocs(title: string, picked: Set<number>, make: (i: number, vault: number, id: string) => DocData) {
  lastImportTime = Math.max(Date.now(), lastImportTime + 1)
  const stamp = lastImportTime.toString(36)
  const multi = picked.size > 1
  const d0 = app().data
  const vault = multi ? d0.vaults.length : d0.curVault
  const docs = [...picked].sort((a, b) => a - b).map((i, k) => make(i, vault, `p${stamp}${k}`))
  app().update((d) => ({
    ...d,
    vaults: multi ? [...d.vaults, { name: title.slice(0, 40) }] : d.vaults,
    curVault: vault,
    docs: [...d.docs, ...docs.map((doc) => ({ ...doc }))],
  }))
  useReader.getState().set({ cur: docs[0]?.id ?? null, sel: null, po: false, ctx: false })
  usePdf.getState().set({ pick: null })
  app().say(multi ? `已导入 ${docs.length} 篇` : docs[0]?.title || '')
}

function commitImport(parsed: ParsedPdf, picked: Set<number>) {
  addDocs(parsed.title, picked, (i, vault, id) => buildDoc(parsed, parsed.units[i], vault, id))
}

export async function startEpubImport(f: File) {
  const epoch = app().dataEpoch
  usePdf.getState().set({ busy: `正在解析 ${f.name}…` })
  let parsed: ParsedEpub
  try {
    parsed = await parseEpub(await f.arrayBuffer(), f.name)
    if (epoch !== app().dataEpoch) return usePdf.getState().set({ busy: '' })
  } catch {
    usePdf.getState().set({ busy: '' })
    return app().say('无法读取这个 EPUB')
  }
  if (!parsed.units.length) {
    usePdf.getState().set({ busy: '' })
    return app().say('无法读取这个 EPUB')
  }
  const commit = (picked: Set<number>) => addDocs(parsed.title, picked, (i, vault, id) => buildEpubDoc(parsed.units[i], vault, id))
  if (parsed.units.length === 1) {
    usePdf.getState().set({ busy: '' })
    return commit(new Set([0]))
  }
  await openPick({ title: parsed.title, units: parsed.units.map((u) => ({ title: u.title, section: u.section, meta: '', words: u.words })), commit })
}

export function PdfPicker() {
  const { pick, picked, set } = usePdf()
  if (!pick) return null
  const toggle = (i: number) => {
    const n = new Set(picked)
    if (n.has(i)) n.delete(i)
    else n.add(i)
    set({ picked: n })
  }
  let lastSec = ''
  return (
    <div className="modal-bg open" onClick={(e) => e.target === e.currentTarget && set({ pick: null })}>
      <div className="modal" role="dialog" aria-label="选择文章" style={{ width: 'min(560px,92vw)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>{pick.title}</h3>
          <button className="x-btn" aria-label="关闭" onClick={() => set({ pick: null })}>
            ×
          </button>
        </div>
        <div className="pr" style={{ marginTop: 0 }}>
          <button className="btn alt sm" onClick={() => set({ picked: new Set(pick.units.map((_, i) => i)) })}>
            全选
          </button>
          <button className="btn alt sm" onClick={() => set({ picked: new Set() })}>
            全不选
          </button>
        </div>
        <div className="pdf-pick">
          {pick.units.map((u, i) => {
            const sec = u.section && u.section !== lastSec ? u.section : ''
            if (u.section) lastSec = u.section
            return (
              <div key={i}>
                {sec && <div className="sec">{sec}</div>}
                <label>
                  <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} />
                  <span>
                    {u.title.slice(0, 90)} <small>{u.meta ? `· ${u.meta} ` : ''}· {u.words} 词</small>
                  </span>
                </label>
              </div>
            )
          })}
        </div>
        <div className="pr" style={{ justifyContent: 'flex-end', marginTop: 0 }}>
          <button className="btn sm" disabled={!picked.size} onClick={() => pick.commit(picked)}>
            导入 {picked.size} 篇
          </button>
        </div>
      </div>
    </div>
  )
}

export const allPdfPagesOf = (doc: DocData): number[] =>
  [...new Set((doc.aiChunks || []).flatMap((c) => c.pages))].sort((a, b) => a - b)

export const pendingPdfPages = (doc: DocData): number[] => {
  const all = allPdfPagesOf(doc)
  if (!doc.parasAI) return all
  if (doc.aiDone) {
    const done = new Set(doc.aiDone)
    return all.filter((pg) => !done.has(pg))
  }
  return [...new Set(doc.parasAI.filter((p) => p.fb && p.pg != null).map((p) => p.pg as number))].sort((a, b) => a - b)
}

export const pageRangeLabel = (pages: number[]): string => {
  const u = [...new Set(pages)].sort((a, b) => a - b)
  if (!u.length) return ''
  if (u.length === 1) return `p.${u[0]}`
  const contiguous = u.every((p, i) => i === 0 || p === u[i - 1] + 1)
  return contiguous ? `p.${u[0]}–${u[u.length - 1]}` : `p.${u.join(', ')}`
}

const rebuildPlanInfo = (doc: DocData, pages?: number[]) => {
  const chunks = rebuildPlan(doc, pages)
  return planOf(
    chunks.map((chunk) => rebuildRequestText(doc, chunk)),
    PROMPT,
    1.1,
    chunks.map((chunk, i) => (chunks[i + 1]?.pages.length === 1 && chunk.pages.length === 1 && chunks[i + 1].pages[0] === chunk.pages[0] ? 0 : chunk.pages.length)),
  )
}

export function requestRebuild(doc: DocData, curPdfPages: number[] = [], forceDialog = false) {
  if (usePdf.getState().running?.docId === doc.id) return
  const allPgs = allPdfPagesOf(doc)
  const pending = pendingPdfPages(doc)
  const cur = [...new Set(curPdfPages)].filter((pg) => allPgs.includes(pg)).sort((a, b) => a - b)
  const curPending = cur.filter((pg) => pending.includes(pg))
  if (doc.parasAI && !forceDialog && curPending.length === 0) {
    app().update((d) => setDocFlags(d, doc.id, { rebuilt: true }))
    return
  }
  if (!requireKey()) return
  const full = rebuildPlanInfo(doc)
  if (!doc.parasAI) {
    if (cur.length > 0 && allPgs.length > cur.length) {
      const single = rebuildPlanInfo(doc, cur)
      if (single.calls > 0 && full.calls > single.calls) {
        const scopes: ScopeOption[] = [
          { label: `整篇文档（共 ${allPgs.length} 页）`, plan: full, onOk: (fit) => void runRebuild(doc.id, fit, undefined, cur) },
          { label: `仅当前页（${pageRangeLabel(cur)}）`, plan: single, onOk: (fit) => void runRebuild(doc.id, fit, cur, cur) },
        ]
        return confirmAI({ title: 'AI 重排', sub: doc.title, ...scopes[0].plan, onOk: scopes[0].onOk, scopes })
      }
    }
    return confirmAI({ title: 'AI 重排', sub: doc.title, ...full, onOk: (fit) => void runRebuild(doc.id, fit, undefined, cur) })
  }
  if (pending.length > 0) {
    const restPlan = rebuildPlanInfo(doc, pending)
    if (curPending.length > 0 && pending.length > curPending.length) {
      const curPlan = rebuildPlanInfo(doc, curPending)
      const scopes: ScopeOption[] = [
        { label: `仅当前页（${pageRangeLabel(curPending)}）`, plan: curPlan, onOk: (fit) => void runRebuild(doc.id, fit, curPending, curPending) },
        { label: `其余全部（${pending.length} 页）`, plan: restPlan, onOk: (fit) => void runRebuild(doc.id, fit, pending, curPending) },
      ]
      return confirmAI({ title: 'AI 重排', sub: doc.title, ...scopes[0].plan, onOk: scopes[0].onOk, scopes })
    }
    const scopes: ScopeOption[] = [
      { label: `重排其余 ${pending.length} 页`, plan: restPlan, onOk: (fit) => void runRebuild(doc.id, fit, pending, cur) },
      { label: `整篇重新重排（${allPgs.length} 页）`, plan: full, onOk: (fit) => void runRebuild(doc.id, fit, undefined, cur) },
    ]
    return confirmAI({ title: 'AI 重排', sub: doc.title, ...scopes[0].plan, onOk: scopes[0].onOk, scopes })
  }
  confirmAI({ title: 'AI 重排', sub: doc.title, ...full, onOk: (fit) => void runRebuild(doc.id, fit, undefined, cur) })
}

async function runRebuild(docId: string, limit: number, retryPages?: number[], priorityPages?: number[]) {
  const d = app().data
  const doc = (d.docs as unknown as DocData[]).find((x) => x.id === docId)
  if (!doc || usePdf.getState().running) return
  const controller = new AbortController()
  rebuildRequest = controller
  const allPgs = allPdfPagesOf(doc)
  const prevDone = retryPages
    ? doc.aiDone || (doc.parasAI ? allPgs.filter((pg) => !pendingPdfPages(doc).includes(pg)) : [])
    : []
  const base = retryPages ? doc.parasAI || (doc.parasRule || doc.paras).map((p) => (p.pg ? { ...p, fb: true } : p)) : undefined
  const commit = (paras: DocData['paras'], donePages: number[]) => {
    const mergedDone = [...new Set([...prevDone, ...donePages])].sort((a, b) => a - b)
    const remaining = allPgs.filter((pg) => !mergedDone.includes(pg)).length
    app().update((x) => {
      const curDoc = allDocs(x).find((y) => y.id === docId)
      const pageLen = x.prefs.pageLen || 'mid'
      const curIdx = Math.max(0, curDoc?.page || 0)
      const anchorPg = curDoc ? paginate(curDoc, pageLen)[curIdx]?.find((it) => it.p.pg != null)?.p.pg : undefined
      const nextDocs = x.docs.map((y) => (y.id === docId ? { ...y, parasAI: paras, aiDone: mergedDone, aiFailed: remaining } : y))
      let nextState = setDocFlags({ ...x, docs: nextDocs }, docId, { rebuilt: true, cachedRebuilt: true })
      if (anchorPg != null && curIdx > 0) {
        const updatedDoc = allDocs(nextState).find((y) => y.id === docId)
        if (updatedDoc) {
          const nextPages = paginate(updatedDoc, pageLen)
          const anchoredIdx = nextPages.findIndex((pg) => pg.some((it) => it.p.pg === anchorPg))
          if (anchoredIdx >= 0 && anchoredIdx !== curIdx) nextState = setDocFlags(nextState, docId, { page: anchoredIdx })
        }
      }
      return nextState
    })
    return remaining
  }
  usePdf.getState().set({ running: { docId, done: 0, total: limit } })
  try {
    const { paras, summary, donePages } = await rebuildDoc(doc, {
      retryPages,
      priorityPages,
      limit,
      base,
      ai: app().ai,
      call: aiDeps({ signal: controller.signal }),
      onProgress: (done, total) => {
        if (!controller.signal.aborted) usePdf.getState().set({ running: { docId, done, total } })
      },
      onUpdate: (partial, done) => {
        if (done.length && !controller.signal.aborted) commit(partial, done)
      },
    })
    if (controller.signal.aborted) return
    const remaining = commit(paras, donePages)
    const partialScope = !!retryPages && remaining > 0 && summary.failedChunks === 0
    const parts = [partialScope ? `已重排 ${pageRangeLabel(retryPages)}` : 'AI 重排完成']
    if (summary.abstract) parts.push(`找回摘要 ${summary.abstract} 处`)
    if (summary.removed) parts.push(`剔除 ${summary.removed} 处`)
    if (summary.cites) parts.push(`标出引文 ${summary.cites} 处`)
    if (summary.unverified) parts.push(`${summary.unverified} 段退回规则版`)
    if (summary.failedChunks) parts.push(`${summary.failedChunks} 页保留规则版`)
    else if (partialScope) parts.push(`其余 ${remaining} 页保留规则版`)
    const again =
      summary.failedChunks || partialScope
        ? () => {
            const nd = allDocs(app().data).find((x) => x.id === docId)
            if (nd) requestRebuild(nd, [], true)
          }
        : undefined
    app().say(parts.join(' · '), again, again ? (summary.failedChunks ? '重试' : '重排其余页') : undefined)
  } catch (e) {
    if (!controller.signal.aborted) app().say(aiErr(e, '离线释义 · AI 暂不可用'))
  } finally {
    if (rebuildRequest === controller) {
      rebuildRequest = null
      usePdf.getState().set({ running: null })
    }
  }
}

export function PdfBusy() {
  const busy = usePdf((x) => x.busy)
  if (!busy) return null
  return (
    <div className="modal-bg open">
      <div className="modal" style={{ width: 'min(360px,92vw)' }}>
        <div style={{ fontWeight: 700 }}>{busy}</div>
        <div className="progress">
          <i style={{ width: '60%' }} />
        </div>
      </div>
    </div>
  )
}
