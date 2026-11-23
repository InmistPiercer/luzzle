import { create } from 'zustand'
import { aiErr } from '../ai/ask'
import { callLong, type CallDeps } from '../ai/client'
import type { AIConfig } from '../ai/types'
import type { Para } from '../core/types'
import { pool } from '../pdf/rebuild'
import { db } from '../storage/db'
import type { Item } from './paginate'
import { stripCites } from './text'

export const TR_POOL = 5

interface TrState {
  map: Record<string, string>
  running: { id: number; docId: string; done: number; total: number } | null
  set: (p: Partial<TrState>) => void
}

export const useTr = create<TrState>((set) => ({ map: {}, running: null, set: (p) => set(p) }))

const tr = () => useTr.getState()

export const srcOf = (p: Para) => stripCites(p.t || '').trim()

export function trKey(text: string) {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 16777619)
    b = Math.imul(b ^ c, 2246822507)
  }
  return `tr|${text.length}|${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`
}

export const zhOf = (map: Record<string, string>, p: Para) => map[trKey(srcOf(p))]

const translatable = (it: Item) => it.kind === 'p' && it.p.kind !== 'code' && /[a-z]/i.test(srcOf(it.p))

export async function loadTr(paras: Para[]) {
  const keys = [...new Set(paras.map(srcOf).filter(Boolean).map(trKey))].filter((k) => !(k in tr().map))
  if (!keys.length) return
  const rows = await db.cache.bulkGet(keys).catch(() => [])
  const add: Record<string, string> = {}
  rows.forEach((r) => {
    if (r && typeof r.value === 'string') add[r.key] = r.value
  })
  if (Object.keys(add).length) tr().set({ map: { ...tr().map, ...add } })
}

export const TR_PROMPT =
  'Translate each English paragraph into natural, faithful Simplified Chinese for a reader studying the original. Keep names, numbers and terms accurate; do not add notes. Reply ONLY JSON {"t":["译文1","译文2",...]} with exactly one string per input paragraph, in order.'

export interface TrDeps {
  ai: AIConfig
  call: CallDeps
  concurrency?: number
}

export function batchParagraphs(texts: string[], fastFirst = false): string[][] {
  if (texts.length <= 1) return texts.length ? [texts] : []
  const out: string[][] = []
  let i = 0
  if (fastFirst) {
    out.push([texts[0]])
    i = 1
  }
  const maxN = fastFirst ? 2 : 3
  const maxChars = fastFirst ? 720 : 960
  let cur: string[] = []
  let len = 0
  for (; i < texts.length; i++) {
    const t = texts[i]
    if (cur.length && (cur.length >= maxN || len + t.length > maxChars)) {
      out.push(cur)
      cur = []
      len = 0
    }
    cur.push(t)
    len += t.length
  }
  if (cur.length) out.push(cur)
  return out
}

export function pendingChunks(pages: Item[][], start: number, map: Record<string, string>): string[][] {
  const order = [...pages.keys()].slice(start).concat([...pages.keys()].slice(0, start))
  return order
    .map((i) => [...new Set(pages[i].filter(translatable).map((it) => srcOf(it.p)))].filter((t) => !map[trKey(t)]))
    .filter((x) => x.length)
}

export function pendingBatches(pages: Item[][], start: number, map: Record<string, string>): { chunks: string[][]; pageCounts: number[]; pages: number } {
  const pageTexts = pendingChunks(pages, start, map)
  const chunks: string[][] = []
  const pageCounts: number[] = []
  pageTexts.forEach((texts, pi) => {
    const subs = batchParagraphs(texts, pi === 0)
    subs.forEach((sub, si) => {
      chunks.push(sub)
      pageCounts.push(si === subs.length - 1 ? 1 : 0)
    })
  })
  return { chunks, pageCounts, pages: pageTexts.length }
}

export async function translateChunks(chunks: string[][], deps: TrDeps, onChunk: (got: Record<string, string> | null) => void, stopped: () => boolean) {
  let failed = 0
  await pool(chunks, Math.min(TR_POOL, Math.max(1, deps.concurrency ?? TR_POOL)), async (texts) => {
    if (stopped()) return
    const got = await callLong(deps.ai, TR_PROMPT, JSON.stringify(texts), deps.call, (res) => {
      const raw = Array.isArray(res.t) ? res.t.map((x) => String(x).trim()) : []
      if (raw.length === texts.length && raw.every(Boolean)) return Object.fromEntries(texts.map((x, i) => [trKey(x), raw[i]]))
      if (texts.length === 1 && raw.length > 1 && raw.every(Boolean)) return { [trKey(texts[0])]: raw.join('') }
      return null
    })
    if (!got) failed++
    onChunk(got)
  })
  return failed
}

export async function translateDoc(docId: string, chunks: string[][], deps: TrDeps, say: (m: string) => void) {
  if (tr().running || !chunks.length) return
  const id = Date.now()
  const mine = () => tr().running?.id === id
  tr().set({ running: { id, docId, done: 0, total: chunks.length } })
  try {
    const failed = await translateChunks(
      chunks,
      deps,
      (got) => {
        const r = mine() ? tr().running : null
        if (got) void db.cache.bulkPut(Object.entries(got).map(([key, value]) => ({ key, value, at: Date.now() }))).catch(() => undefined)
        tr().set({ map: got ? { ...tr().map, ...got } : tr().map, ...(r ? { running: { ...r, done: r.done + 1 } } : {}) })
      },
      () => !mine(),
    )
    if (failed && mine()) say(`有 ${failed} 组段落翻译失败`)
  } catch (e) {
    if (mine()) say(aiErr(e, '翻译失败'))
  }
  if (mine()) tr().set({ running: null })
}
