import { create } from 'zustand'
import { useApp } from '../app/store'
import { allDocs, setDocFlags } from '../content/docs'
import type { DocData } from '../core/types'
import { useReader } from '../reader/session'
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

export const SKIP_UNIT = /^(cover|front ?matter|half title|title page|copyright|dedication|(table of )?contents?|list of (figures|tables|illustrations)|in this issue|references|bibliography|notes|endnotes|index|acknowledge?ments?|about the authors?|about this e-?book|also by|a note on the type|colophon)\b/i

export async function startPdfImport(f: File) {
  usePdf.getState().set({ busy: `正在解析 ${f.name}…` })
  try {
    const buf = await f.arrayBuffer()
    const parsed = await parsePdf(buf, f.name)
    if (parsed.scanned) {
      usePdf.getState().set({ busy: '' })
      return app().say('这是扫描版 PDF，暂不支持')
    }
    if (parsed.units.length === 1) {
      usePdf.getState().set({ busy: '' })
      return commitImport(parsed, new Set([0]))
    }
    openPick({
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
}

function addDocs(title: string, picked: Set<number>, make: (i: number, vault: number, id: string) => DocData) {
  const stamp = Date.now().toString(36)
  const multi = picked.size > 1
  const d0 = app().data
  const vault = multi ? d0.vaults.length : d0.curVault
  const docs = [...picked].sort((a, b) => a - b).map((i, k) => make(i, vault, `p${stamp}${k}`))
  app().update((d) => ({
    ...d,
    vaults: multi ? [...d.vaults, { name: title.slice(0, 40) }] : d.vaults,
    curVault: vault,
    docs: [...d.docs, ...(docs as unknown as typeof d.docs)],
  }))
  useReader.getState().set({ cur: docs[0]?.id ?? null, sel: null, po: false, ctx: false })
  usePdf.getState().set({ pick: null })
  app().say(multi ? `已导入 ${docs.length} 篇` : docs[0]?.title || '')
}

function commitImport(parsed: ParsedPdf, picked: Set<number>) {
  addDocs(parsed.title, picked, (i, vault, id) => buildDoc(parsed, parsed.units[i], vault, id))
}

export async function startEpubImport(f: File) {
  usePdf.getState().set({ busy: `正在解析 ${f.name}…` })
  let parsed: ParsedEpub
  try {
    parsed = await parseEpub(await f.arrayBuffer(), f.name)
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
  openPick({ title: parsed.title, units: parsed.units.map((u) => ({ title: u.title, section: u.section, meta: '', words: u.words })), commit })
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

const failedPages = (doc: DocData) => [...new Set((doc.parasAI || []).filter((p) => p.fb && p.pg).map((p) => p.pg as number))]

const rebuildPlanInfo = (doc: DocData, pages?: number[]) => {
  const chunks = rebuildPlan(doc, pages)
  return planOf(
    chunks.map((chunk) => rebuildRequestText(doc, chunk)),
    PROMPT,
    1.1,
    chunks.map((chunk) => chunk.pages.length),
  )
}

export function requestRebuild(doc: DocData, curPdfPage?: number) {
  if (usePdf.getState().running?.docId === doc.id) return
  if (doc.parasAI && !(doc.rebuilt && doc.aiFailed)) {
    app().update((d) => setDocFlags(d, doc.id, { rebuilt: true }))
    return
  }
  if (!requireKey()) return
  const full = rebuildPlanInfo(doc)
  if (!doc.parasAI && curPdfPage != null && rebuildPlan(doc, [curPdfPage]).length > 0 && full.calls > 1) {
    const single = rebuildPlanInfo(doc, [curPdfPage])
    const scopes: ScopeOption[] = [
      { label: '整篇文档', plan: full, onOk: (fit) => void runRebuild(doc.id, fit) },
      { label: `仅当前 PDF 页（p.${curPdfPage}）`, plan: single, onOk: (fit) => void runRebuild(doc.id, fit, [curPdfPage]) },
    ]
    return confirmAI({ title: 'AI 重排', sub: doc.title, ...scopes[0].plan, onOk: scopes[0].onOk, scopes })
  }
  const fail = doc.parasAI ? failedPages(doc) : []
  if (fail.length) {
    const retryPlan = rebuildPlanInfo(doc, fail)
    const scopes: ScopeOption[] = [
      { label: '仅重试失败页', plan: retryPlan, onOk: (fit) => void runRebuild(doc.id, fit, fail) },
      { label: '整篇文档', plan: full, onOk: (fit) => void runRebuild(doc.id, fit) },
    ]
    return confirmAI({ title: 'AI 重排', sub: doc.title, ...scopes[0].plan, onOk: scopes[0].onOk, scopes })
  }
  confirmAI({ title: 'AI 重排', sub: doc.title, ...full, onOk: (fit) => void runRebuild(doc.id, fit) })
}

async function runRebuild(docId: string, limit: number, retryPages?: number[]) {
  const d = app().data
  const doc = (d.docs as unknown as DocData[]).find((x) => x.id === docId)
  if (!doc || usePdf.getState().running) return
  const base = retryPages ? doc.parasAI || (doc.parasRule || doc.paras).map((p) => (p.pg ? { ...p, fb: true } : p)) : undefined
  usePdf.getState().set({ running: { docId, done: 0, total: limit } })
  try {
    const { paras, summary } = await rebuildDoc(doc, {
      retryPages,
      limit,
      base,
      ai: app().ai,
      call: aiDeps(),
      onProgress: (done, total) => usePdf.getState().set({ running: { docId, done, total } }),
    })
    app().update((x) =>
      setDocFlags(
        { ...x, docs: x.docs.map((y) => (y.id === docId ? { ...y, parasAI: paras, aiFailed: failedPages({ ...doc, parasAI: paras }).length } : y)) },
        docId,
        doc.parasAI || retryPages ? { rebuilt: true, cachedRebuilt: true } : { rebuilt: true, cachedRebuilt: true, page: 0 },
      ),
    )
    const parts = ['AI 重排完成']
    if (summary.abstract) parts.push(`找回摘要 ${summary.abstract} 处`)
    if (summary.removed) parts.push(`剔除 ${summary.removed} 处`)
    if (summary.cites) parts.push(`标出引文 ${summary.cites} 处`)
    if (summary.unverified) parts.push(`${summary.unverified} 段退回规则版`)
    if (summary.failedChunks) parts.push(`${summary.failedChunks} 页保留规则版`)
    const again = summary.failedChunks
      ? () => {
          const nd = allDocs(app().data).find((x) => x.id === docId)
          if (nd) requestRebuild(nd)
        }
      : undefined
    app().say(parts.join(' · '), again, again ? '重试' : undefined)
  } catch (e) {
    app().say(aiErr(e, '离线释义 · AI 暂不可用'))
  }
  usePdf.getState().set({ running: null })
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
