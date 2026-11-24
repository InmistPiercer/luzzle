import { describe, expect, it } from 'vitest'
import type { AppState, LearnRecord } from '../core/types'
import { phraseMasked } from '../forge/PhraseCard'
import { setSenseData } from '../lang/senses'
import { newRecord } from './engine'
import { accOf, applyPhrase, blankOf, fallbackPhrases, maskPhrase, phN, phraseFor, phraseGroups, seePhrase, taskOfPhrase } from './phrase'

const D = '2026-11-21'
const rec = (o: Partial<LearnRecord> = {}): LearnRecord => ({ ...newRecord('生词初见', [], D), ...o })
const base = (): Pick<AppState, 'pieces' | 'learn'> => ({
  pieces: {
    c: { id: 'c', lemma: 'grant', childrenIds: ['a', 'b', 'x'] },
    a: { id: 'a', lemma: 'take … for granted', pos: 'phrase', parentId: 'c' },
    b: { id: 'b', lemma: 'grant access', pos: 'phrase', parentId: 'c' },
    x: { id: 'x', lemma: 'grant a wish', pos: 'phrase', parentId: 'c' },
  },
  learn: { c: rec({ stage: 3 }), a: rec(), b: rec(), x: rec() },
})

describe('phrase progress', () => {
  it('maps legacy stages and caps learning at two', () => {
    expect([1, 2, 3, 4, 5].map((s) => phN(rec({ stage: s as 1 })))).toEqual([0, 1, 1, 2, 3])
    const d = base()
    expect(phraseGroups(d, 'c')).toEqual({ learning: ['a', 'b'], pending: ['x'], mastered: [] })
    d.learn.a = rec({ ph: { n: 3 } })
    expect(phraseGroups(d, 'c')).toEqual({ learning: ['b', 'x'], pending: [], mastered: ['a'] })
  })
  it('counts only the first answer of a day and never goes below zero', () => {
    let l = base().learn
    l = applyPhrase(l, 'a', false, D)
    expect(phN(l.a)).toBe(0)
    l = applyPhrase(l, 'a', true, D)
    expect(phN(l.a)).toBe(0)
    l = applyPhrase(l, 'a', true, '2026-11-22')
    expect(phN(l.a)).toBe(1)
    expect(taskOfPhrase(l.a)).toBe('complete')
  })
  it('prefers a phrase seen in reading, then the least progressed', () => {
    const d = base()
    d.learn.a = rec({ ph: { n: 1, last: '2026-11-19' } })
    expect(phraseFor(d, 'c', D)).toBe('b')
    d.learn = seePhrase(d.learn, 'a', '2026-11-20')
    expect(phraseFor(d, 'c', D)).toBe('a')
    d.learn = applyPhrase(d.learn, 'b', true, D)
    expect(phraseFor(d, 'c', D)).toBe('b')
  })
  it('turns phrases of a parent at its goal into at most two daily rows', () => {
    const d = base()
    d.learn.c = rec({ stage: 4, goal: 'read' })
    expect(fallbackPhrases(d, D)).toEqual({ done: [], open: ['a', 'b'] })
    d.learn = applyPhrase(d.learn, 'a', true, D)
    expect(fallbackPhrases(d, D)).toEqual({ done: ['a'], open: ['b'] })
    d.learn.c = rec({ stage: 4, goal: 'use' })
    expect(fallbackPhrases(d, D)).toEqual({ done: [], open: [] })
  })
  it('masks discontinuous phrases, irregular forms, and picks a non-core blank', () => {
    expect(maskPhrase('It is tempting to take this shift for granted, as if…', 'take … for granted')).toBe('It is tempting to ___ this shift ___ ___, as if…')
    expect(maskPhrase('She took that quiet loyalty for granted.', 'take … for granted')).toBe('She ___ that quiet loyalty ___ ___.')
    expect(maskPhrase('She took every single one of those promises for granted.', 'take … for granted')).toBe('She ___ every single one of those promises ___ ___.')
    expect(maskPhrase('They kept faith with the few who finished.', 'keep faith with')).toBe('They ___ ___ ___ the few who finished.')
    expect(maskPhrase('nothing here', 'take … for granted')).toBeNull()
    expect(blankOf('take … for granted', 'grant')).toBe(0)
    expect(blankOf('in short supply', 'supply')).toBe(1)
  })
  it('holds newly mastered phrase on today accessory and fallback list until tomorrow', () => {
    const d = base()
    d.learn.c = rec({ stage: 4, goal: 'read' })
    d.learn.a = rec({ ph: { n: 2, last: '2026-11-20' } })
    d.learn = applyPhrase(d.learn, 'a', true, D)
    expect(accOf(d, ['c'], 'a', D)).toEqual({ det: [3, 0], more: 1, hl: 0 })
    expect(fallbackPhrases(d, D)).toEqual({ done: ['a'], open: ['b'] })
    expect(accOf(d, ['c'], 'a', '2026-11-22')).toEqual({ det: [0, 0], more: 0, hl: undefined })
    expect(fallbackPhrases(d, '2026-11-22')).toEqual({ done: [], open: ['b', 'x'] })
  })
  it('clears seen priority after practicing on the same day', () => {
    const d = base()
    d.learn = seePhrase(d.learn, 'a', D)
    d.learn = applyPhrase(d.learn, 'a', true, D)
    expect(phraseFor(d, 'c', '2026-11-22')).toBe('b')
  })
  it('uses built-in phrase ex1 on complete/write tasks when different and maskable, and srcSentence otherwise', () => {
    setSenseData(
      {},
      {},
      {
        'take … for granted': [
          'grant',
          'grant#1',
          '想当然',
          '把某事视为理所当然',
          'assume',
          'fail to appreciate',
          'Never [[take]] good health [[for]] [[granted]].',
        ],
        'grant access': ['grant', 'grant#2', '授予权限', '允许进入或使用', 'allow entry', 'allow entry to', 'Access denied here.'],
      },
    )
    const d = base()
    d.pieces.a = { ...d.pieces.a, s: 'She took that loyalty for granted.' }
    d.pieces.b = { ...d.pieces.b, s: 'They will grant access tomorrow.' }
    d.learn.a = rec({ occ: [{ pid: 'p1', doc: 'd', s: 'She took that loyalty for granted.' }] })
    d.learn.b = rec({ occ: [{ pid: 'p2', doc: 'd', s: 'They will grant access tomorrow.' }] })
    expect(phraseMasked(d, 'a', 'order')).toBe('She ___ that loyalty ___ ___.')
    expect(phraseMasked(d, 'a', 'complete')).toBe('Never ___ good health ___ ___.')
    expect(phraseMasked(d, 'a', 'write')).toBe('Never ___ good health ___ ___.')
    expect(phraseMasked(d, 'b', 'write')).toBe('They will ___ ___ tomorrow.')
    d.pieces.a = { ...d.pieces.a, s: 'Never take good health for granted.' }
    d.learn.a = rec({ occ: [{ pid: 'p1', doc: 'd', s: 'Never take good health for granted.' }] })
    expect(phraseMasked(d, 'a', 'complete')).toBe('Never ___ good health ___ ___.')
    setSenseData({}, {}, {})
  })
})
