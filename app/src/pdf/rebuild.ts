import { callLong, type CallDeps } from '../ai/client'
import { AIError, type AIConfig } from '../ai/types'
import type { DocData, Para, ParaKind } from '../core/types'
import { clean, faithful, joinHyphen, PROMPT, words } from './extract'

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

export interface Chunk {
  pages: number[]
  text: string
  prev?: string
}

const KIND: Record<string, ParaKind> = { para: 'para', list: 'list', standfirst: 'standfirst', abstract: 'abstract', caption: 'caption', equation: 'equation', backmatter: 'back' }

const joinCont = (a: string, b: string) => (/[\u00AD-]$/.test(a) ? joinHyphen(a, b) : `${a} ${b}`)

export function mergeCont(blocks: RebuildBlock[]): RebuildBlock[] {
  const out: RebuildBlock[] = []
  for (const b of blocks) {
    const prev = [...out].reverse().find((x) => x.type !== 'skip' && x.type !== 'caption')
    if (b.cont && prev && ['para', 'list'].includes(prev.type) && ['para', 'list'].includes(b.type)) {
      prev.text = joinCont(prev.text, b.text)
      continue
    }
    out.push({ ...b })
  }
  return out
}

const pageText = (text: string, pg: number) => text.split(`--- PAGE ${pg} ---\n`)[1]?.split('\n--- PAGE')[0] || ''

const chunkLines = (text: string) => text.split('\n').filter((l) => /^B\d+\|/.test(l)).map((l) => l.split('|').slice(2).join('|').replace(/^¶ /, ''))

export function rebuildRequestText(doc: DocData, chunk: Chunk) {
  if (chunk.prev !== undefined) return `PREVIOUS PARAGRAPH:\n${chunk.prev.slice(-600)}\n\n${chunk.text}`
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
  onUpdate?: (paras: Para[], donePages: number[]) => void
  priorityPages?: number[]
  retryPages?: number[]
  base?: Para[]
  concurrency?: number
  limit?: number
}

interface PageUnit {
  pages: number[]
  chunks: { idx: number; chunk: Chunk }[]
}

function groupUnits(chunks: Chunk[]): PageUnit[] {
  const units: PageUnit[] = []
  chunks.forEach((chunk, idx) => {
    const last = units[units.length - 1]
    if (last && chunk.pages.length === 1 && last.pages.length === 1 && last.pages[0] === chunk.pages[0]) {
      last.chunks.push({ idx, chunk })
    } else {
      units.push({ pages: [...chunk.pages], chunks: [{ idx, chunk }] })
    }
  })
  return units
}

function orderByPriority(chunks: Chunk[], priorityPages?: number[]): number[] {
  const indices = chunks.map((_, i) => i)
  if (!priorityPages?.length) return indices
  const prio = new Set(priorityPages)
  const maxPrio = Math.max(...priorityPages)
  const rank = (ch: Chunk) => {
    if (ch.pages.some((pg) => prio.has(pg))) return 0
    if (ch.pages[0] > maxPrio) return 1
    return 2
  }
  return indices.sort((a, b) => rank(chunks[a]) - rank(chunks[b]) || a - b)
}

export async function rebuildDoc(doc: DocData, deps: RebuildDeps): Promise<{ paras: Para[]; summary: RebuildSummary; donePages: number[] }> {
  const rule = doc.parasRule || doc.paras
  const summary: RebuildSummary = { calls: 0, removed: 0, cites: 0, abstract: 0, unverified: 0, failedChunks: 0 }
  const ask = (chunk: Chunk) =>
    callLong(
      deps.ai,
      PROMPT,
      rebuildRequestText(doc, chunk),
      deps.call,
      (res) => (Array.isArray(res.blocks) ? (res.blocks as RebuildBlock[]) : null),
      () => summary.calls++,
    )

  const emitInto = (
    out: Para[],
    blocks: RebuildBlock[],
    ch: Chunk,
    state: { lastPara: string; n: number; stats?: RebuildSummary },
  ) => {
    const lines = chunkLines(ch.text)
    const hay = words(`${state.lastPara} ${lines.join(' ')}`)
    for (const b of mergeCont(blocks)) {
      const rawText = String(b.text || '').trim()
      const text = b.type === 'equation' ? rawText : clean(rawText)
      if (b.type === 'skip') {
        if (state.stats) state.stats.removed++
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
        if (state.stats) state.stats.unverified++
        const r = bestRule(rule, text)
        if (!r?.t) continue
        t = r.t
      }
      if (state.stats) {
        state.stats.cites += (t.match(/⟦/g) || []).length
        if (kind === 'abstract') state.stats.abstract++
      }
      const first = words(t).slice(0, 3).join(' ')
      const pi = ch.pages.find((pg, i) => words(chunkLines(pageText(ch.text, pg)).join(' ')).join(' ').includes(first) || i === ch.pages.length - 1)
      const prevPara = b.cont ? [...out].reverse().find((x) => x.t && !x.h && x.kind !== 'caption') : undefined
      if (prevPara && ['para', 'list'].includes(prevPara.kind || 'para') && ['para', 'list'].includes(kind)) {
        prevPara.t = joinCont(prevPara.t!, t)
      } else out.push({ id: `${doc.id}-A${++state.n}`, pg: pi || ch.pages[0], raw: '', t, kind })
      if (['para', 'list', 'abstract'].includes(kind)) state.lastPara = t
    }
  }

  const pushFallback = (out: Para[], pages: number[], state: { n: number; stats?: RebuildSummary }, countFailed: boolean) => {
    if (countFailed && state.stats) state.stats.failedChunks += pages.length
    const set = new Set(pages)
    for (const r of rule) if (r.pg && set.has(r.pg)) out.push(r.h ? { h: r.h, pg: r.pg, fb: true } : { ...r, id: `${doc.id}-A${++state.n}`, fb: true })
  }

  const concurrency = Math.min(REBUILD_POOL, Math.max(1, deps.concurrency ?? REBUILD_POOL))
  const plan = rebuildPlan(doc, deps.retryPages)
  const units = groupUnits(plan)
  const prioritized = orderByPriority(plan, deps.priorityPages)
  const activeIndices = prioritized.slice(0, deps.limit ?? prioritized.length)
  const activeSet = new Set(activeIndices)
  const results = new Map<number, RebuildBlock[] | null>()
  const splitResults = new Map<number, { chunk: Chunk; blocks: RebuildBlock[] | null }>()

  const isRetry = !!(deps.retryPages && deps.base)
  const baseStartN = isRetry ? Math.max(0, ...deps.base!.map((p) => Number(/-A(\d+)$/.exec(p.id || '')?.[1] || 0))) : 0

  const assemble = (finalPass: boolean): { paras: Para[]; donePages: number[] } => {
    const state = { lastPara: '', n: baseStartN, stats: finalPass ? summary : undefined }
    const donePages: number[] = []
    if (isRetry) {
      let cur = deps.base!.map((p) => ({ ...p }))
      for (const u of units) {
        const ran = u.chunks.every((c) => activeSet.has(c.idx) && results.has(c.idx))
        if (!ran) continue
        const allOk = u.chunks.every((c) => results.get(c.idx) != null)
        if (!allOk) {
          if (finalPass && state.stats) state.stats.failedChunks += u.pages.length
          continue
        }
        const pgSet = new Set(u.pages)
        const minPg = Math.min(...u.pages)
        const firstIdx = cur.findIndex((p) => p.pg != null && pgSet.has(p.pg))
        let before: Para[]
        let after: Para[]
        if (firstIdx >= 0) {
          before = cur.slice(0, firstIdx).filter((p) => p.pg == null || !pgSet.has(p.pg))
          after = cur.slice(firstIdx).filter((p) => p.pg == null || !pgSet.has(p.pg))
        } else {
          const insertAt = cur.findIndex((p) => p.pg != null && p.pg > minPg)
          before = insertAt < 0 ? cur : cur.slice(0, insertAt)
          after = insertAt < 0 ? [] : cur.slice(insertAt)
        }
        state.lastPara = [...before].reverse().find((p) => p.t && !p.kind?.match(/caption|equation|back/))?.t || ''
        const combined = [...before]
        for (const c of u.chunks) emitInto(combined, results.get(c.idx)!, c.chunk, state)
        cur = [...combined, ...after]
        donePages.push(...u.pages)
      }
      return { paras: cur, donePages }
    }
    const out: Para[] = []
    for (const u of units) {
      const ran = u.chunks.every((c) => activeSet.has(c.idx) && results.has(c.idx))
      if (ran && u.chunks.every((c) => results.get(c.idx) != null)) {
        for (const c of u.chunks) emitInto(out, results.get(c.idx)!, c.chunk, state)
        donePages.push(...u.pages)
        continue
      }
      if (u.pages.length > 1 && u.chunks.length === 1 && ran && results.get(u.chunks[0].idx) == null) {
        for (const pg of u.pages) {
          const sp = splitResults.get(pg)
          if (sp?.blocks) {
            emitInto(out, sp.blocks, sp.chunk, state)
            donePages.push(pg)
          } else {
            pushFallback(out, [pg], state, finalPass)
          }
        }
        continue
      }
      pushFallback(out, u.pages, state, finalPass)
    }
    return { paras: out, donePages }
  }

  const unitOfIdx = new Map<number, PageUnit>()
  units.forEach((u) => u.chunks.forEach((c) => unitOfIdx.set(c.idx, u)))

  let done = 0
  deps.onProgress?.(0, activeIndices.length)
  await pool(activeIndices, concurrency, async (idx) => {
    const r = await ask(plan[idx]).catch((err: unknown) => {
      if (err instanceof AIError && err.code === 'quota') return null
      throw err
    })
    results.set(idx, r)
    deps.onProgress?.(++done, activeIndices.length)
    if (deps.onUpdate && r != null) {
      const u = unitOfIdx.get(idx)
      if (u && u.chunks.every((c) => results.get(c.idx) != null)) {
        const snap = assemble(false)
        deps.onUpdate(snap.paras, snap.donePages)
      }
    }
  })

  if (!isRetry) {
    const failedMerged = activeIndices.filter((idx) => results.get(idx) == null && plan[idx].pages.length > 1)
    const splitList = failedMerged.flatMap((idx) => plan[idx].pages.map((pg) => onePage(plan[idx], pg)))
    if (splitList.length) {
      let sDone = 0
      deps.onProgress?.(0, splitList.length)
      await pool(splitList, concurrency, async (ch) => {
        const r = await ask(ch).catch((err: unknown) => {
          if (err instanceof AIError && err.code === 'quota') return null
          throw err
        })
        splitResults.set(ch.pages[0], { chunk: ch, blocks: r })
        deps.onProgress?.(++sDone, splitList.length)
        if (deps.onUpdate && r != null) {
          const snap = assemble(false)
          deps.onUpdate(snap.paras, snap.donePages)
        }
      })
    }
  }

  const final = assemble(true)
  return { paras: final.paras, summary, donePages: final.donePages }
}

export const REBUILD_POOL = 6

const SMALL_PAGE = 78
const SPLIT_THRESHOLD = 110
const MAX_CHUNK_LINES = 80
const MIN_SPLIT_TAIL = 35

const onePage = (ch: Chunk, pg: number): Chunk => ({ pages: [pg], text: `--- PAGE ${pg} ---\n${pageText(ch.text, pg)}` })

export function splitDensePage(pg: number, body: string): Chunk[] {
  const rawLines = body.split('\n').filter(Boolean)
  if (rawLines.length <= SPLIT_THRESHOLD) return [{ pages: [pg], text: `--- PAGE ${pg} ---\n${body}` }]

  // Group lines into contiguous layout blocks (B0, B1, …) so splits never cut mid-block
  let groups: string[][] = []
  let lastCol = ''
  for (const line of rawLines) {
    const col = /^B\d+\|/.test(line) ? line.slice(0, line.indexOf('|')) : ''
    if (!groups.length || (col && col !== lastCol)) {
      groups.push([line])
      lastCol = col
    } else {
      groups[groups.length - 1].push(line)
    }
  }
  // Fallback: if the whole dense page is one giant block, group by paragraph markers (¶ )
  if (groups.length < 2) {
    groups = []
    for (const line of rawLines) {
      if (!groups.length || /^B\d+\|[^|]+\|¶ /.test(line)) groups.push([line])
      else groups[groups.length - 1].push(line)
    }
  }
  if (groups.length < 2) return [{ pages: [pg], text: `--- PAGE ${pg} ---\n${body}` }]

  const parts: string[][] = []
  let cur: string[] = []
  let rem = rawLines.length
  for (const g of groups) {
    if (cur.length >= 45 && cur.length + g.length > MAX_CHUNK_LINES && rem >= MIN_SPLIT_TAIL) {
      parts.push(cur)
      cur = []
    }
    cur.push(...g)
    rem -= g.length
  }
  if (cur.length) parts.push(cur)
  if (parts.length <= 1) return [{ pages: [pg], text: `--- PAGE ${pg} ---\n${body}` }]

  return parts.map((ls, i) => ({
    pages: [pg],
    text: `--- PAGE ${pg} ---\n${ls.join('\n')}`,
    ...(i > 0 ? { prev: chunkLines(parts[i - 1].join('\n')).join(' ').slice(-600) } : {}),
  }))
}

export function rebuildPlan(doc: DocData, retryPages?: number[]): Chunk[] {
  const chunks = doc.aiChunks || []
  if (!retryPages) return pageChunks(chunks)
  const uniq = [...new Set(retryPages)].sort((a, b) => a - b)
  const selected = uniq.flatMap((pg) => {
    const ch = chunks.find((c) => c.pages.includes(pg))
    return ch ? [onePage(ch, pg)] : []
  })
  return pageChunks(selected)
}

export function pageChunks(chunks: Chunk[]): Chunk[] {
  const out: (Chunk & { n: number; split?: boolean })[] = []
  for (const ch of chunks)
    for (const pg of ch.pages) {
      const body = pageText(ch.text, pg)
      const parts = splitDensePage(pg, body)
      if (parts.length > 1) {
        parts.forEach((p) => out.push({ ...p, n: chunkLines(p.text).length, split: true }))
        continue
      }
      const lines = chunkLines(body).length
      const last = out[out.length - 1]
      const contiguous = last && pg === last.pages[last.pages.length - 1] + 1
      if (last && !last.split && contiguous && last.n + lines <= SMALL_PAGE) {
        last.pages.push(pg)
        last.text += `\n--- PAGE ${pg} ---\n${body}`
        last.n += lines
      } else out.push({ pages: [pg], text: parts[0].text, n: lines })
    }
  return out.map(({ pages, text, prev }) => (prev !== undefined ? { pages, text, prev } : { pages, text }))
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
