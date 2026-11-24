import type { DocData, Para } from '../core/types'
import { bodySize, clean, detectArticles, loadDictWords, markParas, pageLines, readPdf, ruleParas, type PdfLine, type PdfPage } from './extract'

export interface Pos {
  pi: number
  li: number
}

export interface PdfUnit {
  title: string
  section: string
  from: Pos
  to: Pos
  words: number
}

export interface ParsedPdf {
  name: string
  title: string
  pages: PdfPage[]
  body: number
  lines: PdfLine[][]
  units: PdfUnit[]
  scanned: boolean
}

const sliceOf = (p: ParsedPdf, u: { from: Pos; to: Pos }) => {
  const out: { pi: number; lines: PdfLine[] }[] = []
  for (let pi = u.from.pi; pi <= Math.min(u.to.pi, p.pages.length - 1); pi++) {
    const lo = pi === u.from.pi ? u.from.li : 0
    const hi = pi === u.to.pi ? u.to.li : Infinity
    out.push({ pi, lines: p.lines[pi].filter((_, i) => i >= lo && i <= hi) })
  }
  return out.filter((x) => x.lines.length)
}

const countWords = (p: ParsedPdf, u: { from: Pos; to: Pos }) =>
  sliceOf(p, u).reduce((n, x) => n + x.lines.filter((l) => l.fs >= p.body * 0.92).reduce((m, l) => m + l.text.split(/\s+/).length, 0), 0)

const SECTION = /^(\d+(\.\d+)*\.?\s|[IVX]+\.\s|appendix|abstract|introduction|background|related work|literature|method|results?\b|discussion|conclusions?|references|bibliography|acknowledg|data availability|supplementary)/i
const looksLikeSections = (titles: string[]) => titles.length > 0 && titles.filter((t) => SECTION.test(t.trim())).length >= titles.length * 0.5

export function isScannedPages(pages: Pick<PdfPage, 'items'>[]) {
  if (!pages.length) return true
  const emptyPages = pages.filter((p) => !p.items.some((item) => /[\p{L}\p{N}]/u.test(item.s))).length
  if (emptyPages >= pages.length * 0.8) return true
  if (pages.length < 3) return false
  const sparsePages = pages.filter((p) => p.items.reduce((n, t) => n + t.s.trim().length, 0) < 40).length
  return sparsePages >= pages.length * 0.8
}

export async function parsePdf(buf: ArrayBuffer, name: string): Promise<ParsedPdf> {
  await loadDictWords()
  const { pages, outline, title } = await readPdf(buf)
  const body = bodySize(pages)
  const lines = pages.map((p) => pageLines(p, body))
  const scanned = isScannedPages(pages)
  const parsed: ParsedPdf = { name, title: title || name.replace(/\.pdf$/i, ''), pages, body, lines, units: [], scanned }
  let units: PdfUnit[] = []
  if (outline.length >= 3 && !(pages.length <= 60 && looksLikeSections(outline.map((o) => o.title)))) {
    units = outline.map((o) => ({
      title: o.title,
      section: o.section,
      from: { pi: o.page - 1, li: 0 },
      to: { pi: Math.min(o.end, pages.length) - 1, li: Infinity },
      words: 0,
    }))
  } else {
    const arts = detectArticles(lines, body)
    if (arts.length >= 3 && !(pages.length <= 60 && looksLikeSections(arts.map((a) => a.title))))
      units = arts.map((a, i) => ({
        title: a.title,
        section: '',
        from: { pi: a.pi, li: a.li },
        to: arts[i + 1] ? { pi: arts[i + 1].pi, li: arts[i + 1].li - 1 } : { pi: pages.length - 1, li: Infinity },
        words: 0,
      }))
  }
  if (!units.length) units = [{ title: parsed.title, section: '', from: { pi: 0, li: 0 }, to: { pi: pages.length - 1, li: Infinity }, words: 0 }]
  units.forEach((u) => (u.words = countWords(parsed, u)))
  parsed.units = units
  return parsed
}

export function buildDoc(p: ParsedPdf, u: PdfUnit, vault: number, id: string): DocData {
  const sl = sliceOf(p, u)
  const rules = ruleParas(
    sl.map((x) => x.lines),
    sl.map((x) => p.pages[x.pi]),
    p.body,
  )
  let n = 0
  const paras: Para[] = rules.map((r) => (r.h ? { h: r.h, pg: r.pg } : { id: `${id}-P${++n}`, pg: r.pg, raw: '', t: r.t }))
  if (!paras.some((para) => para.t)) {
    paras.length = 0
    for (const { pi, lines } of sl) {
      const text = lines.map((line) => clean(line.text)).filter(Boolean).join(' ')
      if (/[\p{L}\p{N}]/u.test(text)) paras.push({ id: `${id}-P${++n}`, pg: p.pages[pi].n, raw: '', t: text })
    }
  }
  const aiChunks: { pages: number[]; text: string }[] = []
  let cur: typeof sl = []
  let size = 0
  const flush = () => {
    if (!cur.length) return
    aiChunks.push({
      pages: cur.map((x) => x.pi + 1),
      text: cur
        .map(
          (x) =>
            `--- PAGE ${x.pi + 1} ---\n${markParas(x.lines, p.body)
              .map((l) => ({ ...l, text: clean(l.text) }))
              .filter((l) => l.text)
              .map((l) => `${l.col}|${l.fs.toFixed(1)}|${l.start ? '¶ ' : ''}${l.text}`)
              .join('\n')}`,
        )
        .join('\n'),
    })
    cur = []
    size = 0
  }
  for (const x of sl) {
    if (cur.length && size + x.lines.length > 160) flush()
    cur.push(x)
    size += x.lines.length
  }
  flush()
  return {
    id,
    title: u.title || p.title,
    vault,
    rebuilt: false,
    cachedRebuilt: false,
    user: true,
    paras,
    parasRule: paras,
    aiChunks,
  }
}
