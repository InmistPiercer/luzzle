import { describe, expect, it } from 'vitest'
import { deleteParentPiece } from '../app/pieceActions'
import { DEMO_ENTRIES } from '../content/demo'
import { clearDemo } from '../content/demoClear'
import { seedDemo } from '../content/seed'
import { addDays } from '../core/date'
import type { AppState, DocData } from '../core/types'
import { applyReview, forgeQueue, hasSharedSpell, newRecord } from './engine'
import { boardRootIds, createPiece, entryFromSurface, microGloss, mosaicSlotsOf, newPieceId, pieceGlossFor, piecesOfLemma, siblingGroupOf, withGloss } from './pieces'
import { newSched } from './scheduler'
import { setLocalSenses } from '../lang/senses'
import { computeSel, recallGateId } from '../reader/session'
import { paraNodes, wordOwner } from '../reader/text'
import { REBUILD_POOL } from '../pdf/rebuild'

const D0 = '2026-11-18'

describe('v6.5.0 polysemy and phrase e2e', () => {
  it('Suite A: handles same-paragraph and cross-article polysemy, composite mosaic, detach, shared spell, and mutual exclusion', () => {
    const doc1: DocData = {
      id: 'doc-crane-1',
      title: 'Cranes',
      vault: 0,
      rebuilt: true,
      cachedRebuilt: true,
      paras: [
        {
          id: 'P-crane-1',
          pg: 1,
          t: 'A tall crane waded near the marsh while a steel crane lifted beams overhead.',
        },
      ],
    }
    const doc2: DocData = {
      id: 'doc-crane-2',
      title: 'Harbor',
      vault: 0,
      rebuilt: true,
      cachedRebuilt: true,
      paras: [{ id: 'P-crane-2', pg: 1, t: 'Another crane stood beside the dock.' }],
    }

    let d: AppState = { ...seedDemo(D0), docs: [doc1, doc2] as unknown as AppState['docs'] }
    const c1 = newPieceId(d, 'crane')
    const e1 = withGloss({ ...entryFromSurface('crane', doc1.paras[0].t!, { pos: 'n.' }), en: 'tall bird', dict: ['n. 鹤', 'n. 起重机', 'v. 伸长脖子'] }, '鹤')
    d = createPiece(d, c1, e1, '生词初见', { pid: 'P-crane-1', wi: 2, doc: doc1.title, s: doc1.paras[0].t!, form: 'crane' }, D0)

    const c2 = newPieceId(d, 'crane')
    const e2 = withGloss({ ...entryFromSurface('crane', doc1.paras[0].t!, { pos: 'n.' }), en: 'crane hoist', dict: ['n. 鹤', 'n. 起重机', 'v. 伸长脖子'] }, '起重机')
    d = createPiece(d, c2, e2, '熟词新义', { pid: 'P-crane-1', wi: 10, doc: doc1.title, s: doc1.paras[0].t!, form: 'crane' }, D0)

    expect(c2).toBe('crane~2')
    expect(wordOwner(d, 'P-crane-1', 'crane', 2, doc1.paras[0].t!)).toBe(c1)
    expect(wordOwner(d, 'P-crane-1', 'crane', 10, doc1.paras[0].t!)).toBe(c2)

    expect(boardRootIds(d).filter((id) => d.pieces[id]?.lemma === 'crane')).toEqual([c1])
    expect(d.board.pos[c1]).toBeDefined()
    expect(d.board.pos[c2]).toBeUndefined()

    expect(mosaicSlotsOf(d, c1, 'en', c2)).toHaveLength(2)
    setLocalSenses({ crane: [['crane#1', 'n.', 1, '鹤', '鹤', 'tall bird', 'a tall bird', '', ''], ['crane#2', 'n.', 1, '起重机', '起重机', 'crane hoist', 'a lifting machine', '', ''], ['crane#3', 'v.', 1, '伸长脖子', '伸长脖子', 'stretch neck', 'to stretch the neck', '', ''], ['crane#4', 'n.', 0, '鹤类', '鹤类', 'crane family', 'the crane family', '', '']] })
    d = { ...d, pieces: { ...d.pieces, [c1]: { ...d.pieces[c1], sid: 'crane#1' }, [c2]: { ...d.pieces[c2], sid: 'crane#2' } } }
    const slotsEn = mosaicSlotsOf(d, c1, 'en', c2)
    expect(slotsEn).toHaveLength(3)
    expect(slotsEn[0]).toMatchObject({ id: c1, unlocked: true, micro: 'tall bird', active: false })
    expect(slotsEn[1]).toMatchObject({ id: c2, unlocked: true, micro: 'crane hoist', active: true })
    expect(slotsEn[2]).toMatchObject({ unlocked: false, st: 0 })

    const slotsZh = mosaicSlotsOf(d, c1, 'zh', c1)
    expect(slotsZh[0].micro).toBe('鹤')
    expect(slotsZh[1].micro).toBe('起重机')
    setLocalSenses(undefined)
    expect(microGloss(d.pieces[c1], 'en')).toBe('tall bird')
    expect(pieceGlossFor(d.pieces[c1], 'en')).toBe('tall bird')
    expect(pieceGlossFor(d.pieces[c1], 'zh')).toBe('鹤')

    const nodes = paraNodes(d, doc2.paras[0], true)
    const craneNode = nodes.find((n) => n.kind === 'w' && n.lw === 'crane')
    expect(craneNode).toMatchObject({ kind: 'w', pc: null, pos: 'n.', stage: 1 })

    const meetSel = computeSel(d, doc2, 'P-crane-2', 1, 'crane')!
    expect(meetSel.mode).toBe('meet')
    expect(meetSel.cands).toEqual([c1, c2])
    expect(recallGateId(d, meetSel)).toBeNull()

    const uniqueMeet = computeSel(d, { ...doc2, paras: [{ id: 'P-hab', t: 'Old habit persists.' }] }, 'P-hab', 1, 'habit')!
    expect(uniqueMeet.mode).toBe('meet')
    expect(recallGateId(d, uniqueMeet)).toBe('habit')

    const detachedState = { ...d, pieces: { ...d.pieces, [c2]: { ...d.pieces[c2], detached: true } } }
    expect(boardRootIds(detachedState).filter((id) => detachedState.pieces[id]?.lemma === 'crane')).toEqual([c1, c2])
    expect(siblingGroupOf(detachedState, c1)).toEqual([c1])
    expect(siblingGroupOf(detachedState, c2)).toEqual([c2])

    let schedState = {
      ...d,
      learn: {
        ...d.learn,
        [c1]: {
          ...newRecord('生词初见', d.learn[c1].occ, D0, 'use'),
          stage: 3 as const,
          sched: { ...newSched(addDays(D0, 3)), state: 2 as const, stability: 7, difficulty: 5, reps: 2, last: addDays(D0, -2) },
          form: newSched(D0),
        },
        [c2]: { ...newRecord('熟词新义', d.learn[c2].occ, D0, 'use'), stage: 1 as const, form: newSched(D0), formDefer: 1 },
      },
    }
    const qBefore = forgeQueue(schedState.learn, D0, 10, new Set(), schedState.pieces)
    expect(qBefore.filter((id) => piecesOfLemma(schedState, 'crane').includes(id))).toEqual([c1])

    const afterForm = applyReview(schedState.learn, c1, { kind: 'form', task: 'spell', grade: 2, fresh: false, day: D0 }, schedState.pieces)
    schedState = { ...schedState, learn: afterForm }
    expect(schedState.learn[c2].sched.due).toBe(addDays(D0, 1))
    expect(schedState.learn[c2].form?.due).toBe(addDays(D0, 1))
    expect(schedState.learn[c2].formDefer).toBe(1)
    expect(hasSharedSpell(schedState, c2)).toBe(true)
    expect(forgeQueue(schedState.learn, D0, 10, new Set(), schedState.pieces).some((id) => id === c1 || id === c2)).toBe(false)
  })

  it('Suite B: handles core word + phrase ordering, independent grading, and parent deletion modes', () => {
    let d = seedDemo(D0)
    const sent = 'They kept faith with the few who finish.'
    d = createPiece(d, 'keep_faith', { ...DEMO_ENTRIES.keep_faith, form: 'kept faith with' }, '词族关联', { pid: 'P-kf', wi: 1, doc: 'Essay', s: sent }, D0)
    const faithId = piecesOfLemma(d, 'faith')[0]
    expect(faithId).toBeDefined()
    expect(d.pieces.keep_faith.parentId).toBe(faithId)
    expect(d.pieces[faithId].childrenIds).toContain('keep_faith')

    const learn = {
      ...d.learn,
      [faithId]: { ...d.learn[faithId], stage: 1 as const, sched: { ...d.learn[faithId].sched, state: 0 as const, due: D0 } },
      keep_faith: { ...d.learn.keep_faith, stage: 3 as const, sched: { ...d.learn.keep_faith.sched, state: 2 as const, stability: 4, due: D0 } },
    }
    const q = forgeQueue(learn, D0, 10, new Set(), d.pieces)
    expect(q.indexOf(faithId)).toBeGreaterThanOrEqual(0)
    expect(q).not.toContain('keep_faith')

    const gradedFaith = applyReview(learn, faithId, { kind: 'meaning', task: 'pick', grade: 2, fresh: false, day: D0 }, d.pieces)
    expect(gradedFaith[faithId].stage).toBe(2)
    expect(gradedFaith.keep_faith).toEqual(learn.keep_faith)

    const delAll = deleteParentPiece({ ...d, learn }, faithId, 'all')
    expect(delAll.learn[faithId]).toBeUndefined()
    expect(delAll.learn.keep_faith).toBeUndefined()

    const delKeep = deleteParentPiece({ ...d, learn }, faithId, 'keepChildren')
    expect(delKeep.learn[faithId]).toBeUndefined()
    expect(delKeep.learn.keep_faith).toEqual(learn.keep_faith)
    expect(delKeep.pieces.keep_faith.parentId).toBeUndefined()
    expect(delKeep.board.pos.keep_faith).toBeDefined()
    expect(boardRootIds(delKeep)).toContain('keep_faith')
  })

  it('Suite C: preserves reviewed demo words on clearDemo and exports REBUILD_POOL = 3', () => {
    expect(REBUILD_POOL).toBe(3)
    const d0 = seedDemo(D0)
    const reviewed = { ...d0, learn: applyReview(d0.learn, 'erode', { kind: 'meaning', task: 'pick', grade: 2, fresh: false, day: D0 }, d0.pieces) }
    const cleared = clearDemo(reviewed, D0)
    expect(cleared.learn.erode).toBeDefined()
    expect(cleared.learn.grant).toBeUndefined()
  })
})
