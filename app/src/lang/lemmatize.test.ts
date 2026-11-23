import { describe, expect, it } from 'vitest'
import { guessPosBySuffix, lemmatize, participleAsAdj, phraseHead } from './lemmatize'

describe('lemmatize', () => {
  it('reduces inflections to the lemma (PRD 验收 7)', () => {
    expect(['habits', 'sustained', 'formed', 'undone', 'chasing'].map(lemmatize)).toEqual(['habit', 'sustain', 'form', 'undo', 'chase'])
    expect(['rewards', 'erodes', 'cheaper'].map(lemmatize)).toEqual(['reward', 'erode', 'cheap'])
  })

  it('reduces participles to the verb and decides adjectives from context', () => {
    expect(['tempting', 'isolated', 'relaxing'].map(lemmatize)).toEqual(['tempt', 'isolate', 'relax'])
    expect(guessPosBySuffix('isolated')).toBe('adj.')
    const s = (t: string) => t.split(' ')
    expect(participleAsAdj(s('Inspired by the brain'), 0)).toBe(false)
    expect(participleAsAdj(s('it was inspired by music'), 2)).toBe(false)
    expect(participleAsAdj(s('Even a relaxing evening'), 2)).toBe(true)
    expect(participleAsAdj(s('It is tempting to take'), 2)).toBe(true)
    expect(participleAsAdj(s('a very inspired choice'), 2)).toBe(true)
    expect(participleAsAdj(s('she has relaxed a lot'), 2)).toBe(false)
  })

  it('picks the content word as phrase head', () => {
    expect(phraseHead(['take', 'for', 'granted'])).toBe('grant')
    expect(phraseHead(['keep', 'faith', 'with'])).toBe('faith')
    expect(phraseHead(['rather', 'than'])).toBe('rather')
  })
})
