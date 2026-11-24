import { describe, expect, it, vi } from 'vitest'
import type { DocData } from '../core/types'
import { tokenize } from '../reader/text'
import { mergeCont, rebuildDoc, rebuildPlan, pageChunks, pool, splitDensePage, REBUILD_POOL } from './rebuild'
import { isScannedPages } from './importPdf'
import { pageRangeLabel, pendingPdfPages } from './PdfUI'
import { emptyUsage, type Tally } from '../ai/client'

const doc: DocData = {
  id: 'u1',
  title: 'T',
  vault: 0,
  rebuilt: false,
  cachedRebuilt: false,
  user: true,
  paras: [{ id: 'u1-P1', pg: 1, raw: '', t: 'It is true that the policy would reduce executive pay. But the picture is less rosy.' }],
  aiChunks: [
    {
      pages: [1],
      text: '--- PAGE 1 ---\nB0|9.0|¶ It is true that the policy\nB1|7.0|Fattening cats\nB2|9.0|would reduce executive pay (Li et al., 2021). But the picture is less rosy.\nB3|8.0|Advertisement',
    },
  ],
}

const reply = (blocks: unknown) =>
  (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ blocks }) } }] }))) as unknown as typeof fetch

const deps = (f: typeof fetch, record: (t: Tally) => void = () => {}) => ({
  ai: { provider: 'openai' as const, baseUrl: '', apiKey: 'k', model: '', dailyLimit: 30, budget: 0, cur: 'CNY' as const },
  call: { today: 'd', usage: () => emptyUsage('d'), record, fetch: f },
})

describe('rebuild', () => {
  it('merges continuation blocks across a caption', () => {
    const m = mergeCont([
      { type: 'para', text: 'It is true that the policy' },
      { type: 'caption', text: 'Fattening cats' },
      { type: 'para', text: 'would reduce executive pay.', cont: true },
    ])
    expect(m.map((b) => b.text)).toEqual(['It is true that the policy would reduce executive pay.', 'Fattening cats'])
  })

  it('keeps faithful blocks, marks citations and drops skipped ones', async () => {
    const { paras, summary } = await rebuildDoc(
      doc,
      deps(
        reply([
          { type: 'para', text: 'It is true that the policy' },
          { type: 'caption', text: 'Fattening cats' },
          { type: 'para', text: 'would reduce executive pay ⟦(Li et al., 2021)⟧. But the picture is less rosy.', cont: true },
          { type: 'skip', text: 'Advertisement' },
        ]),
      ),
    )
    expect(paras.map((p) => p.kind)).toEqual(['para', 'caption'])
    expect(paras[0].t).toContain('policy would reduce')
    expect(summary).toMatchObject({ removed: 1, cites: 1, unverified: 0 })
    expect(tokenize(paras[0].t || '').some((t) => t.cite)).toBe(true)
  })

  it('falls back to the rule paragraph when AI rewrites text', async () => {
    const { paras, summary } = await rebuildDoc(doc, deps(reply([{ type: 'para', text: 'It is true that this policy might reduce what executives earn. But the picture is less rosy.' }])))
    expect(summary.unverified).toBe(1)
    expect(paras[0].t).toBe(doc.paras[0].t)
  })

  it('retries and falls back to rule paragraphs when AI returns empty object', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })))
    const { paras, summary } = await rebuildDoc(doc, deps(f as unknown as typeof fetch))
    expect(f).toHaveBeenCalledTimes(2)
    expect(summary.failedChunks).toBe(1)
    expect(paras).toHaveLength(1)
    expect(paras[0].fb).toBe(true)
    expect(paras[0].t).toBe(doc.paras[0].t)
  })
})

import { clean, faithful as ok, joinHyphen, mathy, pageLines, ruleParas, stripLead, words as ws } from './extract'
it('math notation tokens are skipped by the checker', () => {
  const hay = ws('In contrastive learning, the xselfi based on its own samples should have a stronger semantic bias than the xotheri based on other samples.')
  expect(ok('In contrastive learning, the x_i^self based on its own samples should have a stronger semantic bias than the x_i^other based on other samples.', hay)).toBe(true)
  expect(ok('In contrastive learning, the model invented a brand new claim here about samples.', hay)).toBe(false)
})

const two: DocData = {
  ...doc,
  paras: [
    { h: '1 Intro', pg: 1 },
    { id: 'u1-P1', pg: 1, raw: '', t: 'Alpha page text is here and it is long enough for the test.' },
    { h: '2 Methods', pg: 2 },
    { id: 'u1-P2', pg: 2, raw: '', t: 'Beta page text is here and it is long enough for the test.' },
  ],
  aiChunks: [{ pages: [1, 2], text: '--- PAGE 1 ---\nB0|9.0|¶ Alpha page text is here\n--- PAGE 2 ---\nB0|9.0|¶ Beta page text is here' }],
}

describe('rebuild robustness', () => {
  it('repairs latex backslashes and sends json mode with a system prompt', async () => {
    let body: { response_format?: unknown; messages: { role: string }[]; max_tokens?: number } | null = null
    const f = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(init.body as string)
      const content = '{"blocks":[{"type":"equation","text":"(2) dist_i = \\sum_j d_{ij}"},{"type":"para","text":"Alpha page text is here"}]}'
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }))
    }) as unknown as typeof fetch
    const { paras, summary } = await rebuildDoc({ ...doc, aiChunks: [two.aiChunks![0]] }, deps(f))
    expect(body!.response_format).toEqual({ type: 'json_object' })
    expect(body!.messages[0].role).toBe('system')
    expect(body!.max_tokens).toBe(8192)
    expect(summary.failedChunks).toBe(0)
    expect(paras[0].kind).toBe('equation')
    expect(paras[0].t).toContain('\\sum')
  })

  it('splits a failing chunk into pages and only falls back for pages that still fail', async () => {
    const f = (async (_u: string, init: RequestInit) => {
      const user = JSON.parse(init.body as string).messages[1].content as string
      const n = (user.match(/--- PAGE/g) || []).length
      if (n > 1 || user.includes('PAGE 2')) return new Response('bad', { status: 500 })
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ blocks: [{ type: 'para', text: 'Alpha page text is here' }] }) } }] }))
    }) as unknown as typeof fetch
    const { paras, summary } = await rebuildDoc(two, deps(f))
    expect(summary.failedChunks).toBe(1)
    expect(paras.filter((p) => p.h).map((p) => p.h)).toEqual(['2 Methods'])
    expect(paras.map((p) => p.t).filter(Boolean)).toEqual(['Alpha page text is here', 'Beta page text is here and it is long enough for the test.'])
  })

  it('records every request', async () => {
    const saved: Tally[] = []
    await rebuildDoc(doc, deps(reply([{ type: 'para', text: 'It is true that the policy' }]), (t) => saved.push(t)))
    expect(saved.map((t) => t.req)).toEqual([1])
  })
})

describe('retry failed pages', () => {
  it('replaces only the fallback paragraphs of the retried page', async () => {
    const fail = (async () => new Response('bad', { status: 500 })) as unknown as typeof fetch
    const first = await rebuildDoc(two, deps(fail))
    expect(first.paras.every((p) => p.fb)).toBe(true)
    const ok = (async (_u: string, init: RequestInit) => {
      const user = JSON.parse(init.body as string).messages[1].content as string
      const text = user.includes('PAGE 1') ? 'Alpha page text is here' : 'Beta page text is here'
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ blocks: [{ type: 'para', text }] }) } }] }))
    }) as unknown as typeof fetch
    const res = await rebuildDoc(two, { ...deps(ok), retryPages: [2], base: first.paras })
    expect(res.paras.map((p) => p.h || p.t)).toEqual(['1 Intro', 'Alpha page text is here and it is long enough for the test.', 'Beta page text is here'])
    expect(res.paras[2].fb).toBeUndefined()
    expect(new Set(res.paras.filter((p) => p.id).map((p) => p.id)).size).toBe(2)
  })
})

describe('parallel rebuild', () => {
  it('sends only confirmed chunks and keeps the remaining rule text', async () => {
    const lines = (pg: number) => `--- PAGE ${pg} ---\n${Array.from({ length: 50 }, () => `B0|8.0|Page ${pg} text`).join('\n')}`
    const source = { ...two, aiChunks: [{ pages: [1, 2], text: [lines(1), lines(2)].join('\n') }] }
    const f = vi.fn(reply([{ type: 'para', text: 'Page 1 text' }]))
    const result = await rebuildDoc(source, { ...deps(f), limit: 1 })
    expect(f).toHaveBeenCalledTimes(1)
    expect(result.paras.find((p) => p.fb && p.t)?.t).toBe(two.paras[3].t)
  })

  it('merges short pages and runs calls concurrently', async () => {
    const lines = (pg: number, n: number) => `--- PAGE ${pg} ---\n${Array.from({ length: n }, (_, i) => `B0|8.0|line ${pg}-${i}`).join('\n')}`
    const ch = pageChunks([{ pages: [1, 2, 3], text: [lines(1, 10), lines(2, 30), lines(3, 45)].join('\n') }])
    expect(ch.map((c) => c.pages)).toEqual([[1, 2], [3]])
    let live = 0
    let peak = 0
    const out = await pool([1, 2, 3, 4, 5, 6], 4, async (x) => {
      peak = Math.max(peak, ++live)
      await new Promise((r) => setTimeout(r, 10))
      live--
      return x * 2
    })
    expect(out).toEqual([2, 4, 6, 8, 10, 12])
    expect(peak).toBe(4)
  })
})

describe('economist & multi-column pdf fixes', () => {
  it('accepts legitimately reordered fragments and split-hyphen rejoins in faithful()', () => {
    const hay = ws('Second column continuation ends clearly here. First column opening starts dispro 12 The Economist proportionately here.')
    expect(ok('First column opening starts disproportionately here. Second column continuation ends clearly here.', hay)).toBe(true)
    expect(ok('First column opening invents completely fabricated claims here.', hay)).toBe(false)
  })

  it('joins cross-chunk continuations across captions and hyphens, and cleans stray markers', async () => {
    const multi: DocData = {
      ...doc,
      paras: [
        { id: 'u1-P1', pg: 1, raw: '', t: 'Its ill-considered design means that it is Mr Polanski’s dispro-' },
        { id: 'u1-P2', pg: 2, raw: '', t: 'portionately young voters who would lose the most.' },
      ],
      aiChunks: [
        {
          pages: [1, 2],
          text: [
            '--- PAGE 1 ---',
            ...Array.from({ length: 80 }, (_, i) =>
              i === 0 ? 'B0|9.0|¶ Its ill-considered design means that it is Mr Polanski’s dispro-' : 'B1|7.0|Fattening cats chart',
            ),
            '--- PAGE 2 ---',
            'B0|9.0|portionately young voters who would lose the most. ■ ⏩',
          ].join('\n'),
        },
      ],
    }
    const f = (async (_u: string, init: RequestInit) => {
      const user = JSON.parse(init.body as string).messages[1].content as string
      const blocks = user.includes('PAGE 1')
        ? [
            { type: 'para', text: 'Its ill-considered design means that it is Mr Polanski’s dispro-' },
            { type: 'caption', text: 'Fattening cats chart' },
          ]
        : [{ type: 'para', text: 'portionately young voters who would lose the most. ■ ⏩', cont: true }]
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ blocks }) } }] }))
    }) as unknown as typeof fetch
    const { paras, summary } = await rebuildDoc(multi, deps(f))
    expect(summary.unverified).toBe(0)
    expect(paras.map((p) => p.kind)).toEqual(['para', 'caption'])
    expect(paras[0].t).toBe('Its ill-considered design means that it is Mr Polanski’s disproportionately young voters who would lose the most.')
  })

  it('coalesces Economist small-caps onto one line and drops microscopic printer codes', () => {
    const ls = pageLines(
      {
        n: 23,
        w: 612,
        h: 792,
        items: [
          { s: 'C002', x: 0, y: 0, w: 2.4, fs: 1 },
          { s: 'E', x: 77, y: 169.5, w: 9.2, fs: 15 },
          { s: 'ARNING A NAME', x: 86.2, y: 169.5, w: 100.2, fs: 12.5 },
          { s: 'for issuing empty threats can be devastating.', x: 191.7, y: 169.5, w: 320, fs: 15 },
        ],
      },
      15,
    )
    expect(ls).toHaveLength(1)
    expect(ls[0].text).toBe('EARNING A NAME for issuing empty threats can be devastating.')
  })

  it('does not drop financial prose lines as math, preserves chained hyphens, and keeps 3-column bottom lines', () => {
    expect(mathy('compensation was £9.2m in 2024-25, whereas workers earned £12.02 an hour (£24,000 a year).')).toBe(false)
    expect(mathy('In the 1970s and 2020s, a 100bn-yuan fund built 3D printers worth $32trn.')).toBe(false)
    expect(mathy('x1 + y2 = z3 for all k0')).toBe(true)
    expect(joinHyphen('ten-to-', 'one')).toBe('ten-to-one')
    expect(joinHyphen('dispro-', 'portionately')).toBe('disproportionately')
    expect(clean('The end of the article. ■ ⏩')).toBe('The end of the article.')

    const pg = { n: 14, w: 567, h: 756.8, items: [] }
    const rules = ruleParas(
      [
        [
          { col: 'B0', y: 630, x: 77, w: 300, fs: 30, text: 'America’s dangerous pursuit' },
          { col: 'B0', y: 594, x: 77, w: 280, fs: 30, text: 'of critical-mineral dominance' },
          { col: 'B1', y: 40, x: 31.5, w: 160, fs: 9, text: 'In 2019 only five songs in Denmark were in Danish.' },
          { col: 'B1', y: 33, x: 31.5, w: 160, fs: 9, text: 'compensation was £9.2m in 2024-25, whereas workers earned' },
          { col: 'B1', y: 26.9, x: 31.5, w: 160, fs: 9, text: '£12.02 an hour (less than £24,000 a year full-time).' },
          { col: 'B2', y: 28, x: 400, w: 20, fs: 8, text: '14' },
        ],
      ],
      [pg],
      9,
    )
    expect(rules[0]).toEqual({ h: 'America’s dangerous pursuit of critical-mineral dominance', pg: 14 })
    expect(rules[1].t).toContain('£9.2m in 2024-25')
    expect(rules[1].t).toContain('£12.02 an hour (less than £24,000 a year full-time).')
  })

  it('preserves explicit and tight spaces across bold/small-caps runs without splitting compounds', () => {
    const ls = pageLines(
      {
        n: 5,
        w: 567,
        h: 756.8,
        items: [
          { s: 'Israel', x: 31.47, y: 546.85, w: 22.14, fs: 9 },
          { s: 'and', x: 55.14, y: 546.85, w: 14.24, fs: 9, sp: true },
          { s: 'Lebanon', x: 70.91, y: 546.85, w: 34.97, fs: 9, sp: true },
          { s: 'agreed to', x: 107.41, y: 546.85, w: 34.78, fs: 9, sp: true },
          { s: 'Another giga-', x: 31.46, y: 506.86, w: 51.6, fs: 9 },
          { s: 'IPO', x: 83.06, y: 506.86, w: 13.7, fs: 9 },
          { s: ', for', x: 96.76, y: 506.86, w: 14.49, fs: 9 },
          { s: 'SpaceX', x: 112.51, y: 506.86, w: 29.42, fs: 9, sp: true },
          { s: ',', x: 141.93, y: 506.86, w: 2.28, fs: 9 },
          { s: 'America’s', x: 31.46, y: 466.89, w: 38, fs: 9 },
          { s: 'S', x: 70.99, y: 466.89, w: 4.19, fs: 9 },
          { s: '&', x: 75.18, y: 466.89, w: 7.09, fs: 9 },
          { s: 'P', x: 82.27, y: 466.89, w: 4.57, fs: 9 },
          { s: '500', x: 88.37, y: 466.89, w: 13.4, fs: 9 },
        ],
      },
      9,
    )
    expect(ls.map((l) => l.text)).toEqual([
      'Israel and Lebanon agreed to',
      'Another giga-IPO, for SpaceX,',
      'America’s S&P 500',
    ])
  })

  it('reads 4-column pages strictly column-by-column even with aligned paragraph gaps and inset art', () => {
    const mk = (s: string, x: number, y: number, w = 110, fs = 9) => ({ s, x, y, w, fs })
    const ls = pageLines(
      {
        n: 5,
        w: 567,
        h: 756.8,
        items: [
          mk('The world this week Business', 31.5, 695.9, 213, 18),
          // Col 1: photo at top (above y=546.9), paragraph break at y=506.9 (gap=11pt), continues below cartoon (y=486.9..466.9)
          mk('Col1 top line one', 31.5, 546.9),
          mk('Col1 top line two', 31.5, 536.9),
          mk('Col1 mid line', 31.5, 516.9),
          mk('Col1 bottom line one', 31.5, 486.9),
          mk('Col1 bottom line two', 31.5, 476.9),
          // Col 2..4: start higher than Col 1 (y=666.9), share aligned 11pt-20pt paragraph breaks, end at y=516.9 above cartoon
          mk('Col2 top cont', 160.5, 666.9),
          mk('Col2 para two', 160.5, 646.9),
          mk('Col2 upper mid', 160.5, 616.9),
          mk('Col2 lower mid', 160.5, 586.9),
          mk('Col2 mid', 160.5, 556.9),
          mk('Col2 bottom', 160.5, 516.9),
          mk('Col3 top cont', 289.5, 666.9),
          mk('Col3 para two', 289.5, 646.9),
          mk('Col3 upper mid', 289.5, 616.9),
          mk('Col3 lower mid', 289.5, 586.9),
          mk('Col3 mid', 289.5, 556.9),
          mk('Col3 bottom', 289.5, 516.9),
          mk('Col4 top cont', 418.5, 666.9),
          mk('Col4 para two', 418.5, 646.9),
          mk('Col4 upper mid', 418.5, 616.9),
          mk('Col4 lower mid', 418.5, 586.9),
          mk('Col4 mid', 418.5, 556.9),
          mk('Col4 bottom', 418.5, 516.9),
        ],
      },
      9,
    )
    expect(ls.map((l) => l.text)).toEqual([
      'The world this week Business',
      'Col1 top line one',
      'Col1 top line two',
      'Col1 mid line',
      'Col1 bottom line one',
      'Col1 bottom line two',
      'Col2 top cont',
      'Col2 para two',
      'Col2 upper mid',
      'Col2 lower mid',
      'Col2 mid',
      'Col2 bottom',
      'Col3 top cont',
      'Col3 para two',
      'Col3 upper mid',
      'Col3 lower mid',
      'Col3 mid',
      'Col3 bottom',
      'Col4 top cont',
      'Col4 para two',
      'Col4 upper mid',
      'Col4 lower mid',
      'Col4 mid',
      'Col4 bottom',
    ])
  })

  it('still separates stacked multi-column articles when a new headline starts below', () => {
    const mk = (s: string, x: number, y: number, w = 150, fs = 9) => ({ s, x, y, w, fs })
    const ls = pageLines(
      {
        n: 26,
        w: 567,
        h: 756.8,
        items: [
          mk('Top article col1 a', 31.5, 696.9),
          mk('Top article col1 b', 31.5, 506.9),
          mk('Top article col2 a', 203.5, 696.9),
          mk('Top article col2 b', 203.5, 506.9),
          mk('Bad guys', 31.5, 476.9, 60, 9),
          mk('Counter-terror error', 31.5, 456.9, 150, 18),
          mk('America’s new strategy spans both columns', 31.5, 409.3, 250, 9),
          mk('Bottom article col1', 31.5, 376.9),
          mk('Bottom article col2', 203.5, 376.9),
        ],
      },
      9,
    )
    const texts = ls.map((l) => l.text)
    expect(texts.indexOf('Top article col2 b')).toBeLessThan(texts.indexOf('Bad guys'))
    expect(texts.indexOf('Counter-terror error')).toBeLessThan(texts.indexOf('Bottom article col1'))
  })

  it('keeps possessives, titles, hyphenated tails, numeric hyphens and S&P prose intact in ruleParas()', () => {
    expect(stripLead('Kenya’s High Court blocked the opening.')).toBe('Kenya’s High Court blocked the opening.')
    expect(stripLead('Mr Trump picked Bill Pulte.')).toBe('Mr Trump picked Bill Pulte.')
    expect(stripLead('5.8% of listings were removed.')).toBe('5.8% of listings were removed.')
    expect(joinHyphen('Amazon rolled out its 30-', 'minute delivery')).toBe('Amazon rolled out its 30-minute delivery')

    const pg = { n: 6, w: 567, h: 756.8, items: [] }
    const rules = ruleParas(
      [
        [
          { col: 'B0', y: 695.9, x: 31.5, w: 213, fs: 18, text: 'The world this week Business' },
          { col: 'B1', y: 546.9, x: 31.5, w: 112, fs: 9, text: 'Indonesia’s president,' },
          { col: 'B1', y: 536.9, x: 31.5, w: 112, fs: 9, text: 'Prabowo Subianto, fired the head of his free-school-meals programme and warned of serious reputa-' },
          { col: 'B1', y: 526.9, x: 31.5, w: 58, fs: 9, text: 'tional damage”.' },
          { col: 'B2', y: 486.9, x: 31.5, w: 110, fs: 9, text: 'NASDAQ Composite dropped by 4.2% on June 5th, and the' },
          { col: 'B2', y: 476.9, x: 31.5, w: 92, fs: 9, text: 'S&P 500 declined by 2.6%.' },
          { col: 'B2', y: 466.9, x: 31.5, w: 110, fs: 9, text: 'Listings fell to their lowest monthly share since' },
          { col: 'B2', y: 456.9, x: 31.5, w: 46, fs: 9, text: 'March 2020.' },
          { col: 'B3', y: 296.9, x: 289.5, w: 104, fs: 9, text: 'Gold is now a more popular' },
          { col: 'B3', y: 286.9, x: 289.5, w: 104, fs: 9, text: 'reserve asset than American' },
          { col: 'B4', y: 666.9, x: 418.5, w: 114, fs: 9, text: 'Treasury bonds, according to a report by the European Central Bank.' },
        ],
      ],
      [pg],
      9,
    )
    expect(rules.some((r) => r.h === 'Gold is now a more popular')).toBe(false)
    expect(rules[0].t).toBe('Indonesia’s president, Prabowo Subianto, fired the head of his free-school-meals programme and warned of serious reputational damage”.')
    expect(rules[1].t).toContain('S&P 500 declined by 2.6%.')
    expect(rules[1].t).toContain('since March 2020.')
    expect(rules[2].t).toBe('Gold is now a more popular reserve asset than American Treasury bonds, according to a report by the European Central Bank.')
  })

  it('splits dense single pages (>110 lines) at block boundaries for parallel rebuild and joins them in order', async () => {
    expect(REBUILD_POOL).toBeGreaterThanOrEqual(6)
    const mkBlock = (bi: number, n: number, tag: string) =>
      Array.from({ length: n }, (_, i) => `B${bi}|9.0|${i === 0 ? '¶ ' : ''}${tag} line ${i} with enough words here.`).join('\n')
    const denseBody = [mkBlock(0, 45, 'Alpha'), mkBlock(1, 45, 'Beta'), mkBlock(2, 45, 'Gamma')].join('\n')
    const parts = splitDensePage(5, denseBody)
    expect(parts.length).toBeGreaterThanOrEqual(2)
    expect(parts.every((p) => p.pages.length === 1 && p.pages[0] === 5)).toBe(true)
    expect(parts[0].prev).toBeUndefined()
    expect(parts[1].prev).toContain('Alpha')

    const denseDoc: DocData = {
      ...doc,
      paras: [{ id: 'u1-P1', pg: 5, raw: '', t: 'Alpha fallback text.' }],
      aiChunks: [{ pages: [5], text: `--- PAGE 5 ---\n${denseBody}` }],
    }
    let live = 0
    let peak = 0
    const f = (async (_u: string, init: RequestInit) => {
      peak = Math.max(peak, ++live)
      await new Promise((r) => setTimeout(r, 15))
      live--
      const user = JSON.parse(init.body as string).messages[1].content as string
      const blocks = []
      if (user.includes('B0|')) blocks.push({ type: 'para', text: 'Alpha line 0 with enough words here.' })
      if (user.includes('B1|')) blocks.push({ type: 'para', text: 'Beta line 0 with enough words here.' })
      if (user.includes('B2|')) blocks.push({ type: 'para', text: 'Gamma line 0 with enough words here.' })
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ blocks }) } }] }))
    }) as unknown as typeof fetch
    const res = await rebuildDoc(denseDoc, deps(f))
    expect(peak).toBeGreaterThanOrEqual(2)
    expect(res.donePages).toEqual([5])
    expect(res.paras.map((p) => p.t)).toEqual([
      'Alpha line 0 with enough words here.',
      'Beta line 0 with enough words here.',
      'Gamma line 0 with enough words here.',
    ])
  })

  it('prioritizes current page first, streams progressive updates, and handles 0-rule-para single-page rebuilds', async () => {
    const mkPg = (pg: number, text: string) => `--- PAGE ${pg} ---\n${Array.from({ length: 55 }, (_, i) => `B0|9.0|${i === 0 ? '¶ ' : ''}${text} line ${i}`).join('\n')}`
    const three: DocData = {
      ...doc,
      paras: [
        // Note: page 1 intentionally has 0 ruleParas (e.g., cover/abstract filtered by ruleParas)
        { id: 'u1-P1', pg: 2, raw: '', t: 'Page two rule text is long enough for testing here.' },
        { id: 'u1-P2', pg: 3, raw: '', t: 'Page three rule text is long enough for testing here.' },
      ],
      aiChunks: [
        { pages: [1, 2, 3], text: [mkPg(1, 'Abstract recovered'), mkPg(2, 'Page two body'), mkPg(3, 'Page three body')].join('\n') },
      ],
    }
    const order: number[] = []
    const updates: number[][] = []
    const f = (async (_u: string, init: RequestInit) => {
      const user = JSON.parse(init.body as string).messages[1].content as string
      const pg = Number(/--- PAGE (\d+) ---/.exec(user)![1])
      order.push(pg)
      const txt = pg === 1 ? 'Abstract recovered line 0' : pg === 2 ? 'Page two body line 0' : 'Page three body line 0'
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ blocks: [{ type: 'para', text: txt }] }) } }] }))
    }) as unknown as typeof fetch

    // 1. Priority ordering + live onUpdate streaming
    const full = await rebuildDoc(three, {
      ...deps(f),
      concurrency: 1,
      priorityPages: [2],
      onUpdate: (_paras, done) => updates.push([...done]),
    })
    expect(order).toEqual([2, 3, 1])
    expect(updates).toEqual([[2], [2, 3], [1, 2, 3]])
    expect(full.donePages).toEqual([1, 2, 3])
    expect(full.paras.map((p) => p.pg)).toEqual([1, 2, 3])

    // 2. Single-page rebuild on page 1 (which had 0 ruleParas!) inserts in page order instead of dropping
    const base = three.paras.map((p) => ({ ...p, fb: true }))
    const partial = await rebuildDoc(three, { ...deps(f), retryPages: [1], base })
    expect(partial.donePages).toEqual([1])
    expect(partial.paras.map((p) => p.pg)).toEqual([1, 2, 3])
    expect(partial.paras[0].t).toBe('Abstract recovered line 0')
    expect(partial.paras[0].fb).toBeUndefined()
    expect(partial.paras[1].fb).toBe(true)

    // 3. Scope tracking helpers accurately distinguish rebuilt vs pending pages
    const partialDoc: DocData = { ...three, parasAI: partial.paras, aiDone: partial.donePages }
    expect(pendingPdfPages(partialDoc)).toEqual([2, 3])
    expect(pageRangeLabel([2, 3])).toBe('p.2–3')
    expect(pageRangeLabel([5])).toBe('p.5')
    expect(rebuildPlan(three, [2]).map((c) => c.pages)).toEqual([[2]])
  })

  it('rejoins mid-sentence quotes across pages, keeps variable lead letters, and batches 36-line book pages', () => {
    expect(stripLead('Y here is not a measure of value-added output (like GDP); it is gross output.')).toBe(
      'Y here is not a measure of value-added output (like GDP); it is gross output.',
    )
    const pg33 = { n: 33, w: 441, h: 666, items: [] }
    const pg34 = { n: 34, w: 441, h: 666, items: [] }
    const rules = ruleParas(
      [
        [{ col: 'B1', y: 84, x: 69, w: 312, fs: 12, text: 'One challenge is turning nominal measures of activities into “real”' }],
        [{ col: 'B1', y: 594, x: 60, w: 312, fs: 12, text: 'terms or volume terms measures by deflating with a price index.' }],
      ],
      [pg33, pg34],
      12,
    )
    expect(rules).toHaveLength(1)
    expect(rules[0].t).toBe('One challenge is turning nominal measures of activities into “real” terms or volume terms measures by deflating with a price index.')

    // Two contiguous 36-line book pages merge into 1 chunk (<= 78), while non-contiguous pages stay separate
    const mkBook = (pg: number) => `--- PAGE ${pg} ---\n${Array.from({ length: 36 }, (_, i) => `B0|12.0|Book line ${pg}-${i}`).join('\n')}`
    const bookChunks = pageChunks([{ pages: [1, 2, 3, 4], text: [mkBook(1), mkBook(2), mkBook(3), mkBook(4)].join('\n') }])
    expect(bookChunks.map((c) => c.pages)).toEqual([[1, 2], [3, 4]])
    const nonContig = pageChunks([
      { pages: [1], text: mkBook(1) },
      { pages: [5], text: mkBook(5) },
    ])
    expect(nonContig.map((c) => c.pages)).toEqual([[1], [5]])
  })

  it('distinguishes short text PDFs from multi-page scanned PDFs with page numbers', () => {
    const mk = (texts: string[]) => ({ items: texts.map((s) => ({ s, x: 0, y: 0, w: 10, h: 12, fs: 12 })) })
    expect(isScannedPages([])).toBe(true)
    expect(isScannedPages([mk(['Brief glossary note.'])])).toBe(false)
    expect(isScannedPages([mk(['   ', '---'])])).toBe(true)
    expect(isScannedPages([mk(['1']), mk(['2']), mk(['3']), mk(['4']), mk(['Page 5'])])).toBe(true)
    const body = 'A full book paragraph with plenty of readable words on the page.'
    expect(isScannedPages([mk(['Title']), mk([body]), mk([body]), mk([body]), mk([body])])).toBe(false)
  })
})
