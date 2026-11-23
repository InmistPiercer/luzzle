import { describe, expect, it } from 'vitest'
import { DEMO_DOCS, DEMO_ENTRIES } from '../content/demo'
import { seedDemo } from '../content/seed'
import { highlightParts } from '../core/text'
import type { DocData } from '../core/types'
import { useApp } from '../app/store'
import { setLocalSenses, withSense } from '../lang/senses'
import { setMorphData } from '../morph/local'
import { computeSel, meetNew, newSenseOptions, normWordsOf, selMeetKey, selOccIdx, useReader } from '../reader/session'
import { addOccurrence, boardRootIds, createPiece, entryFromSurface, microGloss, MOSAIC_MAX, mosaicSlotsOf, newPieceId, pieceGlossFor, piecesOfLemma, removePiece, shortEnGloss, siblingGroupOf, withGloss } from './pieces'
import { newRecord } from './engine'

const T = '2026-11-14'
const ctx = { pid: 'P3-B2', wi: 9, doc: 'Doc', s: 'Even a relaxing evening can be sustained.' }

describe('pieces', () => {
  it('creates a lemmatized piece and places it on the board', () => {
    const d = seedDemo(T)
    const id = newPieceId(d, 'sustain')
    const n = createPiece(d, id, entryFromSurface('sustained', ctx.s), '生词初见', ctx, T)
    expect(n.pieces[id]).toMatchObject({ lemma: 'sustain', form: 'sustained' })
    expect(n.learn[id]).toMatchObject({ stage: 1, goal: 'read', occ: [{ pid: 'P3-B2', wi: 9 }] })
    expect(n.board.pos[id]).toBeDefined()
    const dUse = { ...d, prefs: { ...d.prefs, defaultGoal: 'use' as const } }
    const nUse = createPiece(dUse, 'sustain~2', entryFromSurface('sustained', ctx.s), '生词初见', ctx, T)
    expect(nUse.learn['sustain~2'].goal).toBe('use')

    useApp.getState().markAgain(id, true)
    useApp.getState().markAgain(id, true)
    expect(useApp.getState().againStep[id]).toBe(2)
    useApp.getState().markAgain(id, false)
    expect(useApp.getState().againStep[id]).toBeUndefined()
  })

  it('builds participles as verbs by default and as adjectives on request', () => {
    expect(entryFromSurface('relaxing', '')).toMatchObject({ lemma: 'relax', isParticipialAdj: false })
    expect(entryFromSurface('relaxing', '', { lemma: 'relaxing' })).toMatchObject({ lemma: 'relaxing', isParticipialAdj: true, etymBase: 'relax', pos: 'adj.' })
  })

  it('hangs a phrase under its head word, creating the head if needed', () => {
    const d = seedDemo(T)
    const n = createPiece(d, 'keep_faith', DEMO_ENTRIES.keep_faith, '词族关联', ctx, T)
    const head = piecesOfLemma(n, 'faith')[0]
    expect(head).toBeDefined()
    expect(n.pieces.keep_faith.parentId).toBe(head)
    expect(n.pieces[head].childrenIds).toContain('keep_faith')
    expect(n.board.pos.keep_faith).toBeUndefined()
    const r = removePiece(n, head)
    expect(r.learn.keep_faith).toBeUndefined()
  })

  it('adds a reading occurrence once without counting evidence', () => {
    const d = seedDemo(T)
    const a = addOccurrence(d, 'habit', { ...ctx, pid: 'P13-B1' })
    expect(a.learn.habit.occ).toHaveLength(2)
    expect(a.learn.habit.ev).toEqual(d.learn.habit.ev)
    expect(addOccurrence(a, 'habit', { ...ctx, pid: 'P13-B1' })).toBe(a)
  })

  it('recognizes a participial adjective position collected under its base verb lemma', () => {
    const s = 'A relaxing evening helps us rest.'
    const doc: DocData = { id: 'doc-adj', title: 'Doc', vault: 0, rebuilt: false, cachedRebuilt: false, paras: [{ id: 'P-adj', t: s }] }
    const base = { ...seedDemo(T), docs: [doc as unknown as ReturnType<typeof seedDemo>['docs'][number]] }
    const id = newPieceId(base, 'relax')
    const n = createPiece(base, id, entryFromSurface('relaxing', s, { lemma: 'relax' }), '生词初见', { pid: 'P-adj', wi: 1, doc: 'Doc', s, form: 'relaxing' }, T)
    const sel = computeSel(n, doc, 'P-adj', 1, 'relaxing')
    expect(sel?.part).toEqual({ base: 'relax', adj: true })
    expect(sel?.mode).toBe('here')
    expect(sel?.k).toBe(id)
  })

  it('resolves offline English glosses and concise shortEnGloss for puzzle back-face', () => {
    setMorphData({ unbreakable: [['un', 'un'], ['break', 'base', 'break'], ['able', 'able']] }, {}, {
      adventure: ['x', '来到的事 → 冒险', 'what comes → chance event → risky venture'],
    })
    expect(pieceGlossFor({ lemma: 'representation', gloss: '表现' }, 'en')).toBe('depiction or standing in for')
    expect(shortEnGloss({ lemma: 'representation', gloss: '表现' })).toBe('depiction or standing in for')
    expect(pieceGlossFor({ lemma: 'adventure', gloss: '冒险' }, 'en')).toBe('risky venture')
    expect(shortEnGloss({ lemma: 'erode', ai: { en: 'to gradually wear away or diminish something abstract' } })).toBe('to gradually wear away')
    expect(shortEnGloss({ lemma: 'crane', gloss: '鹤' })).toBe('tall wading bird')
    expect(pieceGlossFor({ lemma: 'zorbex', gloss: '神秘词' }, 'en')).not.toMatch(/[\u4e00-\u9fff]/)
    expect(pieceGlossFor({ lemma: 'serendipity', pos: 'n.', gloss: '意外发现' }, 'en')).toBe('serendipity')
    expect(microGloss({ lemma: 'crane', gloss: '鹤', en: 'tall bird' }, 'zh')).toBe('鹤')
    expect(microGloss({ lemma: 'crane', gloss: '鹤', en: 'tall bird' }, 'en')).toBe('tall bird')
    expect(microGloss({ lemma: 'run', gloss: '经营', en: 'manage' }, 'en')).toBe('manage')
    expect(microGloss({ lemma: 'grant', tile: '授予/承认', en: 'give or allow' }, 'zh')).toBe('授予')
  })
})

describe('composite pieces', () => {
  it('caps a composite at six senses and splits the rest out', () => {
    const d = seedDemo('2026-11-21')
    const ids = Array.from({ length: 7 }, (_, i) => `crane~${i + 1}`)
    for (const id of ids) {
      d.pieces[id] = { id, lemma: 'crane', pos: 'n.' }
      d.learn[id] = newRecord('生词初见', [], '2026-11-21')
    }
    expect(siblingGroupOf(d, ids[0])).toHaveLength(MOSAIC_MAX)
    expect(siblingGroupOf(d, ids[6])).toEqual([ids[6]])
    expect(boardRootIds(d).filter((id) => id.startsWith('crane'))).toEqual([ids[0], ids[6]])
    expect(mosaicSlotsOf(d, ids[0], 'en')).toHaveLength(MOSAIC_MAX)
  })

  it('clears stale sense fields on custom withGloss and filters collected senses in newSenseOptions', () => {
    setLocalSenses({
      discharge: [
        ['discharge#1', 'v.', 1, '使出院', '准许离开医院', 'release', 'officially allow someone to leave hospital', '', ''],
        ['discharge#2', 'v.', 1, '履行', '履行职责或义务', 'fulfill', 'carry out a duty or responsibility', '', ''],
        ['discharge#3', 'n.', 1, '排出物', '流出的液体', 'emission', 'liquid or gas that flows out', '', ''],
      ],
    })
    const base = entryFromSurface('discharge', 'Sign discharge papers.')
    expect(base.sid).toBe('discharge#1')
    const customEn = withGloss(base, 'settle a debt')
    expect(customEn.sid).toBeUndefined()
    expect(pieceGlossFor(customEn, 'en')).toBe('settle a debt')

    const d = seedDemo('2026-11-21')
    d.prefs.defLang = 'zh'
    const first = withSense(base, ['discharge#1', 'v.', 1, '使出院', '准许离开医院', 'release', 'officially allow someone to leave hospital', '', ''])
    const d1 = createPiece(d, 'discharge', first, '生词初见', { pid: 'PT4-B7', wi: 5, doc: 'Doc', s: 'Sign discharge papers.' }, '2026-11-21')
    useApp.setState({ data: d1 })
    const lastWi = normWordsOf(DEMO_DOCS[2].paras.find((p) => p.id === 'PT4-B7')!.t).lastIndexOf('discharge')
    const sel = computeSel(d1, DEMO_DOCS[2], 'PT4-B7', lastWi, 'discharge')!
    expect(selOccIdx(d1, sel)).toBe(2)
    const optsZh = newSenseOptions(sel)
    expect(optsZh.options).toEqual(['v. 履行', 'n. 排出物'])

    const mKey = selMeetKey(d1, sel)
    useReader.setState({
      sel,
      ai: { [mKey]: { match: 0, zh: '履行职责', en: 'carry out a duty', tr: '忠实履行职责。' } },
    })
    meetNew('履行职责')
    const after = useApp.getState().data
    expect(after.pieces['discharge~2']).toBeDefined()
    expect(after.pieces['discharge~2'].sid).toBe('discharge#2')
    expect(pieceGlossFor(after.pieces['discharge~2'], 'zh')).toBe('履行')
    expect(pieceGlossFor(after.pieces['discharge~2'], 'en')).toBe('carry out a duty or responsibility')
    expect(highlightParts('sign discharge papers, abnormal discharge, faithfully discharge its duty', 'discharge', 2)).toEqual([
      'sign discharge papers, abnormal discharge, faithfully ',
      'discharge',
      ' its duty',
    ])
    setLocalSenses(undefined)
  })
})
