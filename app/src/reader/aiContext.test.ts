import { describe, expect, it } from 'vitest'
import { seedDemo } from '../content/seed'
import { createPiece, entryFromSurface } from '../learn/pieces'
import { attachAI, contextPreview, dockAI, isMetaAI, normalizeContextAnswer, occurrenceAI, validContextAnswer } from './aiContext'

const T = '2026-11-14'
const ai = { zh: '迎合，追求', en: 'to try to get', ex: '这里指追求多数读者', tr: '他们并不追逐大众。', st: 'They are not chasing the many', fam: ['pursue 追求'] }

describe('aiContext', () => {
  it('keeps malformed partial fields out of the preview and refuses to cache them as completed answers', () => {
    const partial = { sense: 1, en: { text: 'sample' }, tr: '译文', fam: ['sample', 42] }
    expect(contextPreview(partial)).toEqual({ sense: 1, tr: '译文' })
    expect(validContextAnswer(partial, 'sense')).toBe(false)
    expect(validContextAnswer({ sense: 1, en: 'sample' }, 'sense')).toBe(true)
    expect(validContextAnswer({ sense: 1, en: 'sample' }, 'match')).toBe(false)
  })

  it('normalizes null optional fields, digit-string indices, and metalinguistic answers from real LLMs', () => {
    expect(
      normalizeContextAnswer({ sense: '2', meta: null, zh: '放行', en: 'release', ex: null, fam: null, senses: null }, 'sense'),
    ).toEqual({ sense: 2, zh: '放行', en: 'release' })
    expect(
      normalizeContextAnswer({ sense: null, meta: false, zh: '新义', tr: '译文', reason: null }, 'sense'),
    ).toEqual({ sense: 0, meta: false, zh: '新义', tr: '译文' })
    expect(
      normalizeContextAnswer({ meta: true, zh: '词项讨论', en: 'as a term', reason: null }, 'match'),
    ).toEqual({ match: 0, meta: true, zh: '词项讨论', en: 'as a term' })
    expect(normalizeContextAnswer({ zh: '缺失索引' }, 'sense')).toBeNull()
    expect(normalizeContextAnswer({ sense: 'bad', zh: '无效索引' }, 'sense')).toBeNull()
  })

  it('stores sense on the piece and sentence data on the occurrence', () => {
    const base = createPiece(seedDemo(T), 'chase', entryFromSurface('chasing', 's'), '生词初见', { pid: 'P4-B1', wi: 9, doc: 'D', s: 's' }, T)
    const d = attachAI(base, 'chase', 'P4-B1', ai, true)
    expect(d.pieces.chase.ai).toMatchObject({ zh: '迎合，追求', en: 'to try to get', fam: ['pursue 追求'] })
    expect(d.pieces.chase.tile).toBe('迎合')
    expect(d.learn.chase.occ[0].ai).toEqual({ tr: '他们并不追逐大众。', st: 'They are not chasing the many', ex: '这里指追求多数读者', zh: '迎合，追求' })
    expect(dockAI(d, 'chase', 'P4-B1')).toMatchObject({ zh: '迎合，追求', tr: '他们并不追逐大众。' })
  })

  it('keeps the dictionary sense on the piece and the context meaning on the sentence', () => {
    const base = createPiece(seedDemo(T), 'intensity', entryFromSurface('intensity', 's'), '生词初见', { pid: 'P4-B1', wi: 9, doc: 'D', s: 's' }, T)
    const d = attachAI(base, 'intensity', 'P4-B1', { zh: '灯光强度', en: 'brightness', senses: ['n. 强度', 'n. 强烈，剧烈'], sense: 1 }, true)
    expect(d.pieces.intensity).toMatchObject({ tile: '强度', senses: ['n. 强度', 'n. 强烈，剧烈'], ai: { zh: '强度' } })
    expect(d.learn.intensity.occ[0].ai).toMatchObject({ zh: '灯光强度', sense: 1 })
    expect(dockAI(d, 'intensity', 'P4-B1').zh).toBe('灯光强度')
  })

  it('never overwrites an existing AI sense', () => {
    const d = seedDemo(T)
    const n = attachAI(d, 'erode', 'P3-B1', { ...ai, zh: '别的' }, true)
    expect(n.pieces.erode.ai?.zh).toBe(d.pieces.erode.ai?.zh)
  })

  it('does not leak the first sentence translation into another occurrence', () => {
    const d = seedDemo(T)
    d.learn.habit.occ.push({ pid: 'P13-B1', doc: 'x', s: 'y' })
    expect(occurrenceAI(d, 'habit', 'P3-B2')?.tr).toBeTruthy()
    expect(occurrenceAI(d, 'habit', 'P13-B1')).toBeUndefined()
    expect(dockAI(d, 'habit', 'P13-B1').tr).toBe('')
  })

  it('detects metalinguistic/ambiguous mentions and never overwrites piece gloss with them', () => {
    expect(isMetaAI({ zh: '词义未定/歧义', en: 'Metalinguistic mention; ambiguous meaning' })).toBe(true)
    expect(isMetaAI({ meta: true, zh: '多义并举' })).toBe(true)
    const base = createPiece(seedDemo(T), 'discharge', entryFromSurface('discharge', 's'), '生词初见', { pid: 'PT6-B14', wi: 30, doc: 'D', s: 's' }, T)
    const beforeTile = base.pieces.discharge.tile
    const d = attachAI(base, 'discharge', 'PT6-B14', { meta: true, zh: '词义未定/歧义', en: 'Metalinguistic mention; ambiguous meaning', ex: '该词在此被当作词项讨论', tr: '译文' }, true, 30)
    expect(d.pieces.discharge.tile).toBe(beforeTile)
    expect(d.pieces.discharge.ai?.zh).toBeUndefined()
    expect(d.learn.discharge.occ[0].ai?.ex).toBe('该词在此被当作词项讨论')
  })

})
