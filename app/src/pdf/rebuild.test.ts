import { describe, expect, it, vi } from 'vitest'
import type { DocData } from '../core/types'
import { tokenize } from '../reader/text'
import { mergeCont, rebuildDoc, pageChunks, pool } from './rebuild'
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

import { faithful as ok, words as ws } from './extract'
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
