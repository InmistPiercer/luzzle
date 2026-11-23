import { describe, expect, it } from 'vitest'
import { emptyState, type AppState, type Entry, type SenseRow } from '../core/types'
import { freshSentence, meaningChoices, meaningOf } from '../forge/logic'
import { attachSids } from '../learn/senseSync'
import { catalogPhraseOf, computeSel } from '../reader/session'
import { spansFor } from '../reader/text'
import { lemmatize } from './lemmatize'
import { matchSense, parseSenseRows, senseById, setSenseData, ukToUs, withSense } from './senses'

const scale: SenseRow[] = [
  ['scale#1', 'n.', 1, '规模', '事物的大小或程度', 'size', 'the size or extent of something', 'Nobody expected a disaster on this [[scale]].', ''],
  ['scale#2', 'n.', 1, '比例；刻度', '图纸的比例或测量刻度', 'ratio, measure', 'the ratio of a map to reality', 'The map is drawn to a [[scale]] of one to fifty thousand.', ''],
  ['scale#3', 'n.', 0, '鳞片', '鱼身上的小硬片', 'skin plate', 'one of the small hard plates on a fish', 'He scraped the [[scales]] off the fish.', ''],
]
const plate: SenseRow[] = [['plate#1', 'n.', 1, '盘子', '盛食物的扁平器皿', 'dish', 'a flat dish for food', 'She put the cake on a [[plate]].', '']]
const sail: SenseRow[] = [['sail#1', 'n.', 1, '帆', '船上借风行驶的布', 'canvas sheet', 'a sheet of cloth that catches wind', 'The wind filled the [[sail]].', '']]

setSenseData(
  { scale, plate, sail },
  { overcame: 'overcome', lost: 'lose' },
  {
    'in wake of': ['wake', 'wake#2', '紧随…之后', '在某事发生之后随之而来', 'following closely', 'happening right after an event', 'New rules came in the wake of the crash.'],
    'take … into account': ['account', '', '考虑', '把某事纳入考虑', 'consider', 'include when deciding', 'We must take the weather into account.'],
    "lose one's temper": ['temper', 'temper#1', '发脾气', '突然生气发火', 'get angry', 'suddenly become angry', 'He lost his temper.'],
    'in time': ['time', '', '及时', '在事件发生前到达', 'before late', 'early enough for an event', 'We arrived in time.'],
    'that said': ['said', '', '尽管如此', '表示转折，尽管如此', 'even so', 'despite what was just mentioned', 'We missed the train; that said, we arrived on time.'],
  },
)

describe('sense table', () => {
  it('finds senses by id and matches existing glosses', () => {
    expect(senseById('scale#3')?.[3]).toBe('鳞片')
    expect(matchSense({ lemma: 'scale', pos: 'n.', gloss: '鳞' })?.[0]).toBe('scale#3')
    expect(matchSense({ lemma: 'scale', pos: 'n.', gloss: '天平' })).toBeUndefined()
  })

  it('materializes a sense onto an entry', () => {
    const e = withSense({ lemma: 'scale', pos: 'v.' } as Entry, scale[1])
    expect(e).toMatchObject({ sid: 'scale#2', gloss: '比例；刻度', tile: '比例；刻度', en: 'the ratio of a map to reality', ens: 'ratio, measure', pos: 'n.' })
    expect(e.senses).toEqual(['n. 规模', 'n. 比例；刻度', 'n. 鳞片'])
  })

  it('maps British spellings and irregular forms to lemmas', () => {
    expect(ukToUs('colour')).toBe('color')
    expect(lemmatize('colour')).toBe('color')
    expect(lemmatize('overcame')).toBe('overcome')
  })

  it('validates AI-generated senses in the data-package format', () => {
    const rows = parseSenseRows('gantry', {
      senses: [
        { pos: 'n.', core: 1, zh_short: '龙门架', zh_def: '跨在轨道上的架子', en_short: 'frame', en_def: 'a bridge-like frame for cranes', ex1: 'The crane ran along the [[gantry]].' },
        { pos: 'n.', core: 0, zh_short: 'bad', zh_def: 'x', en_short: 'gantry crane', en_def: 'x' },
      ],
    })
    expect(rows).toEqual([['gantry#1', 'n.', 1, '龙门架', '跨在轨道上的架子', 'frame', 'a bridge-like frame for cranes', 'The crane ran along the [[gantry]].', '']])
  })

  it('attaches sense ids to existing pieces and keeps unmatched ones as off-table', () => {
    const d: AppState = {
      ...emptyState(),
      pieces: {
        a: { id: 'a', lemma: 'scale', pos: 'n.', gloss: '鳞片' },
        b: { id: 'b', lemma: 'scale', pos: 'n.', gloss: '天平' },
        ph: { id: 'ph', lemma: 'in wake of', pos: 'phrase', tile: '短语' },
      },
    }
    const next = attachSids(d)!
    expect(next.pieces.a).toMatchObject({ sid: 'scale#3', gloss: '鳞片', ens: 'skin plate' })
    expect(next.pieces.b.sid).toBe('')
    expect(next.pieces.ph).toMatchObject({ gloss: '紧随…之后', tile: '紧随…之后', en: 'happening right after an event', ens: 'following closely' })
    expect(meaningOf(next.pieces.ph, 'en')).toBe('happening right after an event')
    expect(attachSids(next)).toBeNull()
  })

  it('uses sense examples as new sentences and table senses as distractors', () => {
    const d: AppState = {
      ...emptyState(),
      pieces: { s: { id: 's', ...withSense({ lemma: 'scale', pos: 'n.' }, scale[0]), s: 'The plan works at a small scale.' } },
      learn: { s: { stage: 1, goal: 'read', reason: '生词初见', occ: [{ pid: 'p', doc: 'd', s: 'The plan works at a small scale.', added: '2026-11-19' }], sched: { due: '2026-11-19', stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 0, last: '', intro: '2026-11-19' } as never, ev: { rec: [], meaning: [], fresh: [], form: [], use: [] } } },
    }
    expect(freshSentence(d, 's', 'x')).toMatchObject({ s: 'Nobody expected a disaster on this scale.', form: 'scale', fresh: true })
    const zh = meaningChoices(d, 's', 'zh')
    expect(zh.opts[0]).toBe('规模')
    expect(zh.opts.slice(1)).toEqual(expect.arrayContaining(['盘子']))
    expect(zh.opts).not.toContain('鳞片')
  })

  it('detects built-in phrases in reading with strict gaps and frozen inflections', () => {
    const doc = {
      id: 'd1',
      title: 'T',
      vault: 0,
      rebuilt: false,
      cachedRebuilt: false,
      paras: [
        { id: 'p1', t: 'We took the sudden weather into account and arrived in time.' },
        { id: 'p2', t: 'In recent years time has passed, and the report that says otherwise is wrong.' },
        { id: 'p3', t: 'We missed the bus; that said, we still finished early.' },
        { id: 'p4', t: 'A surgeon who lost his temper endangers everyone.' },
      ],
    }
    const s1 = computeSel(emptyState(), doc, 'p1', 6, 'account')!
    expect(s1.freePh).toBe('ph_take_gap_into_account')
    expect(catalogPhraseOf(s1.freePh!)).toMatchObject({ lemma: 'take … into account', tile: '考虑', parentLemma: 'account' })
    const s2 = computeSel(emptyState(), doc, 'p1', 10, 'time')!
    expect(s2.freePh).toBe('ph_in_time')
    expect(computeSel(emptyState(), doc, 'p2', 3, 'time')?.freePh).toBeNull()
    expect(computeSel(emptyState(), doc, 'p2', 10, 'says')?.freePh).toBeNull()
    expect(computeSel(emptyState(), doc, 'p3', 5, 'said')?.freePh).toBe('ph_that_said')
    expect(computeSel(emptyState(), doc, 'p4', 5, 'temper')?.freePh).toBe('ph_lose_one_s_temper')
    expect(spansFor([['ts', catalogPhraseOf('ph_that_said')!]], ['report', 'that', 'says'], undefined, true)).toEqual({})
  })
})
