import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import { entryFromSurface } from '../learn/pieces'
import { lemmatize, participialOf, participleAsAdj, posGuess } from './lemmatize'
import { dictPeek, glossLines, loadDictAll, phOf, sensesOf, setDictLoader } from './lexdict'

beforeAll(async () => {
  setDictLoader(async (l) => JSON.parse(await readFile(new URL(`../../public/dict/${l}.json`, import.meta.url), 'utf8')))
  await loadDictAll()
})

describe('built-in dictionary', () => {
  it('parses senses and phonetics', () => {
    const e = dictPeek('metropolitan')
    expect(sensesOf(e).map((s) => s.pos)).toEqual(['n.', 'adj.'])
    expect(glossLines(e)[1]).toMatch(/^a\. 大都市的/)
    expect(phOf(e)).toBe('/ˌmetrəˈpɒlitn/')
  })

  it('lemmatizes through exchange data', () => {
    expect(lemmatize('studies')).toBe('study')
    expect(lemmatize('statistics')).toBe('statistics')
    expect(participialOf('interested')?.base).toBe('interest')
    expect(lemmatize('interested')).toBe('interest')
    expect(participialOf('evening')).toEqual({ base: 'even', pos: 'n.' })
    expect(participleAsAdj(['Even', 'a', 'relaxing', 'evening', 'can'], 3, 'n.')).toBe(true)
    expect(participleAsAdj(['He', 'is', 'running', 'fast'], 2, 'n.')).toBe(false)
  })

  it('builds pieces with dictionary senses and pos', () => {
    const e = entryFromSurface('statistical', 'Statistical offices measure output.')
    expect(e).toMatchObject({ lemma: 'statistical', pos: 'adj.', tile: '统计的' })
    expect(e.dict?.[0]).toMatch(/统计的/)
    expect(posGuess('metropolitan')).toBe('n.')
    expect(entryFromSurface('metropolitan', '', { pos: 'adj.' }).tile).toBe('大都市的')
  })
})
