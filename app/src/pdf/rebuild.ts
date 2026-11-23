import { callLong, type CallDeps } from '../ai/client'
import { AIError, type AIConfig } from '../ai/types'
import type { DocData, Para, ParaKind } from '../core/types'
import { faithful, PROMPT, words } from './extract'

export interface RebuildBlock {
  type: string
  text: string
  cont?: boolean
}

export interface RebuildSummary {
  calls: number
  removed: number
  cites: number
  abstract: number
  unverified: number
  failedChunks: number
}

const KIND: Record<string, ParaKind> = { para: 'para', list: 'list', standfirst: 'standfirst', abstract: 'abstract', caption: 'caption', equation: 'equation', backmatter: 'back' }

export function mergeCont(blocks: RebuildBlock[]): RebuildBlock[] {
  const out: RebuildBlock[] = []
  for (const b of blocks) {
    const prev = [...out].reverse().find((x) => x.type !== 'skip' && x.type !== 'caption')
    if (b.cont && prev && ['para', 'list'].includes(prev.type) && ['para', 'list'].includes(b.type)) {
      prev.text = /[­-]$/.test(prev.text) ? prev.text.replace(/[­-]$/, '') + b.text : `${prev.text} ${b.text}`
      continue
    }
    out.push({ ...b })
  }
  return out
}

const pageText = (text: string, pg: number) => text.split(`--- PAGE ${pg} ---\n`)[1]?.split('\n--- PAGE')[0] || ''

const chunkLines = (text: string) => text.split('\n').filter((l) => /^B\d+\|/.test(l)).map((l) => l.split('|').slice(2).join('|').replace(/^¶ /, ''))

export function rebuildRequestText(doc: DocData, chunk: Chunk) {
  const rule = doc.parasRule || doc.paras
  const prev = rule.findLast((p) => p.t && p.pg != null && p.pg < chunk.pages[0])?.t || ''
  return `PREVIOUS PARAGRAPH:\n${prev.slice(-600)}\n\n${chunk.text}`
}

function bestRule(rule: Para[], text: string) {
  const w = new Set(words(text))
  let best: Para | null = null
  let score = 0
  for (const r of rule) {
    if (!r.t) continue
    const rw = words(r.t)
    const hit = rw.filter((x) => w.has(x)).length / Math.max(1, rw.length)
    if (hit > score) {
      score = hit
      best = r
    }
  }
  return score > 0.5 ? best : null
}

export interface RebuildDeps {
  ai: AIConfig
  call: CallDeps
  onProgress?: (done: number, total: number) => void
  retryPages?: number[]
  base?: Para[]
  concurrency?: number
  limit?: number
}

export async function rebuildDoc(doc: DocData, deps: RebuildDeps): Promise<{ paras: Para[]; summary: RebuildSummary }> {
  const rule = doc.parasRule || doc.paras
  const summary: RebuildSummary = { calls: 0, removed: 0, cites: 0, abstract: 0, unverified: 0, failedChunks: 0 }
  let out: Para[] = []
  let lastPara = ''
  let n = 0
  const ask = (chunk: Chunk) =>
    callLong(
      deps.ai,
      PROMPT,
      rebuildRequestText(doc, chunk),
      deps.call,
      (res) => (Array.isArray(res.blocks) ? (res.blocks as RebuildBlock[]) : null),
      () => summary.calls++,
    )
  const fallback = (pages: number[]) => {
    summary.failedChunks += pages.length
    const set = new Set(pages)
    for (const r of rule) if (r.pg && set.has(r.pg)) out.push(r.h ? { h: r.h, pg: r.pg, fb: true } : { ...r, id: `${doc.id}-A${++n}`, fb: true })
  }
  const emit = (blocks: RebuildBlock[], ch: { pages: number[]; text: string }) => {
    const lines = chunkLines(ch.text)
    const hay = words(`${lastPara} ${lines.join(' ')}`)
    for (const b of mergeCont(blocks)) {
      const text = String(b.text || '').trim()
      if (b.type === 'skip') {
        summary.removed++
        continue
      }
      if (b.type === 'title' || !text) continue
      if (b.type === 'heading') {
        out.push({ h: text, pg: ch.pages[0] })
        continue
      }
      const kind = KIND[b.type] || 'para'
      let t = text
      if (!['equation', 'caption'].includes(kind) && !faithful(text.replace(/[⟦⟧]/g, ''), hay)) {
        summary.unverified++
        const r = bestRule(rule, text)
        if (!r?.t) continue
        t = r.t
      }
      summary.cites += (t.match(/⟦/g) || []).length
      if (kind === 'abstract') summary.abstract++
      const first = words(t).slice(0, 3).join(' ')
      const pi = ch.pages.find((pg, i) => words(chunkLines(pageText(ch.text, pg)).join(' ')).join(' ').includes(first) || i === ch.pages.length - 1)
      const last = out[out.length - 1]
      if (b.cont && last && last.t && ['para', 'list'].includes(last.kind || 'para') && kind === 'para') {
        last.t = `${last.t} ${t}`
      } else out.push({ id: `${doc.id}-A${++n}`, pg: pi || ch.pages[0], raw: '', t, kind })
      if (['para', 'list', 'abstract'].includes(kind)) lastPara = t
    }
  }
  const fetchAll = async (list: Chunk[]) => {
    let done = 0
    deps.onProgress?.(0, list.length)
    return pool(list, Math.min(REBUILD_POOL, Math.max(1, deps.concurrency ?? REBUILD_POOL)), async (ch) => {
      const r = await ask(ch).catch((err: unknown) => {
        if (err instanceof AIError && err.code === 'quota') return null
        throw err
      })
      deps.onProgress?.(++done, list.length)
      return r
    })
  }
  if (deps.retryPages && deps.base) {
    let base = deps.base
    n = Math.max(0, ...base.map((p) => Number(/-A(\d+)$/.exec(p.id || '')?.[1] || 0)))
    const subs = rebuildPlan(doc, deps.retryPages).slice(0, deps.limit)
    const results = await fetchAll(subs)
    subs.forEach((sub, i) => {
      const pg = sub.pages[0]
      const from = base.findIndex((p) => p.fb && p.pg === pg)
      if (from < 0) return
      let to = from
      while (to < base.length && base[to].fb && base[to].pg === pg) to++
      lastPara = [...base.slice(0, from)].reverse().find((p) => p.t && !p.kind?.match(/caption|equation|back/))?.t || ''
      out = []
      const b = results[i]
      if (b) emit(b, sub)
      else fallback([pg])
      base = [...base.slice(0, from), ...out, ...base.slice(to)]
    })
    return { paras: base, summary }
  }
  const plan = rebuildPlan(doc)
  const pcs = plan.slice(0, deps.limit)
  const results = await fetchAll(pcs)
  const split = pcs.flatMap((ch, i) => (results[i] || ch.pages.length < 2 ? [] : ch.pages.map((pg) => onePage(ch, pg))))
  const again = split.length ? await fetchAll(split) : []
  pcs.forEach((ch, i) => {
    const b = results[i]
    if (b) return emit(b, ch)
    if (ch.pages.length < 2) return fallback(ch.pages)
    for (const pg of ch.pages) {
      const k = split.findIndex((x) => x.pages[0] === pg)
      if (again[k]) emit(again[k] as RebuildBlock[], split[k])
      else fallback([pg])
    }
  })
  plan.slice(pcs.length).forEach((ch) => fallback(ch.pages))
  return { paras: out, summary }
}

type Chunk = { pages: number[]; text: string }

export const REBUILD_POOL = 3

const onePage = (ch: Chunk, pg: number): Chunk => ({ pages: [pg], text: `--- PAGE ${pg} ---\n${pageText(ch.text, pg)}` })

export function rebuildPlan(doc: DocData, retryPages?: number[]): Chunk[] {
  const chunks = doc.aiChunks || []
  if (!retryPages) return pageChunks(chunks)
  return retryPages.flatMap((pg) => {
    const ch = chunks.find((c) => c.pages.includes(pg))
    return ch ? [onePage(ch, pg)] : []
  })
}
const SMALL_PAGE = 50

export function pageChunks(chunks: Chunk[]): Chunk[] {
  const out: (Chunk & { n: number })[] = []
  for (const ch of chunks)
    for (const pg of ch.pages) {
      const body = pageText(ch.text, pg)
      const lines = chunkLines(body).length
      const last = out[out.length - 1]
      if (last && last.n + lines <= SMALL_PAGE) {
        last.pages.push(pg)
        last.text += `\n--- PAGE ${pg} ---\n${body}`
        last.n += lines
      } else out.push({ pages: [pg], text: `--- PAGE ${pg} ---\n${body}`, n: lines })
    }
  return out.map(({ pages, text }) => ({ pages, text }))
}

export async function pool<T, R>(items: T[], size: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
  return out
}
