import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createDict } from './dict'

const dict = createDict(async (l) => JSON.parse(await readFile(new URL(`../../public/dict/${l}.json`, import.meta.url), 'utf8')))

describe('dict', () => {
  it('looks up entries with exchange data', async () => {
    const e = await dict.lookup('Sustain')
    expect(e?.translation[0]).toContain('承受')
    expect(e?.exchange.p).toBe('sustained')
  })

  it('exposes the base form of participial adjectives', async () => {
    expect(await dict.baseOf('isolated')).toBe('isolate')
    expect(await dict.lookup('zzzzq')).toBeNull()
  })
})
