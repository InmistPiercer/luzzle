import { describe, expect, it } from 'vitest'
import { parseTextDoc } from './importDoc'

describe('parseTextDoc', () => {
  it('reads a markdown title, headings and paragraphs', () => {
    const d = parseTextDoc('# Title\n\nFirst line\nwraps here.\n\n## Part two\n\nSecond.', 'x.md', 1, 1)
    expect(d.title).toBe('Title')
    expect(d.vault).toBe(1)
    expect(d.paras).toEqual([
      { id: 'u1-P2', raw: '', t: 'First line wraps here.' },
      { h: 'Part two' },
      { id: 'u1-P4', raw: '', t: 'Second.' },
    ])
  })

  it('falls back to the file name', () => {
    expect(parseTextDoc('Hello.', 'notes.txt', 0, 1).title).toBe('notes')
  })

  it('keeps text immediately after title and heading lines', () => {
    const d = parseTextDoc('# Title\nOpening.\n\n## Part\nMore.', 'x.md', 0, 1)
    expect(d.paras.map((p) => p.t || p.h)).toEqual(['Opening.', 'Part', 'More.'])
  })

  it('handles UTF-8 BOM and consumes only the first H1 as title', () => {
    const d = parseTextDoc('\uFEFF# First Title\nOpening body line.\n\n# Second Section\nSecond body.', 'bom.md', 0, 1)
    expect(d.title).toBe('First Title')
    expect(d.paras.map((p) => p.t || p.h)).toEqual(['Opening body line.', 'Second Section', 'Second body.'])
  })
})
