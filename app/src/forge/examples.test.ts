import { describe, expect, it } from 'vitest'
import { boardExample, exampleParts } from '../board/BoardDetail'
import { emptyState } from '../core/types'
import { setExamples } from '../lang/examples'
import { setSenseData } from '../lang/senses'
import { morphVocabSentence } from '../morph/actions'

describe('example sentence improvements', () => {
  it('prefers senses ex1 over Tatoeba examples in morphVocabSentence', () => {
    setSenseData({
      sabbatical: [['sabbatical#1', 'n.', 1, '休假', '长期带薪休假', 'long leave', 'extended paid break', 'She took a [[sabbatical]] to finish her research.', '']],
    })
    setExamples({ sabbatical: ['He spent his sabbatical in Kyoto.'] })
    const d = emptyState()
    expect(morphVocabSentence(d, 'sabbatical')).toBe('She took a sabbatical to finish her research.')
    expect(morphVocabSentence(d, 'sabbatical', 'Context sentence sabbatical here.')).toBe('Context sentence sabbatical here.')
    setSenseData({
      sabbatical: [['sabbatical#1', 'n.', 1, '休假', '长期带薪休假', 'long leave', 'extended paid break', 'No target token here.', '']],
    })
    expect(morphVocabSentence(d, 'sabbatical')).toBe('He spent his sabbatical in Kyoto.')
    setSenseData({})
    setExamples({})
  })

  it('extracts current sense or phrase ex1 and splits [[...]] highlights for BoardDetail', () => {
    setSenseData(
      {
        scale: [['scale#1', 'n.', 1, '规模', '事物的大小或程度', 'size', 'extent', 'Nobody expected a disaster on this [[scale]].', '']],
      },
      {},
      {
        'tack … on': ['tack', 'tack#3', '附加', '额外加上某物', 'add extra', 'include extra', 'Companies often [[tack]] hidden charges [[on]] to the bill.'],
      },
    )
    expect(boardExample({ lemma: 'scale', pos: 'n.', sid: 'scale#1' })).toBe('Nobody expected a disaster on this [[scale]].')
    expect(boardExample({ lemma: 'scale', pos: 'n.', sid: '' })).toBe('')
    expect(boardExample({ lemma: 'tack … on', pos: 'phrase' })).toBe('Companies often [[tack]] hidden charges [[on]] to the bill.')
    expect(exampleParts('Companies often [[tack]] hidden charges [[on]] to the bill.')).toEqual([
      { t: 'Companies often ', hit: false },
      { t: 'tack', hit: true },
      { t: ' hidden charges ', hit: false },
      { t: 'on', hit: true },
      { t: ' to the bill.', hit: false },
    ])
    expect(exampleParts('')).toEqual([])
    setSenseData({}, {}, {})
  })
})
