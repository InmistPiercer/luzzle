import { describe, expect, it, vi } from 'vitest'
import { addUsage, callAI, callLong, clearLegacyAIConfig, defaultAIConfig, emptyUsage, extractPartialJSON, isInsecureRemoteUrl, normalizeAIConfig, readLegacyAIConfig, type Tally, type Usage } from './client'
import { beijingTime, costOf, deepseekPeak, matchPrice, money, priceOf } from './pricing'
import { AIError, type AIConfig } from './types'

const T = '2026-11-14'
const cfg: AIConfig = { ...defaultAIConfig(), baseUrl: 'https://api.deepseek.com/', model: 'deepseek-chat', apiKey: 'k', dailyLimit: 5, budget: 0 }
const reply = (content: string, status = 200, usage = { prompt_tokens: 1000, completion_tokens: 500, prompt_cache_hit_tokens: 0 }) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status })

const deps = (f: typeof fetch, u: Usage = emptyUsage(T)) => {
  const saved: Tally[] = []
  return { saved, d: { fetch: f, today: T, usage: () => u, record: (t: Tally) => saved.push(t) } }
}

describe('callAI', () => {
  it('posts to an OpenAI-compatible base URL and extracts JSON', async () => {
    const f = vi.fn(async () => reply('好的：\n```json\n{"ok":true}\n```'))
    const { saved, d } = deps(f as unknown as typeof fetch)
    expect(await callAI(cfg, [{ role: 'user', content: 'x' }], { ...d, json: true })).toEqual({ ok: true })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'deepseek-chat', temperature: 0 })
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ req: 1, inTok: 1000, outTok: 500 })
  })

  it('uses defaults when base and model are empty', async () => {
    const f = vi.fn(async () => reply('hi'))
    await callAI({ ...cfg, baseUrl: '', model: '' }, [], deps(f as unknown as typeof fetch).d)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(JSON.parse(init.body as string).model).toBe('gpt-4o-mini')
  })

  it('speaks the Anthropic format', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ content: [{ text: 'yo' }] })))
    expect(await callAI({ ...cfg, provider: 'anthropic', baseUrl: '', model: '' }, [], deps(f as unknown as typeof fetch).d)).toBe('yo')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect((init.headers as Record<string, string>)['anthropic-dangerous-direct-browser-access']).toBe('true')
  })

  it('counts a request that came back, even with bad JSON, but not a failed one', async () => {
    const { saved, d } = deps((async () => reply('not json')) as unknown as typeof fetch)
    await expect(callAI(cfg, [], { ...d, json: true })).rejects.toMatchObject({ code: 'format' })
    const h = deps((async () => new Response('no', { status: 401 })) as unknown as typeof fetch)
    await expect(callAI(cfg, [], h.d)).rejects.toMatchObject({ code: 'http', status: 401 })
    expect(saved).toHaveLength(1)
    expect(h.saved).toEqual([])
  })

  it('times out', async () => {
    const f = ((_: string, init: RequestInit) =>
      new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new Error('abort'))))) as unknown as typeof fetch
    await expect(callAI(cfg, [], { ...deps(f).d, timeoutMs: 10 })).rejects.toMatchObject({ code: 'timeout' })
  })

  it('checks key and daily limit, resetting on a new day', async () => {
    const f = (async () => reply('hi')) as unknown as typeof fetch
    await expect(callAI({ ...cfg, apiKey: '' }, [], deps(f).d)).rejects.toBeInstanceOf(AIError)
    const five = addUsage(emptyUsage(T), { req: 5, inTok: 0, outTok: 0, cost: 0 }, T)
    await expect(callAI({ ...cfg, model: 'my-model' }, [], deps(f, five).d)).rejects.toMatchObject({ code: 'quota' })
    expect(await callAI({ ...cfg, model: 'my-model' }, [], deps(f, { ...five, day: '2026-11-13' }).d)).toBe('hi')
  })

  it('stops at the daily money budget when the model has a price', async () => {
    const f = (async () => reply('hi')) as unknown as typeof fetch
    const spent = addUsage(emptyUsage(T), { req: 1, inTok: 0, outTok: 0, cost: 0.71 }, T)
    await expect(callAI({ ...cfg, budget: 5, cur: 'CNY' }, [], deps(f, spent).d)).rejects.toMatchObject({ code: 'quota' })
    expect(await callAI({ ...cfg, budget: 6, cur: 'CNY' }, [], deps(f, spent).d)).toBe('hi')
  })

  it('holds the last request slot while the response is pending', async () => {
    const f = vi.fn(async () => reply('hi'))
    const almostFull = { ...emptyUsage(T), req: 4 }
    const { d } = deps(f as unknown as typeof fetch, almostFull)
    const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () => callAI({ ...cfg, model: 'my-model' }, [], d)))
    expect(f).toHaveBeenCalledTimes(1)
    expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((x) => x.status === 'rejected').map((x) => x.reason.code)).toEqual(['quota', 'quota', 'quota'])
  })

  it('reads Anthropic usage including cache reads', async () => {
    const f = (async () => new Response(JSON.stringify({ content: [{ text: 'ok' }], usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 50 } }))) as unknown as typeof fetch
    const { saved, d } = deps(f)
    await callAI({ ...cfg, provider: 'anthropic', baseUrl: '', model: 'claude-haiku-4-5' }, [], d)
    expect(saved[0]).toMatchObject({ inTok: 1000, outTok: 50 })
    expect(saved[0].cost).toBeCloseTo((100 * 1 + 900 * 0.1 + 50 * 5) / 1e6, 9)
  })

  it('streams SSE JSON progressively via onPartial and falls back on 400', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"{\\"sense\\":1,\\"meta\\":false,\\"zh\\":\\"逐渐"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"消磨\\",\\"en\\":\\"wear away\\",\\"tr\\":\\"整句翻译\\"}"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":45}}\n\n',
      'data: [DONE]\n\n',
    ]
    const enc = new TextEncoder()
    const stream = new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch))
        c.close()
      },
    })
    const partials: Record<string, unknown>[] = []
    const f = vi.fn(async () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }))
    const { saved, d } = deps(f as unknown as typeof fetch)
    const out = await callAI(cfg, [{ role: 'user', content: 'x' }], { ...d, json: true, onPartial: (p) => partials.push({ ...p }) })
    expect(partials[0]).toEqual({ sense: 1, meta: false, zh: '逐渐' })
    expect(out).toEqual({ sense: 1, meta: false, zh: '逐渐消磨', en: 'wear away', tr: '整句翻译' })
    expect(saved[0]).toMatchObject({ req: 1, inTok: 120, outTok: 45 })

    let calls = 0
    const relay = vi.fn(async () => (++calls === 1 ? new Response('bad stream_options', { status: 400 }) : reply('{"zh":"回退"}')))
    const out2 = await callAI(cfg, [{ role: 'user', content: 'x' }], { ...deps(relay as unknown as typeof fetch).d, json: true, onPartial: () => {} })
    expect(calls).toBe(2)
    expect(out2).toEqual({ zh: '回退' })
  })

  it.each(['openai', 'anthropic'] as const)('rejects a %s stream that ends before the provider completes', async (provider) => {
    const content = '{"zh":"模拟响应"}'
    const delta = provider === 'openai' ? { choices: [{ delta: { content } }] } : { type: 'content_block_delta', delta: { text: content } }
    const encode = (tail: string) => new Response(`data: ${JSON.stringify(delta)}\n\n${tail}`, { headers: { 'content-type': 'text/event-stream' } })
    const f = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => encode(''))
      .mockImplementationOnce(async () => encode(provider === 'openai' ? 'data: [DONE]\n\n' : 'data: {"type":"message_stop"}\n\n'))
    const { d } = deps(f)
    const call = () => callAI({ ...cfg, provider }, [], { ...d, json: true, onPartial: () => {} })
    await expect(call()).rejects.toMatchObject({ code: 'format' })
    await expect(call()).resolves.toEqual({ zh: '模拟响应' })
  })

  it('cancels the in-flight request without retrying a long task', async () => {
    const controller = new AbortController()
    const f = vi.fn<typeof fetch>((_, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const { d } = deps(f)
    const result = callLong(cfg, 'system', 'user', { ...d, signal: controller.signal }, (out) => out)
    const outcome = expect(result).rejects.toMatchObject({ code: 'cancelled' })
    controller.abort()
    await outcome
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('enforces HTTPS for remote endpoints, omits credentials/referrer, and redacts API keys from errors', async () => {
    expect(isInsecureRemoteUrl('http://remote-relay.example.com/v1/chat/completions')).toBe(true)
    expect(isInsecureRemoteUrl('http://localhost:11434/v1/chat/completions')).toBe(false)
    expect(isInsecureRemoteUrl('http://127.0.0.1:1234/v1/chat/completions')).toBe(false)
    expect(isInsecureRemoteUrl('https://api.deepseek.com/chat/completions')).toBe(false)
    const f = vi.fn(async () => reply('hi'))
    await expect(callAI({ ...cfg, baseUrl: 'http://remote-relay.example.com/v1' }, [], deps(f as unknown as typeof fetch).d)).rejects.toMatchObject({ code: 'insecure-url' })
    expect(f).not.toHaveBeenCalled()
    await callAI({ ...cfg, baseUrl: 'http://localhost:11434/v1' }, [], deps(f as unknown as typeof fetch).d)
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(init).toMatchObject({ referrerPolicy: 'no-referrer', credentials: 'omit', cache: 'no-store' })
    const leak = deps((async () => new Response('invalid key sk-secret-999', { status: 401 })) as unknown as typeof fetch)
    await expect(callAI({ ...cfg, apiKey: 'sk-secret-999' }, [], leak.d)).rejects.toSatisfy((e: AIError) => !e.message.includes('sk-secret-999'))
    expect(extractPartialJSON('{"zh":"半截\\u4e2d","fam":["erosion n. 侵蚀","half')).toEqual({ zh: '半截中', fam: ['erosion n. 侵蚀'] })
  })
})

describe('pricing', () => {
  it('matches model names by prefix and takes manual prices first', () => {
    expect(matchPrice('deepseek-chat')?.label).toBe('DeepSeek V4.1 Flash')
    expect(matchPrice('deepseek-v4-pro')?.label).toBe('DeepSeek V4 Pro')
    expect(matchPrice('Kimi-K3.1-Pro')?.label).toBe('Kimi K3.1 Pro')
    expect(matchPrice('glm-5.3-flash')?.label).toBe('GLM-5.3-Flash')
    expect(matchPrice('claude-opus-5-5')?.out).toBe(20)
    expect(matchPrice('gpt-4o-mini')?.label).toBe('GPT-4o mini')
    expect(matchPrice('gemini-2.5-flash')?.label).toBe('Gemini 2.5 Flash')
    expect(matchPrice('my-model')).toBeNull()
    expect(priceOf({ ...cfg, model: 'my-model', cur: 'CNY', price: { in: 7.1, out: 14.2 } })).toMatchObject({ in: 1, out: 2, custom: true })
  })

  it('halves DeepSeek off peak by Beijing Time (UTC+8) and charges cache hits at the cache price', () => {
    const p = matchPrice('deepseek-chat')!
    const peak = new Date('2026-11-17T07:00:00Z') // Tue 15:00 Beijing
    const morningPeak = new Date('2026-11-17T01:00:00Z') // Tue 09:00 Beijing
    const lunch = new Date('2026-11-17T04:30:00Z') // Tue 12:30 Beijing
    const night = new Date('2026-11-17T14:00:00Z') // Tue 22:00 Beijing
    expect(beijingTime(peak).hhmm).toBe('15:00')
    expect(deepseekPeak(peak)).toBe(true)
    expect(deepseekPeak(morningPeak)).toBe(true)
    expect(deepseekPeak(lunch)).toBe(false)
    expect(deepseekPeak(night)).toBe(false)
    expect(deepseekPeak(new Date('2026-11-15T07:00:00Z'))).toBe(false) // Sun 15:00 Beijing
    const t = { in: 1e6, out: 1e6, cached: 5e5 }
    expect(costOf(p, t, peak)).toBeCloseTo(0.5 * 0.3 + 0.5 * 0.006 + 1.2, 6)
    expect(costOf(p, t, night)).toBeCloseTo((0.5 * 0.3 + 0.5 * 0.006 + 1.2) / 2, 6)
    expect(money(1, 'CNY')).toBe('¥7.10')
  })
})

describe('config', () => {
  it('folds the earlier DeepSeek preset into the OpenAI-compatible format', () => {
    expect(normalizeAIConfig({ provider: 'deepseek', baseUrl: '', model: 'deepseek-chat', apiKey: 'k', dailyLimit: 50 })).toEqual({
      provider: 'openai',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: 'k',
      dailyLimit: 50,
      budget: 5,
      cur: 'CNY',
    })
  })

  it('reads and clears the prototype settings from localStorage', () => {
    const m = new Map([['luzzle_ai_prov', 'openai'], ['luzzle_api_base', 'https://x/v1'], ['luzzle_api_key', 'sk']])
    expect(readLegacyAIConfig({ getItem: (k) => m.get(k) ?? null })).toMatchObject({ provider: 'openai', baseUrl: 'https://x/v1', apiKey: 'sk', model: '' })
    clearLegacyAIConfig({ removeItem: (k) => m.delete(k) })
    expect(m.size).toBe(0)
    expect(readLegacyAIConfig({ getItem: () => null })).toBeNull()
  })
})

describe('aiFailReason', async () => {
  const { aiFailReason } = await import('../reader/session')
  it('keeps plain outcomes including insecure-url guard', () => {
    expect(aiFailReason(new AIError('quota'))).toBe('AI 额度已满')
    expect(aiFailReason(new AIError('insecure-url'))).toBe('远端接口须使用 HTTPS')
    expect(aiFailReason(new AIError('http', '', 401))).toBe('AI 接口拒绝授权，请检查 API Key 和模型权限')
    expect(aiFailReason(new AIError('network'))).toBe('离线释义 · AI 暂不可用')
  })
})

describe('planOf and fitCalls', async () => {
  const { fitCalls, planOf } = await import('./Confirm')
  const { useApp } = await import('../app/store')
  it('estimates per-part output tokens and fits full budget-eligible plans', () => {
    useApp.setState({
      ai: { ...cfg, model: 'deepseek-chat', budget: 5, cur: 'CNY' },
      usage: emptyUsage(T),
    })
    const texts = Array.from({ length: 200 }, () => 'word '.repeat(350))
    const plan = planOf(texts, 'Translate to Chinese', 1.4)
    expect(plan.parts[0].outTok).toBeLessThan(8192)
    expect(fitCalls(plan).fit).toBe(200)
  })
})
