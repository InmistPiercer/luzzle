import { describe, expect, it } from 'vitest'
import { DEMO_ENTRIES } from '../content/demo'
import { seedDemo } from '../content/seed'
import { addOccurrence, createPiece, entryFromSurface } from '../learn/pieces'
import { setExamples, tokenFor } from '../lang/examples'
import { setSenseData } from '../lang/senses'
import { confOf, freshSentence, localJudge, maskParts, matchesForm, matchesWord, meaningChoices, meaningOf, senseSentence, stableRows, todayDone, wordDefOf } from './logic'

const d = seedDemo('2026-11-14')

describe('forge logic', () => {
  it('uses the entry meanings and confusables', () => {
    expect(meaningChoices(d, 'erode').opts[0]).toBe('逐渐削弱，消磨')
    expect(meaningOf(d.pieces.erode, 'en')).toBe('to gradually wear away or diminish something abstract')
    const enChoices = meaningChoices(d, 'erode', 'en')
    expect(enChoices.opts).toHaveLength(3)
    expect(enChoices.opts.every((o) => !/[\u4e00-\u9fff]/.test(o))).toBe(true)
    expect(confOf(d, 'erode').opts).toEqual(['erode', 'corrode', 'erase'])
    expect(wordDefOf(d.pieces.deliberate, 'en')).toBe('done consciously and intentionally')
    expect(wordDefOf(d.pieces.deliberate, 'zh')).toBe('有意识的，刻意的')
    expect(wordDefOf({ ...d.pieces.deliberate, sid: 'deliberate#1', gloss: '故意的' }, 'zh')).toBe('故意的')
    expect(wordDefOf(d.pieces.deliberate, 'en')).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('masks the sentence form', () => {
    expect(maskParts('It will erode the patience.', 'erode')).toEqual(['It will ', ' the patience.'])
    expect(maskParts('No match here.', 'erode')).toEqual(['No match here. ', ''])
  })

  it('accepts inflections for words but not for phrases', () => {
    expect(matchesWord(d.pieces.erode, 'erodes')).toBe(true)
    expect(matchesWord(d.pieces.granted, 'grant')).toBe(false)
    expect(matchesWord(d.pieces.granted, 'granted')).toBe(true)
  })

  it('judges learner sentences locally', () => {
    expect(localJudge(d, 'habit', 'habit is good')).toBe('至少 5 个词')
    expect(localJudge(d, 'habit', 'I walk to school every day')).toBe('需包含 habit')
    expect(localJudge(d, 'habit', 'Reading before bed became a habit for my sister')).toBe('')
  })

  it('names the owner of a wrong meaning and avoids English options', () => {
    const m = createPiece(d, 'memory', entryFromSurface('memory', 'Memory fades.'), '生词初见', { pid: null, wi: null, doc: '', s: 'Memory fades.' })
    const c = meaningChoices(m, 'memory')
    expect(c.opts.every((o) => /[\u4e00-\u9fff]/.test(o) && !/[A-Za-z]/.test(o))).toBe(true)
    expect(Object.values(c.owner).length).toBeGreaterThan(0)
  })

  it('prefers other occurrences or alternative sentences as new sentences', () => {
    const one = freshSentence(d, 'habit', 'x')
    expect(one.fresh).toBe(true)
    const m = createPiece(d, 'memory', entryFromSurface('memory', 'Memory fades.'), '生词初见', { pid: null, wi: null, doc: '', s: 'Memory fades.' })
    expect(freshSentence(m, 'memory', 'x')).toEqual({ s: 'Memory fades.', fresh: false })
  })

  it('falls back to bundled examples and masks the inflected form', () => {
    setExamples({ inspire: ['She was inspired by her teacher.'] })
    const m = createPiece(d, 'inspire', entryFromSurface('inspire', 'Art can inspire us.'), '生词初见', { pid: null, wi: null, doc: '', s: 'Art can inspire us.' })
    expect(freshSentence(m, 'inspire', 'x')).toEqual({ s: 'She was inspired by her teacher.', fresh: false, form: 'inspired' })
    expect(freshSentence(m, 'inspire', 'x', false).fresh).toBe(false)
    expect(tokenFor('Inspiration matters, and he inspires us.', 'inspire')).toBe('inspires')
    expect(tokenFor('They stopped early.', 'stop')).toBe('stopped')
    expect(tokenFor('A useful user.', 'use')).toBe(null)
  })

  it('requires the form from the sentence for a fill answer', () => {
    expect(matchesForm('run', ['runs'])).toBe(false)
    expect(matchesForm('runs', ['Runs'])).toBe(true)
  })

  it('keeps a different-sense AI example out of the main recall pool', () => {
    const m = createPiece(d, 'crane', { lemma: 'crane', form: 'crane', tile: '鹤', alt: [{ s: 'A ___ lifted the beam.', a: ['crane'], k: 2 }] }, '生词初见', { pid: null, wi: null, doc: '', s: 'The crane stood by the pond.' })
    expect(freshSentence(m, 'crane', 'x', false)).toEqual({ s: 'The crane stood by the pond.', fresh: false })
  })

  it('uses inflected occurrence form for phrase pieces and masks it in place', () => {
    const p = createPiece(
      d,
      'keep_faith',
      { ...DEMO_ENTRIES.keep_faith, form: 'keep faith with' },
      '词族关联',
      { pid: 'P1', wi: 1, doc: 'D', s: 'They keep faith with allies.' },
    )
    const next = addOccurrence(p, 'keep_faith', {
      pid: 'P2',
      wi: 1,
      doc: 'D',
      s: 'She kept faith with her promise.',
      form: 'kept faith with',
    })
    const res = freshSentence(next, 'keep_faith', 'x')
    expect(res).toEqual({ s: 'She kept faith with her promise.', form: 'kept faith with', fresh: true })
    expect(maskParts(res.s, res.form!)).toEqual(['She ', ' her promise.'])
  })

  it('deduplicates sentences by normalized text in freshSentence and senseSentence', () => {
    setSenseData({
      scale: [
        [
          'scale#1',
          'n.',
          1,
          '规模',
          '事物的大小或程度',
          'size',
          'the size of something',
          'The plan works at a small [[scale]].',
          '  the plan works at a small [[scale]]. ',
        ],
        ['scale#2', 'n.', 1, '刻度', '测量刻度', 'measure', 'a mark for measuring', 'Check the [[scale]] carefully.', ''],
      ],
    })
    const m = createPiece(
      d,
      'scale',
      {
        lemma: 'scale',
        pos: 'n.',
        sid: 'scale#1',
        gloss: '规模',
        tile: '规模',
        en: 'the size of something',
        ens: 'size',
        senses: ['n. 规模', 'n. 刻度'],
        alt: [{ s: 'The plan works at a small ___.', a: ['scale'] }],
      },
      '生词初见',
      { pid: 'P1', wi: 0, doc: 'D', s: 'The plan works at a small scale.' },
    )
    expect(freshSentence(m, 'scale', 'a', false)).toEqual({ s: 'The plan works at a small scale.', fresh: false })
    expect(senseSentence(m, 'scale', 'a')).toEqual({ s: 'The plan works at a small scale.', fresh: false, k: 1 })
    setSenseData({
      scale: [
        [
          'scale#1',
          'n.',
          1,
          '规模',
          '事物的大小或程度',
          'size',
          'the size of something',
          'Nobody expected a disaster on this [[scale]].',
          'Big [[scale]] projects require careful planning.',
        ],
        ['scale#2', 'n.', 1, '刻度', '测量刻度', 'measure', 'a mark for measuring', 'Check the [[scale]] carefully.', ''],
      ],
    })
    const picked = new Set(
      ['recallNew|0', 'fill|0', 'recallNew|1', 'fill|1', 'recallNew|2', 'fill|2', 'recallNew|3', 'fill|3'].map(
        (tag) => freshSentence(m, 'scale', `scale|2026-11-14|${tag}`).s,
      ),
    )
    expect(picked.size).toBe(2)
    setSenseData({})
  })
})

describe('today list', () => {
  const T = '2026-11-14'
  const rec = (last: string, goal: 'read' | 'use' | 'stash' = 'read') => ({ goal, sched: { last }, form: undefined }) as never
  it('keeps answered rows as done and leaves failed ones in the queue', () => {
    const learn = { a: rec(T), b: rec(T), c: rec('2026-11-13'), d: rec(T, 'stash'), e: rec(T) }
    expect(todayDone(learn, T, ['c', 'b'], new Set(['b']))).toEqual(['a', 'e'])
  })
  it('keeps row positions stable while items move between done and queue', () => {
    const first = stableRows([], [], ['a', 'b', 'c'])
    expect(first).toEqual(['a', 'b', 'c'])
    const afterWrong = stableRows(first, [], ['b', 'c', 'a'])
    expect(afterWrong).toEqual(['a', 'b', 'c'])
    const afterRight = stableRows(afterWrong, ['b'], ['c', 'a'])
    expect(afterRight).toEqual(['a', 'b', 'c'])
    expect(stableRows(afterRight, ['b'], ['a'])).toEqual(['a', 'b'])
    expect(stableRows([], ['x', 'y'], ['z'])).toEqual(['x', 'y', 'z'])
  })
})
