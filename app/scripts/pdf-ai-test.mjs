import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const ask = (q, hidden = false) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (hidden) {
      rl._writeToOutput = (s) => rl.output.write(s.includes(q) ? s : '')
    }
    rl.question(q, (a) => {
      rl.close()
      if (hidden) process.stdout.write('\n')
      resolve(a.trim())
    })
  })

const PROMPT = `You are cleaning text extracted from one page of an English PDF for a reading app.
Input: the last paragraph before this chunk (may be empty), then lines as "column|fontSize|text", grouped under "--- PAGE n ---" markers. The first field is a layout block id (B0, B1, …); blocks are already in reading order, a new block may start a new column or a new region.
Rules:
- Do NOT rewrite, translate or summarise. Only rejoin broken lines and hyphenations, reorder fragments, and classify.
- Classify each block: title | standfirst | abstract | heading | para | list | caption | equation | backmatter | skip.
  standfirst = the one-sentence summary under a magazine headline.
  skip = running headers, page numbers, journal banners, author names and affiliations, emails, DOI, dates and timestamps, copyright, keywords lists, navigation menus, section labels above headlines, download notices, promotional links and newsletter promotions.
  backmatter = CRediT statements, competing interests, acknowledgements, funding, data availability, references.
- Wrap author-year citations in ⟦ ⟧, e.g. ⟦(Li et al., 2021)⟧.
- For equations, give a readable linear form using Unicode (Σ, subscripts, superscripts) and keep the equation number.
- Set "cont": true on the first block if it continues the previous paragraph; its text should contain only this chunk's part.
- "¶ " at the start of a line marks a paragraph start in the source (indent or blank line). Keep these paragraph breaks; do not merge paragraphs, and do not output the ¶ sign.
- A paragraph that ends without terminal punctuation continues in a later text block, even after page markers, captions, charts or advertisements in between: join the pieces into one block.
- For skip blocks, the text can be a short label.
Reply ONLY JSON: {"blocks":[{"type":"para","text":"...","cont":false}]}`

const words = (s) =>
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

function faithful(out, hay) {
  const o = words(out)
  if (!o.length) return true
  let j = 0
  let miss = 0
  for (const w of o) {
    let k = j
    while (k < hay.length && hay[k] !== w) k++
    if (k < hay.length) j = k + 1
    else miss++
  }
  return miss <= Math.max(1, Math.floor(o.length * 0.03))
}

async function readOutline(doc) {
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

async function readPages(file) {
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise
  const pages = []
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n)
    const vp = pg.getViewport({ scale: 1 })
    const tc = await pg.getTextContent()
    const items = tc.items
      .filter((t) => t.str.trim())
      .map((t) => ({ s: t.str, x: t.transform[4], y: t.transform[5], w: t.width, fs: Math.hypot(t.transform[2], t.transform[3]) }))
    pages.push({ n, w: vp.width, h: vp.height, items })
  }
  pages.outline = await readOutline(doc)
  return pages
}

function bodySize(pages) {
  const hist = {}
  pages.forEach((p) => p.items.forEach((t) => (hist[t.fs.toFixed(1)] = (hist[t.fs.toFixed(1)] || 0) + t.s.length)))
  return Number(Object.entries(hist).sort((a, b) => b[1] - a[1])[0]?.[0] || 10)
}

function joinItems(items, body) {
  let txt = ''
  let prev = null
  for (const t of items) {
    if (prev && t.x - (prev.x + prev.w) > 0.18 * Math.max(t.fs, prev.fs) && !/\s$/.test(txt)) txt += ' '
    const sub = prev && t.fs < body * 0.8 && t.y < prev.y - 0.5 && /^\d+$/.test(t.s.trim())
    txt += sub ? t.s.trim().replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[d]) : t.s
    prev = t
  }
  return txt.replace(/\s+/g, ' ').trim()
}

function pageLines(p, body) {
  const caps = p.items.filter((t) => t.fs >= body * 1.8 && /^[A-Z“"‘']{1,2}$/.test(t.s.trim()))
  const rest = p.items.filter((t) => !caps.includes(t))
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
      if (prev && t.x - (prev.x + prev.w) > 0.18 * Math.max(t.fs, prev.fs) && !/\s$/.test(text)) text += ' '
      const sub = prev && t.fs < body * 0.8 && t.y < prev.y - 0.5 && /^\d+$/.test(t.s.trim())
      text += sub ? t.s.trim().replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[d]) : t.s
      prev = t
    }
    return { x0: r.x0, x1: r.x1, y0: r.y, y1: r.y + fs, fs, text: text.replace(/\s+/g, ' ').trim() }
  })
  const cut = (set, depth) => {
    if (set.length <= 1 || depth > 14) return [set]
    const gap = (axis) => {
      const iv = set.map((l) => (axis === 'x' ? [l.x0, l.x1] : [l.y0, l.y1])).sort((a, b) => a[0] - b[0])
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
    if (okY && (!okX || gy.g * 1.6 > gx.g)) return [...cut(set.filter((l) => l.y0 > gy.at), depth + 1), ...cut(set.filter((l) => l.y0 <= gy.at), depth + 1)]
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
    b.sort((x, y) => y.y0 - x.y0)
    b.forEach((l) => out.push({ col: `B${bi}`, y: l.y0, x: l.x0, w: l.x1 - l.x0, fs: l.fs, text: l.text }))
  })
  return out
}

function markParas(lines, body) {
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

function detectArticles(allLines, body) {
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

const JUNK = /(@|^Received |Available online|©|doi\.org|Contents lists|journal homepage|Corresponding author|^https?:|下一项|章节菜单|主菜单|下一章节|downloaded by calibre|^\d{1,2}\s*月\s*\d{1,2},\s*\d{4}|^Subscribers can sign up|^to understand what the world makes of|^makes of the world\.?$)/i
const DICT_DIR = new URL('../public/dict/', import.meta.url)
const dictCache = {}
const inDict = (w) => {
  const k = w.toLowerCase()
  const l = /^[a-z]/.test(k) ? k[0] : '_'
  if (!(l in dictCache)) {
    try {
      dictCache[l] = new Set(Object.keys(JSON.parse(fs.readFileSync(new URL(`${l}.json`, DICT_DIR), 'utf8'))).map((x) => x.toLowerCase()))
    } catch {
      dictCache[l] = new Set()
    }
  }
  return dictCache[l].has(k)
}
const joinHyphen = (prev, next) => {
  const a = (prev.match(/([A-Za-z]+)[\u00AD-]$/) || [])[1] || ''
  const b = (next.match(/^([A-Za-z]+)/) || [])[1] || ''
  const keep = prev.endsWith('-') && a.length > 1 && b.length > 1 && inDict(a) && inDict(b) && !inDict(a + b)
  return keep ? prev + next : prev.replace(/[\u00AD-]$/, '') + next
}

const clean = (t) =>
  t
    .replace(/\s*https?:\/\/t\.me\/\S+/g, '')
    .replace(/·/g, '')
    .replace(/^▸\s*/, '')
    .replace(/\s*■\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()

function ruleParas(pagesLines, pages, body) {
  const out = []
  let last = null
  const ends = (t) => /[.?!:"”)]$/.test(t)
  pagesLines.forEach((lines, pi) => {
    const p = pages[pi]
    let prevY = null
    let prevCol = null
    let prevText = ''
    let prevFs = 0
    const kept = lines
      .filter((l) => l.y < p.h * 0.93 && l.y > p.h * 0.055 && l.fs >= body * 0.92 && !JUNK.test(l.text))
      .map((l) => ({ ...l, text: clean(l.text) }))
      .filter((l) => l.text)
    const lefts = {}
    kept.forEach((l) => (lefts[l.col] = Math.min(lefts[l.col] ?? Infinity, l.x)))
    const widths = {}
    kept.forEach((l) => (widths[l.col] = Math.max(widths[l.col] || 0, l.w || 0)))
    const gaps = kept.slice(1).map((l, i) => kept[i].y - l.y).filter((g) => g > 0 && g < body * 4).sort((a, b) => a - b)
    const lineGap = gaps[Math.floor(gaps.length * 0.3)] || body * 1.2
    for (const l of kept) {
      const lettersRatio = (l.text.match(/[A-Za-z]/g) || []).length / l.text.length
      const sameCol = prevCol === l.col
      const gap = sameCol && prevY != null ? prevY - l.y : null
      const numbered = /^\d+(\.\d+)*\.?\s+[A-Z][^]{2,80}$/.test(l.text) && l.text.length < 80 && !/[.;,]$/.test(l.text) && !/^(19|20)\d\d\b/.test(l.text)
      const shortLine = (l.w || 0) < (widths[l.col] || 1) * 0.62
      const subhead = shortLine && /^[A-Z]/.test(l.text) && !/[.?!:;,"”)\]]$/.test(l.text) && l.text.split(' ').length <= 8 && (gap == null || gap > lineGap * 1.3) && (!last || ends(prevText) || prevText === '')
      const head = numbered || subhead
      if (!head && (lettersRatio < 0.55 || l.text.split(' ').length <= 2)) continue
      const indent = l.x > lefts[l.col] + 6
      if (head) {
        out.push({ h: l.text.replace(/^(\d+(\.\d+)*)\.?\s*/, '$1 '), pg: p.n })
        last = null
      } else if (!last || (prevFs && Math.max(l.fs, prevFs) / Math.min(l.fs, prevFs) > 1.25) || (gap != null && gap > lineGap * 1.45) || (indent && ends(prevText)) || (gap == null && ends(last.t))) {
        last = { t: l.text, pg: p.n }
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

async function callAI(cfg, content) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 90000)
  try {
    const res = await fetch(`${cfg.base.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model: cfg.model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: PROMPT }, { role: 'user', content }] }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
    const j = await res.json()
    const text = j.choices?.[0]?.message?.content || ''
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('返回内容不是 JSON')
    return { data: JSON.parse(m[0]), usage: j.usage || {} }
  } finally {
    clearTimeout(timer)
  }
}

const LABEL = { standfirst: '导语', title: '标题', abstract: '摘要', heading: '章节', para: '正文', list: '列表', caption: '图表标题', equation: '公式', backmatter: '文末声明', skip: '已剔除' }

async function main() {
  const dir = path.resolve(process.argv[2] || '.')
  let file = process.argv[3]
  if (!file) {
    const pdfs = fs.readdirSync(dir).filter((f) => /\.pdf$/i.test(f))
    if (!pdfs.length) {
      console.log(`在 ${dir} 里没有找到 PDF。`)
      return
    }
    pdfs.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
    const pick = pdfs.length === 1 ? '1' : await ask('选择要试验的 PDF 序号：')
    file = path.join(dir, pdfs[Number(pick) - 1] || pdfs[0])
  }
  const cfg = {
    key: process.env.LUZZLE_AI_KEY || (await ask('DeepSeek API Key（输入时不显示）：', true)),
    base: process.env.LUZZLE_AI_BASE || 'https://api.deepseek.com',
    model: process.env.LUZZLE_AI_MODEL || 'deepseek-chat',
  }
  if (!cfg.key) return console.log('没有输入 Key，已退出。')
  const pages = await readPages(file)
  const body = bodySize(pages)
  const allLines = pages.map((p) => pageLines(p, body))
  const name = path.basename(file).replace(/\.pdf$/i, '')
  const outDir = path.dirname(file)

  const units = []
  const ol = pages.outline || []
  const pick = async (list) => {
    const ans = await ask('\n输入要试验的文章序号，可多个，用逗号分隔（直接回车 = 按页数处理）：')
    return ans
      .split(/[,，\s]+/)
      .map(Number)
      .filter((n) => n >= 1 && n <= list.length)
  }
  if (ol.length >= 3) {
    console.log(`\n这份 PDF 有目录，共 ${ol.length} 篇：`)
    ol.forEach((o, i) => console.log(`  ${i + 1}. ${o.section ? `[${o.section}] ` : ''}${o.title}（第 ${o.page}–${Math.min(o.end, pages.length)} 页）`))
    for (const n of await pick(ol)) {
      const o = ol[n - 1]
      units.push({ title: o.title, from: { pi: o.page - 1, li: 0 }, to: { pi: Math.min(o.end, pages.length) - 1, li: Infinity } })
    }
  } else {
    const arts = detectArticles(allLines, body)
    if (arts.length >= 3) {
      console.log(`\n没有目录，按大字号标题识别出 ${arts.length} 篇：`)
      arts.forEach((a, i) => console.log(`  ${i + 1}. ${a.title.slice(0, 80)}（第 ${a.pi + 1} 页起）`))
      for (const n of await pick(arts)) {
        const a = arts[n - 1]
        const nx = arts[n]
        units.push({ title: a.title, from: { pi: a.pi, li: a.li }, to: nx ? { pi: nx.pi, li: nx.li - 1 } : { pi: pages.length - 1, li: Infinity } })
      }
    }
  }
  if (!units.length) {
    const maxIn = await ask(`共 ${pages.length} 页，处理前几页？（直接回车 = 全部）：`)
    units.push({ title: '', from: { pi: 0, li: 0 }, to: { pi: Math.min(pages.length, Number(maxIn) || pages.length) - 1, li: Infinity } })
  }
  const sliceOf = (u) => {
    const out = []
    for (let pi = u.from.pi; pi <= u.to.pi; pi++) {
      const lo = pi === u.from.pi ? u.from.li : 0
      const hi = pi === u.to.pi ? u.to.li : Infinity
      out.push({ pi, lines: allLines[pi].filter((_, i) => i >= lo && i <= hi) })
    }
    return out.filter((x) => x.lines.length)
  }
  const span = (u) => `第 ${u.from.pi + 1}–${u.to.pi + 1} 页`

  const ruleMd = [`# ${name} · 规则版`, '', `> 正文字号 ${body}pt`, '']
  const md = [`# ${name} · AI 重排`, '']
  const stat = { calls: 0, fail: 0, inTok: 0, outTok: 0, unverified: 0, blocks: {} }
  const t0 = Date.now()
  const body2 = []

  for (const u of units) {
    const sl = sliceOf(u)
    const lineOf = Object.fromEntries(sl.map((x) => [x.pi, x.lines]))
    const idx = sl.map((x) => x.pi)
    const rules = ruleParas(
      sl.map((x) => x.lines),
      idx.map((i) => pages[i]),
      body,
    )
    ruleMd.push(u.title ? `\n# ${u.title}（${span(u)}）\n` : '')
    rules.forEach((r) => ruleMd.push(r.h ? `\n## ${r.h} · p.${r.pg}\n` : `[p.${r.pg}] ${r.t}\n`))

    const chunks = []
    let cur = []
    let size = 0
    for (const i of idx) {
      const n = lineOf[i].length
      if (cur.length && size + n > 160) {
        chunks.push(cur)
        cur = []
        size = 0
      }
      cur.push(i)
      size += n
    }
    if (cur.length) chunks.push(cur)

    body2.push(u.title ? `\n---\n\n# ${u.title}（${span(u)}）\n` : '')
    let lastPara = ''
    for (const ch of chunks) {
      const label = ch.length > 1 ? `第 ${ch[0] + 1}–${ch[ch.length - 1] + 1} 页` : `第 ${ch[0] + 1} 页`
      process.stdout.write(`  ${u.title ? `${u.title.slice(0, 24)} · ` : ''}${label} … `)
      const input = `PREVIOUS PARAGRAPH:\n${lastPara.slice(-600)}\n\n${ch
        .map((i) => `--- PAGE ${i + 1} ---\n${markParas(lineOf[i], body).map((l) => ({ ...l, text: clean(l.text) })).filter((l) => l.text).map((l) => `${l.col}|${l.fs.toFixed(1)}|${l.start ? '¶ ' : ''}${l.text}`).join('\n')}`)
        .join('\n')}`
      const hay = words(`${lastPara} ${ch.map((i) => lineOf[i].map((l) => clean(l.text)).join(' ')).join(' ')}`)
      let res = null
      for (let tryN = 0; tryN < 2 && !res; tryN++) {
        try {
          res = await callAI(cfg, input)
        } catch (e) {
          if (tryN) {
            console.log(`失败：${e.message}`)
            stat.fail++
          }
        }
      }
      stat.calls++
      if (!res) {
        body2.push(`\n### ${label}\n\n（调用失败）\n`)
        continue
      }
      stat.inTok += res.usage.prompt_tokens || 0
      stat.outTok += res.usage.completion_tokens || 0
      const merged = []
      for (const b of res.data.blocks || []) {
        const prevText = [...merged].reverse().find((x) => x.type !== 'skip' && x.type !== 'caption')
        if (b.cont && prevText && ['para', 'list'].includes(prevText.type) && ['para', 'list'].includes(b.type)) {
          prevText.text = `${prevText.text.replace(/[\u00AD-]$/, '')}${/[\u00AD-]$/.test(prevText.text) ? '' : ' '}${b.text}`
          continue
        }
        merged.push({ ...b })
      }
      const blocks = merged.map((b) => {
        const plain = String(b.text || '').replace(/[⟦⟧]/g, '')
        const check = !['skip', 'equation', 'title'].includes(b.type)
        const ok = !check || faithful(plain, hay)
        if (!ok) stat.unverified++
        stat.blocks[b.type] = (stat.blocks[b.type] || 0) + 1
        return { ...b, ok }
      })
      const lastText = [...blocks].reverse().find((b) => ['para', 'list', 'abstract'].includes(b.type))
      if (lastText) lastPara = lastText.text
      body2.push(`\n### ${label}\n`)
      const skipped = blocks.filter((b) => b.type === 'skip').map((b) => b.text)
      for (const b of blocks.filter((x) => x.type !== 'skip')) {
        const warn = b.ok ? '' : ' ⚠️'
        const cont = b.cont ? '（续上段）' : ''
        if (b.type === 'heading' || b.type === 'title') body2.push(`\n**【${LABEL[b.type]}】${b.text}**${warn}\n`)
        else body2.push(`【${LABEL[b.type] || b.type}】${cont}${b.text}${warn}\n`)
      }
      if (skipped.length) body2.push(`> 已剔除：${skipped.join(' / ')}\n`)
      console.log(`${blocks.length} 块`)
    }
  }

  const secs = Math.round((Date.now() - t0) / 1000)
  md.push(
    `> ${units.map((u) => (u.title ? `${u.title}（${span(u)}）` : span(u))).join('；')}`,
    `> 调用 ${stat.calls} 次（失败 ${stat.fail}）· 输入 ${stat.inTok} tokens / 输出 ${stat.outTok} tokens · 用时 ${secs} 秒 · 模型 ${cfg.model}`,
    `> 未通过「只删不改」校验的块：${stat.unverified}（标 ⚠️，说明 AI 改写了原文）`,
    `> 块类型统计：${Object.entries(stat.blocks)
      .map(([k, v]) => `${LABEL[k] || k} ${v}`)
      .join('，')}`,
    '',
    ...body2,
  )
  fs.writeFileSync(path.join(outDir, `${name}_规则版.md`), ruleMd.join('\n'))
  const outFile = path.join(outDir, `${name}_AI重排.md`)
  fs.writeFileSync(outFile, md.join('\n'))
  console.log(`\n完成：${path.basename(outFile)} 和 ${name}_规则版.md 已保存在 PDF 旁边。`)
}

main().catch((e) => {
  console.error('出错：', e.message)
  process.exitCode = 1
})
