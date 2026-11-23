import type { DocData, PageLen, Para } from '../core/types'

export const PAGE_WORDS: Record<Exclude<PageLen, 'none'>, number> = { short: 250, mid: 450, long: 700 }

export type Item = { kind: 'h'; p: Para; i: number } | { kind: 'junk'; p: Para; i: number } | { kind: 'p'; p: Para; i: number }

export function visibleItems(doc: DocData): Item[] {
  const hasRaw = doc.paras.some((p) => p.raw)
  const out: Item[] = []
  doc.paras.forEach((p, i) => {
    if (p.h) {
      if (doc.rebuilt || !hasRaw) out.push({ kind: 'h', p, i })
    } else if (p.junk) {
      if (!doc.rebuilt) out.push({ kind: 'junk', p, i })
    } else out.push({ kind: 'p', p, i })
  })
  return out
}

const wordCount = (p: Para, rebuilt: boolean) => ((!rebuilt && p.raw ? p.raw : p.t) || '').split(/\s+/).filter(Boolean).length

export function paginate(doc: DocData, len: PageLen): Item[][] {
  const items = visibleItems(doc)
  if (len === 'none' || !items.length) return [items]
  const limit = PAGE_WORDS[len]
  const pages: Item[][] = []
  let cur: Item[] = []
  let words = 0
  let pending: Item[] = []
  for (const it of items) {
    if (it.kind !== 'p') {
      pending.push(it)
      continue
    }
    const n = wordCount(it.p, doc.rebuilt)
    if (cur.some((x) => x.kind === 'p') && words + n > limit) {
      pages.push(cur)
      cur = []
      words = 0
    }
    cur.push(...pending, it)
    pending = []
    words += n
  }
  if (pending.length) cur.push(...pending)
  if (cur.length) pages.push(cur)
  return pages
}

export const pageOfPara = (pages: Item[][], pid: string) => pages.findIndex((pg) => pg.some((it) => it.kind === 'p' && it.p.id === pid))
