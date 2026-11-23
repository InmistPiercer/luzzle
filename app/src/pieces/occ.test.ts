import { describe, expect, it } from 'vitest'
import { condense } from './condense'

describe('condense', () => {
  it('keeps short sentences whole and highlights the target', () => {
    const c = condense('Habits form slowly.', ['habit'])
    expect(c.cutL || c.cutR).toBe(false)
    expect(c.parts.find((p) => p.hit)?.t).toBe('Habits')
  })

  it('trims long sentences around the target and drops citations', () => {
    const s = 'In the long and winding history of the many statistical offices across the world ⟦(Li et al., 2021)⟧ the measure of output was refined again and again until economists finally agreed on a single sustained definition of growth that everyone could use.'
    const c = condense(s, ['sustain'], ['sustained'])
    expect(c.cutL).toBe(true)
    expect(c.parts.map((p) => p.t).join('')).not.toContain('⟦')
    expect(c.parts.find((p) => p.hit)?.t).toBe('sustained')
  })
})
