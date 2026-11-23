import { describe, expect, it } from 'vitest'
import { seedDemo } from '../content/seed'
import { CORE_IDS } from './data'
import { MorphEngine } from './engine'
import { etymLine } from './etym'
import { setMorphData } from './local'

const d = seedDemo('2026-11-14')

describe('morph engine', () => {
  it('uses exact decomposition, local splits and refusals', () => {
    setMorphData({}, {}, { deliberate: ['o', 'de- 加强 + libra 天平 → 审慎的'] })
    const m = new MorphEngine(null, d)
    expect(m.analyze('impatient')).toMatchObject({ kind: 'ok', layer: 'exact' })
    const imp = m.analyze('important')
    expect(imp).toMatchObject({ kind: 'ok', layer: 'basic' })
    expect(imp.kind === 'ok' && imp.parts.map((p) => p[0])).toEqual(['im', 'port', 'ant'])
    expect(m.analyze('summit').kind).not.toBe('ok')
    expect(m.analyze('deliberate')).toMatchObject({ kind: 'opaque', ety: 'de- 加强 + libra 天平 → 审慎的' })
    expect(m.analyze('take for granted').kind).toBe('refuse')
  })

  it('adds AI morphemes and splits new family words offline (PRD 验收 24)', () => {
    const m = new MorphEngine(null, d)
    const ok = m.applyAISplit(
      'zorbify',
      {
        pos: 'v.',
        zh: '测试',
        parts: [
          { s: 'zorb', type: 'root', m: 'zorb', zh: '测' },
          { s: 'ify', type: 'suffix', m: '-fy' },
        ],
      },
      '2026-11-14',
    )
    expect(ok).toBe('ok')
    expect(m.morpheme('u_root_zorb')?.ai).toBe(true)
    expect(m.ms.words.zorbify.parts[1][1]).toBe('s_fy')
    expect(m.applyAISplit('progressive', { parts: [{ s: 'pro', type: 'prefix', m: 'pro-' }, { s: 'gress', type: 'root', m: 'gress' }, { s: 'ive', type: 'suffix', m: '-ive' }] }, 'x')).toBe('ok')
    expect(m.ms.words.progressive.parts[1]).toEqual(['gress', 'r_grad'])
    m.removeMorpheme('u_root_zorb')
    expect(m.ms.words.zorbify.parts[0]).toEqual(['zorb', 'base', 'zorb'])
  })

  it('drops AI morphemes that no saved word uses', () => {
    const m = new MorphEngine({ words: {}, src: { lib: [{ id: 'u_pre_per', t: 'pre', main: 'per-', zh: '', vars: ['per'], ai: true }], decomp: {}, family: {}, vx: {}, ety: {} } }, d)
    expect(m.snapshot().src.lib).toEqual([])
  })

  it('rejects AI parts that do not rebuild the word', () => {
    const m = new MorphEngine(null, d)
    expect(m.applyAISplit('attract', { parts: [{ s: 'at', type: 'prefix' }, { s: 'trac', type: 'root' }] }, 'x')).toBe('bad')
  })

  it('refreshes stale basic splits but keeps AI ones', () => {
    setMorphData({ urbanization: [['urb', 'base', 'urb'], ['an', 'al'], ['iz', 'ize'], ['ation', 'ion']] }, {})
    const m = new MorphEngine(
      {
        words: {
          urbanization: { parts: [['urban', 'base', 'urban'], ['ization', 'ion']], layer: 'basic', tags: {}, ctx: [], at: '2026-11-14' },
          remit: { parts: [['re', 're'], ['mit', 'mit']], layer: 'ai', tags: {}, ctx: [], at: '2026-11-14' },
        },
        src: { lib: [], decomp: {}, family: {}, vx: {}, ety: {} },
      },
      d,
    )
    expect(m.refreshBasic()).toBe(1)
    expect(m.ms.words.urbanization.parts.map((p) => p[0])).toEqual(['urb', 'an', 'iz', 'ation'])
    expect(m.refreshBasic()).toBe(0)
  })

  it('stores AI etymology and old loans', () => {
    const m = new MorphEngine(null, d)
    expect(m.applyAISplit('sabotage', { parts: [], ety: '法 sabot 木鞋 → 蓄意破坏' }, 'x')).toBe('opaque')
    expect(m.analyze('sabotage')).toMatchObject({ kind: 'opaque', ety: '法 sabot 木鞋 → 蓄意破坏' })
    m.applyAISplit('suburb', { parts: [{ s: 'sub', type: 'prefix', m: 'sub-' }, { s: 'urb', type: 'root', m: 'urb' }], drift: false, ety: 'sub- 在下 + urb 城市 → 郊区' }, 'x')
    expect(m.cls('suburb', m.ms.words.suburb.parts)).toBe('T')
    expect(m.cls('retreat', [['re', 're'], ['treat', 'tract']])).toBe('x')
  })

  it('collects free bases and resolves base: ids across relatedWords and family', () => {
    const m = new MorphEngine(
      {
        words: {
          unhappiness: { parts: [['un', 'un'], ['happi', 'base', 'happy'], ['ness', 'ness']], layer: 'basic', tags: {}, ctx: [], at: '2026-11-14' },
          urbanization: { parts: [['urb', 'base', 'urb'], ['an', 'al'], ['iz', 'ize'], ['ation', 'ion']], layer: 'basic', tags: {}, ctx: [], at: '2026-11-14' },
        },
        src: {
          lib: [],
          decomp: { suburbia: { z: '郊区', p: 'n.', parts: [['sub', 'sub'], ['urb', 'base', 'urb'], ['ia', 'base', 'ia']] } },
          family: {},
          vx: {},
          ety: {},
        },
      },
      d,
    )
    expect(m.bases().map((b) => b.id)).toEqual(['base:happy', 'base:urb'])
    expect(m.morpheme('base:happy')).toMatchObject({ id: 'base:happy', t: 'base', main: 'happy', vars: ['happy'] })
    expect(m.relatedWords('base:happy')).toEqual(['unhappiness'])
    expect(m.family('base:urb').map((f) => f.w)).toContain('suburbia')
  })

  it('separates -able/-ible, -ence/-ance, -er/-or, links related morphemes, and curates CORE_IDS', () => {
    setMorphData(
      {
        responsible: [['respons', 'base', 'response'], ['ible', 'able']],
        acceptance: [['accept', 'base', 'accept'], ['ance', 'ence']],
        director: [['direct', 'base', 'direct'], ['or', 'er']],
      },
      {
        able: [['available', '可用的'], ['responsible', '有责任的']],
      },
    )
    const m = new MorphEngine(null, d)
    expect(m.analyze('visible')).toMatchObject({ kind: 'ok', layer: 'exact', parts: [['vis', 'vis'], ['ible', 'ible']] })
    expect(m.analyze('responsible')).toMatchObject({ kind: 'ok', parts: [['respons', 'base', 'response'], ['ible', 'ible']] })
    expect(m.analyze('acceptance')).toMatchObject({ kind: 'ok', parts: [['accept', 'base', 'accept'], ['ance', 'ance']] })
    expect(m.analyze('director')).toMatchObject({ kind: 'ok', parts: [['direct', 'base', 'direct'], ['or', 'or']] })
    expect(m.relatedMorphemes('able').map((x) => x.id)).toContain('ible')
    expect(m.relatedMorphemes('ible').map((x) => x.id)).toContain('able')
    expect(m.relatedMorphemes('de').map((x) => x.id)).toContain('sub')
    expect(m.family('ible').map((x) => x.w)).toContain('responsible')
    expect(m.family('ible').map((x) => x.w)).not.toContain('available')
    expect(m.family('able').map((x) => x.w)).toContain('available')
    expect(m.family('able').map((x) => x.w)).not.toContain('responsible')
    expect(CORE_IDS.has('ible')).toBe(true)
    expect(CORE_IDS.has('ance')).toBe(true)
    expect(CORE_IDS.has('or')).toBe(true)
    expect(CORE_IDS.has('p_circum')).toBe(false)
  })

  it('returns distinct Chinese and English etymLine without leaking Chinese in English mode', () => {
    setMorphData(
      { suburb: [['sub', 'sub'], ['urb', 'r_urb']] },
      {},
      {
        urbane: ['x', '城市 → 举止文雅的', 'city → of the city → refined'],
        companion: ['o', 'com- 共同 + panis 面包 → 同伴'],
      },
    )
    const zhApp = { ...d, prefs: { ...d.prefs, defLang: 'zh' as const } }
    const enApp = { ...d, prefs: { ...d.prefs, defLang: 'en' as const } }
    expect(etymLine(zhApp, 'urbane')).toBe('城市 → 举止文雅的')
    expect(etymLine(enApp, 'urbane')).toBe('city → of the city → refined')
    expect(etymLine(zhApp, 'companion')).toBe('com- 共同 + panis 面包 → 同伴')
    expect(etymLine(enApp, 'companion')).toBe('')
    expect(etymLine(enApp, 'suburb')).toContain('sub-')
    expect(etymLine(enApp, 'suburb')).not.toMatch(/[\u4e00-\u9fff]/)
  })
})
