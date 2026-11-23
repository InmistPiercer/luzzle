import { describe, expect, it } from 'vitest'
import type { DocData } from '../core/types'
import { pageOfPara, paginate } from './paginate'

const para = (id: string, n: number) => ({ id, pg: 1, raw: '', t: Array(n).fill('word').join(' ') })
const doc: DocData = {
  id: 'x',
  title: 'X',
  vault: 0,
  rebuilt: true,
  cachedRebuilt: true,
  paras: [para('a', 200), para('b', 200), { h: 'Part' }, para('c', 300), para('d', 900), para('e', 10)],
}

describe('paginate', () => {
  it('fills pages without splitting paragraphs and keeps headings with the next paragraph', () => {
    const pages = paginate(doc, 'mid')
    expect(pages.map((pg) => pg.map((it) => (it.kind === 'h' ? 'H' : it.p.id)).join(''))).toEqual(['ab', 'Hc', 'd', 'e'])
    expect(pageOfPara(pages, 'd')).toBe(2)
  })

  it('can turn pagination off', () => {
    expect(paginate(doc, 'none')).toHaveLength(1)
    expect(paginate(doc, 'short').length).toBeGreaterThan(paginate(doc, 'long').length)
  })
})
