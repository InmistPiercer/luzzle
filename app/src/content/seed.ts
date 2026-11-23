import { addDays, type Day } from '../core/date'
import { emptyState, type AppState, type LearnRecord, type Reason, type Stage } from '../core/types'
import { legacyRecord } from '../learn/engine'
import { fromLegacySched } from '../learn/scheduler'
import { BOARD_SEED, DEMO_DOCS, DEMO_ENTRIES } from './demo'
import { seedMorph } from '../morph/engine'

interface SeedOpts {
  reason?: Reason
  occ?: LearnRecord['occ']
  due?: number
  stab?: number
}

export function seedDemo(day: Day): AppState {
  const st = emptyState()
  const doc = DEMO_DOCS[0].title
  const P = (id: string, stage: Stage, o: SeedOpts = {}) => {
    const e = DEMO_ENTRIES[id]
    st.pieces[id] = { ...e, id }
    st.learn[id] = legacyRecord(
      stage,
      {
        reason: o.reason || '生词初见',
        occ: o.occ || [{ pid: null, doc: e.src || 'Earlier reading', s: e.s || '' }],
        sched: fromLegacySched({ due: addDays(day, o.due || 0), stab: o.stab || 1, seen: stage > 1 }, day),
      },
      day,
    )
  }
  const at = (id: string, pid: string) => [{ pid, doc, s: DEMO_ENTRIES[id].s || '' }]
  P('erode', 1, { occ: at('erode', 'P3-B1') })
  P('grant', 2, { stab: 2, occ: at('grant', 'P3-B2') })
  P('granted', 1, { reason: '词族关联', occ: at('granted', 'P3-B2') })
  st.pieces.granted.parentId = 'grant'
  st.pieces.grant.childrenIds = ['granted']
  P('deliberate', 3, { stab: 3, occ: at('deliberate', 'P3-B2') })
  P('habit', 4, { stab: 4, occ: at('habit', 'P3-B2') })
  P('patience', 4, { stab: 13, occ: at('patience', 'P3-B1') })
  P('patient', 4, { due: 5, stab: 13 })
  P('impatient', 3, { stab: 3 })
  P('erosion', 4, { due: 3, stab: 5 })
  P('corrode', 2, { stab: 2 })
  P('run', 4, { due: 2, stab: 6 })
  st.board.pos = Object.fromEntries(Object.entries(BOARD_SEED).map(([k, [x, y]]) => [k, { x, y }]))
  st.board.links = [
    ['patient', 'patience'],
    ['patience', 'impatient'],
    ['erode', 'erosion'],
  ]
  st.morph = seedMorph(day, { docId: DEMO_DOCS[0].id, doc, pid: 'P3-B1', s: DEMO_ENTRIES.patience.s || '' })
  st.docState = DEMO_DOCS.map((d) => ({ id: d.id, rebuilt: d.rebuilt, cachedRebuilt: d.cachedRebuilt }))
  return st
}
