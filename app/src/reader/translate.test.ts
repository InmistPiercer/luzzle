import { describe, expect, it } from 'vitest'
import type { Para } from '../core/types'
import { dropPdf } from '../storage/migrate'
import { emptyUsage } from '../ai/client'
import type { Item } from './paginate'
import { batchParagraphs, pendingBatches, pendingChunks, srcOf, translateChunks, trKey } from './translate'

const para = (id: string, t: string, kind?: Para['kind']): Item => ({ kind: 'p', p: { id, t, kind }, i: 0 })
const pages: Item[][] = [[para('a', 'First page.'), para('c', 'x = 1', 'code')], [para('b', 'Second ⟦1⟧ page.')], [para('d', 'Third page.')]]

const fake = (answer: (texts: string[]) => unknown) => {
  const calls: string[][] = []
  const f = (async (_: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    const texts = JSON.parse(body.messages[1].content) as string[]
    calls.push(texts)
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer(texts)) } }] }))
  }) as unknown as typeof fetch
  return { f, calls }
}

const deps = (f: typeof fetch, saved: number[]) => ({
  ai: { provider: 'openai' as const, baseUrl: '', apiKey: 'k', model: '', dailyLimit: 30, budget: 0, cur: 'CNY' as const },
  call: { today: 'd', usage: () => emptyUsage('d'), record: () => saved.push(1), fetch: f },
})

describe('full-text translation', () => {
  it('queues untranslated pages from the current one and skips code', () => {
    const done = { [trKey('Third page.')]: '第三页。' }
    expect(pendingChunks(pages, 1, done)).toEqual([['Second page.'], ['First page.']])
    expect(srcOf(pages[1][0].p)).toBe('Second page.')
  })

  it('translates page by page, counts each request and retries bad replies', async () => {
    let bad = true
    const { f, calls } = fake((texts) => {
      if (bad && texts[0] === 'Second page.') {
        bad = false
        return { t: [] }
      }
      return { t: texts.map((x) => `译:${x}`) }
    })
    const got: Record<string, string> = {}
    const saved: number[] = []
    const failed = await translateChunks(pendingChunks(pages, 0, {}), deps(f, saved), (g) => Object.assign(got, g), () => false)
    expect(failed).toBe(0)
    expect(calls).toHaveLength(4)
    expect(got[trKey('Second page.')]).toBe('译:Second page.')
    expect(saved).toHaveLength(4)
  })

  it('stops before starting further pages', async () => {
    const { f, calls } = fake((texts) => ({ t: texts }))
    await translateChunks(pendingChunks(pages, 0, {}), deps(f, []), () => undefined, () => true)
    expect(calls).toHaveLength(0)
  })

  it('drops stored PDF originals from old docs', () => {
    expect(dropPdf({ id: 'x', pdf: { fileId: 'f' } })).toEqual({ id: 'x' })
  })

  it('splits multi-paragraph pages with a solo fast-first paragraph and preserves page counts', () => {
    expect(batchParagraphs(['P1', 'P2', 'P3', 'P4'], true)).toEqual([['P1'], ['P2', 'P3'], ['P4']])
    const multi: Item[][] = [[para('p1', 'One.'), para('p2', 'Two.'), para('p3', 'Three.')], [para('p4', 'Four.'), para('p5', 'Five.')]]
    const b = pendingBatches(multi, 0, {})
    expect(b.pages).toBe(2)
    expect(b.chunks).toEqual([['One.'], ['Two.', 'Three.'], ['Four.', 'Five.']])
    expect(b.pageCounts).toEqual([0, 1, 1])
  })
})
