import { beforeEach, describe, expect, it } from 'vitest'
import { useApp } from '../app/store'
import { seedDemo } from '../content/seed'
import type { UserDoc } from '../core/types'
import { annPhraseParts, annPhrasePreview, annToPhrase, phraseWordLemma, togglePickWord, useReader } from './session'
import { phraseSpans, sentencesByWord, tokenize } from './text'

const P1_TEXT = 'It is tempting to take this shift for granted, as if habits formed in a decade could not be undone in another. Even a relaxing evening can be sustained by deliberate practice rather than by good intentions.'
const P2_TEXT = 'A system that rewards speed will erode patience. One two three four five six seven eight nine ten.'

const DOC: UserDoc = {
  id: 'doc-pick',
  vault: 0,
  title: 'Pick Test',
  rebuilt: false,
  cachedRebuilt: false,
  paras: [
    { id: 'p1', t: P1_TEXT },
    { id: 'p2', t: P2_TEXT },
  ],
}

const normOf = (t: string) => tokenize(t).filter((x) => x.w).map((x) => x.w as string)

describe('discontinuous phrase picking & lemmatization', () => {
  beforeEach(() => {
    const base = seedDemo('2026-11-23')
    delete base.learn.granted
    delete base.pieces.granted
    useApp.setState({
      data: { ...base, curVault: 0, docs: [DOC] },
      toast: { msg: '', seq: 0 },
      update: (fn) => useApp.setState((s) => ({ data: fn(s.data) })),
    })
    useReader.setState({ cur: DOC.id, sel: null, po: false, ctx: false, ann: null, askHead: null, askNew: false })
  })

  it('builds gap parts, lemmatizes inflections, collapses adjacent skips, trims ends, and tracks maxGap', () => {
    const words = normOf(P1_TEXT)
    const iFormed = words.indexOf('formed')
    const iDecade = words.indexOf('decade')
    const p1 = annPhraseParts(
      { pid: 'p1', w0: iFormed, w1: iDecade, wis: [iFormed, iFormed + 1, iFormed + 2, iDecade], words: ['formed', 'in', 'a', 'decade'], hl: 'y', skip: [iFormed + 1, iFormed + 2] },
      words,
    )
    expect(p1).toMatchObject({
      parts: ['formed', '…', 'decade'],
      text: 'formed … decade',
      lemmaParts: ['form', '…', 'decade'],
      lemma: 'form … decade',
      members: ['form', 'decade'],
      hasGap: true,
      maxGap: 2,
    })

    const p2 = annPhraseParts({
      pid: 'p1',
      w0: 0,
      w1: 5,
      wis: [0, 1, 2, 3, 4, 5],
      words: ['It', 'rewards', 'the', 'fast', 'speed', 'now'],
      hl: 'y',
      skip: [0, 2, 3, 5],
    })
    expect(p2).toMatchObject({ parts: ['rewards', '…', 'speed'], lemma: 'reward … speed', hasGap: true, maxGap: 2 })

    const p3 = annPhraseParts({ pid: 'p2', w0: 0, w1: 8, wis: [0, 1, 2, 3, 4, 5, 6, 7, 8], words: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], hl: 'y', skip: [1, 2, 3, 4, 5, 6, 7] })
    expect(p3.maxGap).toBe(7)
  })

  it('preserves participial adjectives, passive participles after be, and possessive s', () => {
    const words = normOf(P1_TEXT)
    const iRelaxing = words.indexOf('relaxing')
    const iEvening = words.indexOf('evening')
    expect(annPhraseParts({ pid: 'p1', w0: iRelaxing, w1: iEvening, wis: [iRelaxing, iEvening], words: ['relaxing', 'evening'], hl: 'y' }, words).lemma).toBe('relaxing evening')

    const iIs = words.indexOf('is')
    expect(annPhraseParts({ pid: 'p1', w0: iIs, w1: iIs + 2, wis: [iIs, iIs + 1, iIs + 2], words: ['is', 'tempting', 'to'], hl: 'y' }, words).lemma).toBe('be tempting to')

    const iBe = words.indexOf('be')
    const iUndone = words.indexOf('undone')
    expect(annPhraseParts({ pid: 'p1', w0: iBe, w1: iUndone, wis: [iBe, iUndone], words: ['be', 'undone'], hl: 'y' }, words).lemma).toBe('be undone')

    expect(phraseWordLemma("snail's", 2, ['at', 'a', "snail's", 'pace'], 'a')).toBe("snail's")
  })

  it('supports cmd/ctrl multi-word picking within a sentence and enforces gap/count limits', () => {
    const words = normOf(P1_TEXT)
    const iSustained = words.indexOf('sustained')
    const iPractice = words.indexOf('practice')
    togglePickWord('p1', iSustained)
    expect(useReader.getState().ann).toMatchObject({ pid: 'p1', wis: [iSustained], words: ['sustained'], pickOnly: true })

    togglePickWord('p1', iPractice)
    expect(useReader.getState().ann).toMatchObject({ pid: 'p1', wis: [iSustained, iPractice], words: ['sustained', 'practice'], pickOnly: true })

    togglePickWord('p1', iSustained)
    expect(useReader.getState().ann).toMatchObject({ pid: 'p1', wis: [iPractice], words: ['practice'] })

    togglePickWord('p1', iSustained)
    expect(useReader.getState().ann?.wis).toEqual([iSustained, iPractice])

    togglePickWord('p1', 0)
    expect(useReader.getState().ann?.wis).toEqual([0])

    const p2Words = normOf(P2_TEXT)
    const iOne = p2Words.indexOf('One')
    togglePickWord('p2', iOne)
    togglePickWord('p2', iOne + 8)
    expect(useApp.getState().toast.msg).toBe('词间距过远')
    expect(useReader.getState().ann?.wis).toEqual([iOne])
  })

  it('creates a lemmatized discontinuous phrase and underlines only non-skipped words', () => {
    const words = normOf(P1_TEXT)
    const iSustained = words.indexOf('sustained')
    const iPractice = words.indexOf('practice')
    togglePickWord('p1', iSustained)
    togglePickWord('p1', iPractice)
    expect(annPhrasePreview(useApp.getState().data, useReader.getState().ann!).preview).toBe('sustain … practice')
    annToPhrase()

    const d = useApp.getState().data
    const id = 'ph_sustain_gap_practice'
    expect(d.pieces[id]).toMatchObject({
      lemma: 'sustain … practice',
      form: 'sustained … practice',
      pos: 'phrase',
      members: ['sustain', 'practice'],
      ans: 'sustain practice',
    })
    expect(d.learn[id]).toBeDefined()

    const spans = phraseSpans(d, words, 'p1', sentencesByWord(P1_TEXT))
    expect(spans[iSustained]).toBe(id)
    expect(spans[iSustained + 1]).toBeUndefined()
    expect(spans[iSustained + 2]).toBeUndefined()
    expect(spans[iPractice]).toBe(id)
  })

  it('matches an existing built-in discontinuous phrase in both preview and save', () => {
    const words = normOf(P1_TEXT)
    togglePickWord('p1', words.indexOf('take'))
    togglePickWord('p1', words.indexOf('for'))
    togglePickWord('p1', words.indexOf('granted'))
    expect(annPhrasePreview(useApp.getState().data, useReader.getState().ann!).preview).toBe('take … for granted')
    annToPhrase()

    const d = useApp.getState().data
    expect(d.learn.granted).toBeDefined()
    expect(d.pieces.granted?.lemma).toBe('take … for granted')
  })

  it('creates a lemmatized phrase from chip skips or continuous drag and rejects cross-sentence spans', () => {
    const words = normOf(P1_TEXT)
    const iFormed = words.indexOf('formed')
    const iDecade = words.indexOf('decade')
    useReader.setState({
      ann: {
        pid: 'p1',
        w0: iFormed,
        w1: iDecade,
        wis: [iFormed, iFormed + 1, iFormed + 2, iDecade],
        words: ['formed', 'in', 'a', 'decade'],
        hl: 'y',
        skip: [iFormed + 1, iFormed + 2],
      },
    })
    annToPhrase()
    expect(useApp.getState().data.pieces.ph_form_gap_decade).toMatchObject({
      lemma: 'form … decade',
      form: 'formed … decade',
      members: ['form', 'decade'],
    })

    const p2Words = normOf(P2_TEXT)
    const iRewards = p2Words.indexOf('rewards')
    useReader.setState({
      ann: {
        pid: 'p2',
        w0: iRewards,
        w1: iRewards + 1,
        wis: [iRewards, iRewards + 1],
        words: ['rewards', 'speed'],
        hl: 'y',
      },
    })
    expect(annPhrasePreview(useApp.getState().data, useReader.getState().ann!).preview).toBe('reward speed')
    annToPhrase()
    expect(useApp.getState().data.pieces.ph_reward_speed).toMatchObject({
      lemma: 'reward speed',
      form: 'rewards speed',
      members: ['reward', 'speed'],
    })

    const iAnother = words.indexOf('another')
    useReader.setState({
      ann: {
        pid: 'p1',
        w0: iAnother,
        w1: iAnother + 1,
        wis: [iAnother, iAnother + 1],
        words: ['another', 'Even'],
        hl: 'y',
      },
    })
    annToPhrase()
    expect(useApp.getState().toast.msg).toBe('短语不能跨句')
  })
})
