import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

export const PROMPT = `You are cleaning text extracted from one page of an English PDF for a reading app.
Input: the last paragraph before this chunk (may be empty), then lines as "column|fontSize|text", grouped under "--- PAGE n ---" markers. The first field is a layout block id (B0, B1, …); blocks are already in reading order, a new block may start a new column or a new region.
Rules:
- Do NOT rewrite, translate or summarise. Only rejoin broken lines and hyphenations, reorder fragments, and classify.
- Classify each block: title | standfirst | abstract | heading | para | list | caption | equation | backmatter | skip.
  standfirst = the one-sentence summary under a magazine headline.
  skip = running headers, page numbers, journal banners, author names and affiliations, emails, DOI, dates and timestamps, copyright, keywords lists, navigation menus, section labels above headlines, download notices, promotional links and newsletter promotions.
  backmatter = CRediT statements, competing interests, acknowledgements, funding, data availability, references.
- Wrap author-year citations in ⟦ ⟧, e.g. ⟦(Li et al., 2021)⟧.
- For equations, give a readable linear form using Unicode (Σ, subscripts, superscripts) and keep the equation number.
- Set "cont": true ONLY on a block that continues the previous paragraph (omit "cont" otherwise); its text should contain only this chunk's part.
- "¶ " at the start of a line marks a paragraph start in the source (indent or blank line). Keep these paragraph breaks; do not merge paragraphs, and do not output the ¶ sign.
- A paragraph that ends without terminal punctuation continues in a later text block, even after page markers, captions, charts or advertisements in between: join the pieces into one block.
- For skip blocks, set "text": "".
Reply ONLY JSON: {"blocks":[{"type":"para","text":"..."}]}`

export const words = (s) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00AD‐-]\s*/g, '')
    .replace(/\S*[_^]\S*/g, ' ')
    .replace(/[₀-₉]/g, (c) => '0123456789'['₀₁₂₃₄₅₆₇₈₉'.indexOf(c)])
    .replace(/[⁰¹²³⁴-⁹]/g, (c) => '0123456789'['⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c)])
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1)

export function faithful(out, hay) {
  const o = words(out)
  if (!o.length) return true
  const counts = new Map()
  for (const w of hay) counts.set(w, (counts.get(w) || 0) + 1)
  const take = (w) => {
    const c = counts.get(w) || 0
    if (c <= 0) return false
    counts.set(w, c - 1)
    return true
  }
  let miss = 0
  for (const w of o) {
    if (take(w)) continue
    let joined = false
    if (w.length >= 6) {
      for (let i = 2; i <= w.length - 2; i++) {
        const a = w.slice(0, i)
        const b = w.slice(i)
        if ((counts.get(a) || 0) > 0 && (counts.get(b) || 0) > 0) {
          take(a)
          take(b)
          joined = true
          break
        }
      }
    }
    if (!joined) miss++
  }
  return miss <= Math.max(1, Math.floor(o.length * 0.03))
}

export async function readOutline(doc) {
  const out = []
  const starts = []
  const walk = async (items, section) => {
    for (const it of items || []) {
      let page = null
      try {
        const dest = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest
        if (dest) page = (await doc.getPageIndex(dest[0])) + 1
      } catch {}
      if (page) starts.push(page)
      if (it.items?.length) await walk(it.items, it.title)
      else if (page) out.push({ title: it.title, section: section || '', page })
    }
  }
  await walk(await doc.getOutline(), '')
  out.sort((a, b) => a.page - b.page)
  out.forEach((o) => (o.end = Math.min(...starts.filter((x) => x > o.page), Infinity) - 1))
  return out
}

export async function readPdf(data) {
  const doc = await getDocument({ data: new Uint8Array(data), verbosity: 0 }).promise
  const pages = []
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n)
    const vp = pg.getViewport({ scale: 1 })
    const tc = await pg.getTextContent()
    const items = []
    let sp = null
    for (const t of tc.items) {
      if (!t.str) {
        if (t.hasEOL) sp = null
        continue
      }
      const x = t.transform[4]
      const y = t.transform[5]
      const fs = Math.hypot(t.transform[2], t.transform[3])
      if (!t.str.trim()) {
        sp = { x, y, w: t.width, fs }
        continue
      }
      const hasSp =
        !!sp &&
        Math.abs(y - sp.y) < Math.max(fs, sp.fs, 6) * 0.5 &&
        x >= sp.x - 1 &&
        x - (sp.x + sp.w) < Math.max(fs, sp.fs, 6) * 1.5
      items.push({ s: t.str, x, y, w: t.width, fs, ...(hasSp ? { sp: true } : {}) })
      sp = null
    }
    pages.push({ n, w: vp.width, h: vp.height, items })
  }
  const outline = await readOutline(doc)
  const title = String((await doc.getMetadata().catch(() => null))?.info?.Title || '')
  return { pages, outline, title }
}

export function bodySize(pages) {
  const hist = {}
  pages.forEach((p) => p.items.forEach((t) => (hist[t.fs.toFixed(1)] = (hist[t.fs.toFixed(1)] || 0) + t.s.length)))
  return Number(Object.entries(hist).sort((a, b) => b[1] - a[1])[0]?.[0] || 10)
}

export function pageLines(p, body) {
  const valid = p.items.filter((t) => t.fs >= 3)
  const caps = valid.filter((t) => t.fs >= body * 1.8 && /^[A-Z“"‘']{1,2}$/.test(t.s.trim()))
  const rest = valid.filter((t) => !caps.includes(t))
  const rows = []
  ;[...rest]
    .sort((a, b) => b.fs - a.fs)
    .forEach((t) => {
      const r = rows.find((r) => Math.abs(r.y - t.y) < body * 0.6 && t.x < r.x1 + body * 1.2 && t.x + t.w > r.x0 - body * 1.2)
      if (r) {
        r.items.push(t)
        r.x0 = Math.min(r.x0, t.x)
        r.x1 = Math.max(r.x1, t.x + t.w)
      } else rows.push({ y: t.y, x0: t.x, x1: t.x + t.w, items: [t] })
    })
  let coalesced = true
  while (coalesced) {
    coalesced = false
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i]
        const b = rows[j]
        if (Math.abs(a.y - b.y) < body * 0.5 && b.x0 <= a.x1 + body * 0.9 && b.x1 >= a.x0 - body * 0.9) {
          a.items.push(...b.items)
          a.x0 = Math.min(a.x0, b.x0)
          a.x1 = Math.max(a.x1, b.x1)
          rows.splice(j, 1)
          coalesced = true
          break
        }
      }
      if (coalesced) break
    }
  }
  for (const c of caps) {
    const cands = rows.filter((r) => r.x0 > c.x && r.x0 < c.x + c.w + body * 3 && r.y <= c.y + c.fs * 1.1 && r.y >= c.y - body)
    const target = cands.sort((a, b) => b.y - a.y)[0]
    if (target) target.items.unshift({ ...c, x: target.x0 - 0.01, w: 0, cap: true })
  }
  const ls = rows.map((r) => {
    r.items.sort((a, b) => (a.cap ? -1 : b.cap ? 1 : a.x - b.x))
    const fs = Math.max(...r.items.filter((t) => !t.cap).map((t) => t.fs), 0) || r.items[0].fs
    let text = ''
    let prev = null
    for (const t of r.items) {
      if (t.cap) {
        text += t.s.trim()
        continue
      }
      if (prev && (t.sp || t.x - (prev.x + prev.w) > 0.14 * Math.max(t.fs, prev.fs)) && !/\s$/.test(text) && !/^\s/.test(t.s)) text += ' '
      const sub = prev && t.fs < body * 0.8 && t.y < prev.y - 0.5 && /^\d+$/.test(t.s.trim())
      text += sub ? t.s.trim().replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[d]) : t.s
      prev = t
    }
    return { x0: r.x0, x1: r.x1, y0: r.y, y1: r.y + fs, fs, text: text.replace(/\s+/g, ' ').trim() }
  })
  const cut = (set, depth) => {
    if (set.length <= 1 || depth > 14) return [set]
    const gap = (axis, s = set) => {
      if (s.length <= 1) return null
      const iv = s.map((l) => (axis === 'x' ? [l.x0, l.x1] : [l.y0, l.y1])).sort((a, b) => a[0] - b[0])
      let best = null
      let end = iv[0][1]
      for (let i = 1; i < iv.length; i++) {
        const g = iv[i][0] - end
        if (g > 0 && (!best || g > best.g)) best = { g, at: (end + iv[i][0]) / 2 }
        end = Math.max(end, iv[i][1])
      }
      return best
    }
    const gy = gap('y')
    const gx = gap('x')
    const okX = gx && gx.g > body * 0.9
    const okY = gy && gy.g > body * 0.5
    if (okY) {
      let cutY = gy
      if (!okX) {
        const iv = set.map((l) => [l.y0, l.y1]).sort((a, b) => a[0] - b[0])
        const cands = []
        let end = iv[0][1]
        for (let i = 1; i < iv.length; i++) {
          const g = iv[i][0] - end
          if (g > body * 0.5) cands.push({ g, at: (end + iv[i][0]) / 2 })
          end = Math.max(end, iv[i][1])
        }
        const peel = cands
          .sort((a, b) => b.at - a.at)
          .find((c) => {
            const t = set.filter((l) => l.y0 > c.at)
            const b = set.filter((l) => l.y0 <= c.at)
            const bx = gap('x', b)
            return t.length > 0 && t.length <= 6 && t.some((l) => l.fs >= body * 1.5) && bx && bx.g > body * 0.9
          })
        if (peel) cutY = peel
      }
      const top = set.filter((l) => l.y0 > cutY.at)
      const bot = set.filter((l) => l.y0 <= cutY.at)
      const spansX = (s) => okX && s.some((l) => l.x1 <= gx.at) && s.some((l) => l.x0 >= gx.at)
      const botTopY = bot.length ? Math.max(...bot.map((l) => l.y0)) : 0
      const minX = (s) => Math.min(...s.map((l) => l.x0))
      const bigBand = spansX(top) && spansX(bot) && cutY.g > body * 3.5 && Math.abs(minX(top) - minX(bot)) < body * 5
      const topBig = top.filter((l) => l.fs >= body * 1.5)
      const topBanner =
        spansX(bot) &&
        top.length <= 6 &&
        topBig.length > 0 &&
        !top.some((l) => l.y0 < Math.min(...topBig.map((x) => x.y0)) - body * 1.5 && l.fs < body * 1.2)
      const headBreak =
        okX &&
        cutY.g > body * 1.8 &&
        (topBanner || (spansX(top) && bot.some((l) => l.y0 >= botTopY - body * 3 && l.fs >= body * 1.5)))
      const realHorizBreak = bigBand || headBreak
      if (top.length && bot.length && (!okX || realHorizBreak)) return [...cut(top, depth + 1), ...cut(bot, depth + 1)]
    }
    if (okX) {
      const L = set.filter((l) => l.x1 <= gx.at)
      const R = set.filter((l) => l.x0 >= gx.at)
      if (L.length && R.length) return [...cut(L, depth + 1), ...cut(R, depth + 1)]
    }
    return [set]
  }
  const blocks = cut(ls.filter((l) => l.text), 0)
  const out = []
  blocks.forEach((b, bi) => {
    b.sort((x, y) => (Math.abs(y.y0 - x.y0) > body * 0.35 ? y.y0 - x.y0 : x.x0 - y.x0))
    b.forEach((l) => out.push({ col: `B${bi}`, y: l.y0, x: l.x0, w: l.x1 - l.x0, fs: l.fs, text: l.text }))
  })
  return out
}

export function markParas(lines, body) {
  const hist = {}
  lines.forEach((l) => {
    const h = (hist[l.col] = hist[l.col] || {})
    const k = Math.round(l.x)
    h[k] = (h[k] || 0) + 1
  })
  const left = {}
  Object.entries(hist).forEach(([c, h]) => (left[c] = Number(Object.entries(h).sort((a, b) => b[1] - a[1])[0][0])))
  const gaps = lines
    .slice(1)
    .map((l, i) => (lines[i].col === l.col ? lines[i].y - l.y : 0))
    .filter((g) => g > 0 && g < body * 4)
    .sort((a, b) => a - b)
  const lineGap = gaps[Math.floor(gaps.length * 0.3)] || body * 1.2
  return lines.map((l, i) => {
    const prev = lines[i - 1]
    const indent = l.x > left[l.col] + body * 0.4 && l.x < left[l.col] + body * 4
    const gapped = prev && prev.col === l.col && prev.y - l.y > lineGap * 1.45
    const prevEnds = !prev || prev.col !== l.col || /[.?!:"”’)\]]$/.test(prev.text.trim())
    return { ...l, start: (indent && prevEnds) || gapped }
  })
}

export function detectArticles(allLines, body) {
  const arts = []
  allLines.forEach((lines, pi) => {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (l.fs < body * 1.7 || !/[a-z]/i.test(l.text) || (lines[i - 1] && lines[i - 1].fs >= body * 1.7 && lines[i - 1].col === l.col)) continue
      let title = l.text
      for (let j = i + 1; j < lines.length && lines[j].fs >= body * 1.7 && lines[j].col === l.col; j++) title += ` ${lines[j].text}`
      const startAt = lines[i - 1] && lines[i - 1].col === l.col && lines[i - 1].fs < l.fs && lines[i - 1].text.split(' ').length <= 5 ? i - 1 : i
      arts.push({ title, pi, li: startAt })
    }
  })
  return arts
}

export const JUNK = /(@|^Received |Available online|©|doi\.org|Contents lists|journal homepage|Corresponding author|^https?:|下一项|章节菜单|主菜单|下一章节|downloaded by calibre|^\d{1,2}\s*月\s*\d{1,2},\s*\d{4}|^Subscribers can sign up|^to understand what the world makes of|^makes of the world\.?$)/i
let dictWords = null

export async function loadDictWords() {
  if (dictWords) return
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('')
  const sets = await Promise.all(
    letters.map((l) =>
      fetch(`${import.meta.env.BASE_URL}dict/${l}.json`)
        .then((r) => r.json())
        .then((o) => Object.keys(o).map((x) => x.toLowerCase()))
        .catch(() => []),
    ),
  )
  dictWords = new Set(sets.flat())
}

const inDict = (w) => !!dictWords?.has(w.toLowerCase())

export const joinHyphen = (prev, next) => {
  const a = (prev.match(/([A-Za-z]+)[\u00AD-]$/) || [])[1] || ''
  const b = (next.match(/^([A-Za-z]+)/) || [])[1] || ''
  const hasDict = !!(dictWords && dictWords.size > 0)
  const numPrefix = /\d-$/.test(prev)
  const hyphenWord = a.length > 1 && b.length > 1 && inDict(`${a}-${b}`)
  const chained = /[A-Za-z]+-[A-Za-z]+-$/.test(prev) && (!hasDict || (inDict(a) && inDict(b) && !inDict(a + b)))
  const keep = prev.endsWith('-') && (numPrefix || hyphenWord || chained || (a.length > 1 && b.length > 1 && inDict(a) && inDict(b) && !inDict(a + b)))
  return keep ? prev + next : prev.replace(/[\u00AD-]$/, '') + next
}

export const clean = (t) =>
  t
    .replace(/\s*https?:\/\/t\.me\/\S+/g, '')
    .replace(/·/g, '')
    .replace(/^▸\s*/, '')
    .replace(/[⏩]/g, '')
    .replace(/\s*■\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()

const MATH = /[=⋅∑Σ∫∂√≤≥≈∈×÷∥‖ʹ′]/
const SHORT = new Set(['a', 'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'i', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'we'])
const PROSE_2 = new Set(['mr', 'ms', 'dr', 'st', 'jr', 'sr', 'uk', 'us', 'eu', 'un', 'ai', 'de', 'la', 'el', 'al', 'le', 'du', 'pm', 'mp', 'tv', 'id', 'ok', 'vs', 'ex', 'ad', 're'])
const PROSE_NUM = /^(?:\d+(?:[.,]\d+)?(?:st|nd|rd|th|s|k|m|bn|trn|p|g|kg|mg|km|cm|mm|ml|gb|mb|tb|hz|ghz|mw|gw|kw|pt|px|am|pm)|[123]d)$/i
const NUM_TOK = /^\(?[$£€¥]?\d[\d.,]*%?\)?[.,;:!?]?$/
const realWord = (w) => {
  const x = w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '').toLowerCase()
  if (!/^[a-z]+(?:[-'’][a-z]+)*$/.test(x)) return false
  const base = x.replace(/['’](?:s|re|ve|ll|d|m)$/g, '')
  const stem = /n['’]t$/.test(base) && !inDict(base.slice(0, -2)) ? base.slice(0, -3) : base.replace(/['’]t$/, '')
  if (stem.length <= 2) return (SHORT.has(stem) && stem !== 'i') || PROSE_2.has(stem)
  return stem
    .split(/[-'’]/)
    .every((p) => (dictWords && dictWords.size > 0 ? inDict(p) : p.length >= 3) || p.length > 3 || (p.length <= 2 && (SHORT.has(p) || PROSE_2.has(p))))
}
const AMP_ACR = /^[A-Z]{1,4}&[A-Z]{1,4}$/
const leadOk = (w) => {
  const s = w.replace(/^[^A-Za-z0-9&]+|[^A-Za-z0-9&]+$/g, '')
  return realWord(w) || AMP_ACR.test(s) || PROSE_NUM.test(s) || NUM_TOK.test(w)
}
const mathTok = (w) => {
  const x = w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
  if (!/[A-Za-z]/.test(x)) return null
  if (/^[A-Za-z]$/.test(x)) return !/^[aAI]$/.test(x)
  if (/\d/.test(x)) {
    if (PROSE_NUM.test(x)) return false
    if (x.includes('-') && x.split('-').every((p) => !p || /^\d+$/.test(p) || PROSE_NUM.test(p) || realWord(p))) return false
    return true
  }
  if (dictWords && dictWords.size > 0 && /^[a-z]+$/.test(x) && x.length <= 6 && !inDict(x) && !SHORT.has(x) && !PROSE_2.has(x) && !['et', 'al', 'vs', 'eg', 'ie'].includes(x)) return true
  return false
}
export const hasMathTok = (t) => MATH.test(t) || t.split(/\s+/).some((w) => mathTok(w) === true)
export const mathy = (t) => {
  if (MATH.test(t)) return true
  const r = t.split(/\s+/).map(mathTok).filter((x) => x !== null)
  return r.length > 0 && r.filter(Boolean).length / r.length > 0.4
}
export const stripLead = (t) => {
  const ws = t.split(/\s+/)
  const first = ws[0] || ''
  if (!/^[^A-Za-z0-9(“"‘'$£€¥]/.test(t) && (leadOk(first) || (/^[A-Z]$/.test(first) && ws[1] && /^[a-z]/.test(ws[1]) && realWord(ws[1])))) return t
  let k = 0
  while (k < ws.length && k < 8 && !(realWord(ws[k]) && ws[k].replace(/[^A-Za-z]/g, '').length >= 3)) k++
  return k > 0 && k < ws.length ? ws.slice(k).join(' ') : t
}

export function ruleParas(pagesLines, pages, body) {
  const out = []
  let last = null
  let headOpen = false
  const ends = (t) => /[.?!:]["”’')\]]*$/.test(t)
  pagesLines.forEach((lines, pi) => {
    const p = pages[pi]
    let prevY = null
    let prevCol = null
    let prevText = ''
    let prevFs = 0
    const kept = lines
      .filter(
        (l) =>
          l.y < p.h * 0.93 &&
          l.y > p.h * 0.025 &&
          l.fs >= body * 0.92 &&
          !JUNK.test(l.text) &&
          !(l.y < p.h * 0.06 && l.fs < body * 0.98 && l.text.split(' ').length <= 6) &&
          !(l.y < p.h * 0.06 && /^(page\s*)?\d+$/i.test(l.text.trim())),
      )
      .map((l) => ({ ...l, text: clean(l.text) }))
      .filter((l) => l.text)
    const lefts = {}
    kept.forEach((l) => (lefts[l.col] = Math.min(lefts[l.col] ?? Infinity, l.x)))
    const widths = {}
    const counts = {}
    kept.forEach((l) => {
      widths[l.col] = Math.max(widths[l.col] || 0, l.w || 0)
      counts[l.col] = (counts[l.col] || 0) + 1
    })
    const colWidths = Object.entries(widths)
      .filter(([c]) => counts[c] >= 3)
      .map(([, w]) => w)
      .sort((a, b) => a - b)
    const bodyWidths = kept.filter((l) => Math.abs(l.fs - body) < 1.5).map((l) => l.w || 0)
    const pageW = colWidths[Math.floor(colWidths.length / 2)] || Math.max(1, ...(bodyWidths.length ? bodyWidths : kept.map((l) => l.w || 0)))
    const gaps = kept.slice(1).map((l, i) => kept[i].y - l.y).filter((g) => g > 0 && g < body * 4).sort((a, b) => a - b)
    const lineGap = gaps[Math.floor(gaps.length * 0.3)] || body * 1.2
    for (const l of kept) {
      const lettersRatio = (l.text.match(/[A-Za-z]/g) || []).length / l.text.length
      const sameCol = prevCol === l.col
      const gap = sameCol && prevY != null ? prevY - l.y : null
      const clean0 = !MATH.test(l.text) && !/[<>|^_]/.test(l.text)
      const numbered = clean0 && /^\d+(\.\d+)*\.?\s+[A-Z][^]{2,80}$/.test(l.text) && l.text.length < 80 && !/[.;,]$/.test(l.text) && !/^(19|20)\d\d\b/.test(l.text) && !mathy(l.text.replace(/^[\d.]+\s+/, ''))
      const shortLine = (l.w || 0) < (counts[l.col] >= 3 ? widths[l.col] : pageW) * 0.62
      const subhead = clean0 && shortLine && out.some((o) => o.t) && /^[A-Z]/.test(l.text) && !hasMathTok(l.text) && !/,/.test(l.text) && l.text.split(' ').some((w) => realWord(w) && w.length >= 3) && !/[.?!:;,"”)\]]$/.test(l.text) && l.text.split(' ').length <= 8 && (gap == null || gap > lineGap * 1.3) && (!last || ends(prevText) || prevText === '')
      const bigHead = clean0 && l.fs >= body * 1.1 && l.y < p.h * 0.85 && !hasMathTok(l.text) && !/\*/.test(l.text) && (l.text.match(/,/g) || []).length <= 1 && (l.fs >= body * 1.6 || out.some((o) => o.t)) && /^[A-Z“"‘(]/.test(l.text) && l.text.split(' ').length <= 12 && !/[.;:]$/.test(l.text) && l.text.split(' ').some((w) => realWord(w) && w.length >= 3)
      const head = numbered || subhead || bigHead
      const bigHeadCont =
        headOpen &&
        prevFs >= body * 1.5 &&
        Math.abs(l.fs - prevFs) < 1 &&
        gap != null &&
        gap < l.fs * 1.6 &&
        !mathy(l.text)
      if ((!head && headOpen && /^[a-z]/.test(l.text) && gap != null && gap < lineGap * 1.4 && !mathy(l.text)) || bigHeadCont) {
        const curH = out[out.length - 1].h
        out[out.length - 1].h = /[\u00AD-]$/.test(curH) && /^[a-z]/.test(l.text) ? joinHyphen(curH, l.text) : `${curH} ${l.text}`
        prevY = l.y
        prevCol = l.col
        prevFs = l.fs
        continue
      }
      headOpen = false
      const contHyphen = !!(last && /[\u00AD-]$/.test(last.t) && /^[a-z]/.test(l.text))
      const prevFrag = contHyphen ? (last.t.match(/([A-Za-z]+)[\u00AD-]$/) || [])[1] || '' : ''
      const checkText = contHyphen && prevFrag ? prevFrag + l.text : l.text
      const checkToks = checkText.split(' ')
      const proseTail = !!(last && !ends(last.t) && !MATH.test(l.text) && checkToks.some(realWord) && checkToks.every(leadOk))
      const proseWords = checkToks.filter((w) => realWord(w) && w.replace(/[^A-Za-z]/g, '').length >= 2).length
      const lowLetters = !proseTail && lettersRatio < (proseWords >= 3 ? 0.4 : 0.55)
      const shortJunk = checkToks.length <= 2 && !(checkToks.some(realWord) && checkToks.every(leadOk))
      if (!head && (lowLetters || mathy(checkText) || shortJunk)) {
        if (MATH.test(l.text) || lowLetters) last = null
        continue
      }
      if (!head && !last) l.text = stripLead(l.text)
      const indent = l.x > lefts[l.col] + 6
      if (head) {
        out.push({ h: l.text.replace(/^(\d+(\.\d+)*)\.?\s*/, '$1 '), pg: p.n })
        last = null
        headOpen = numbered || l.fs >= body * 1.5
      } else if (!last || (prevFs && Math.max(l.fs, prevFs) / Math.min(l.fs, prevFs) > 1.25) || (gap != null && gap > lineGap * 1.45) || (indent && ends(prevText)) || (gap == null && ends(last.t))) {
        last = { t: out.length && out[out.length - 1].h && /^[a-z]/.test(l.text) ? l.text[0].toUpperCase() + l.text.slice(1) : l.text, pg: p.n }
        out.push(last)
      } else if (/[\u00AD-]$/.test(last.t) && /^[a-z]/.test(l.text)) last.t = joinHyphen(last.t, l.text)
      else last.t += ` ${l.text}`
      prevY = l.y
      prevCol = l.col
      prevText = l.text
      prevFs = l.fs
    }
  })
  const ref = out.findIndex((o) => (o.h && /references/i.test(o.h)) || (o.t && /^references\b/i.test(o.t)))
  return (ref > 0 ? out.slice(0, ref) : out).filter((o) => o.h || o.t.split(' ').length >= 15)
}

