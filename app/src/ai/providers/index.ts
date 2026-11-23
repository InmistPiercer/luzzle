import type { AIConfig, ProviderId, ProviderSpec } from '../types'

const base = (cfg: AIConfig, fallback: string) => (cfg.baseUrl || fallback).replace(/\/+$/, '')

const PRIVACY_INIT: Partial<RequestInit> = {
  referrerPolicy: 'no-referrer',
  credentials: 'omit',
  cache: 'no-store',
}

const openai: ProviderSpec = {
  id: 'openai',
  label: 'OpenAI 兼容接口',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  build: (cfg, messages, opts) => ({
    url: `${base(cfg, openai.baseUrl)}/chat/completions`,
    init: {
      ...PRIVACY_INIT,
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model || openai.model,
        temperature: 0,
        messages,
        ...(opts?.json ? { response_format: { type: 'json_object' } } : {}),
        ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        ...(opts?.stream ? { stream: true, stream_options: { include_usage: true } } : {}),
      }),
    },
  }),
  read: (body) => {
    const text = (body as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content
    if (typeof text !== 'string') throw new Error('format')
    return text
  },
  readDelta: (chunk) => {
    const d = (chunk as { choices?: { delta?: { content?: string } }[] })?.choices?.[0]?.delta?.content
    return typeof d === 'string' ? d : ''
  },
  usage: (body) => {
    const u = (body as { usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } })?.usage
    return { in: u?.prompt_tokens || 0, out: u?.completion_tokens || 0, cached: u?.prompt_cache_hit_tokens ?? u?.prompt_tokens_details?.cached_tokens ?? 0 }
  },
  streamUsage: (chunk, acc) => {
    const u = openai.usage(chunk)
    return u.in || u.out ? u : acc
  },
}

const anthropic: ProviderSpec = {
  id: 'anthropic',
  label: 'Anthropic',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-haiku-4-5',
  build: (cfg, messages, opts) => ({
    url: `${base(cfg, anthropic.baseUrl)}/v1/messages`,
    init: {
      ...PRIVACY_INIT,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: cfg.model || anthropic.model,
        max_tokens: opts?.maxTokens || 500,
        ...(messages.some((m) => m.role === 'system') ? { system: messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n') } : {}),
        messages: messages.filter((m) => m.role !== 'system'),
        ...(opts?.stream ? { stream: true } : {}),
      }),
    },
  }),
  read: (body) => {
    const text = (body as { content?: { text?: string }[] })?.content?.[0]?.text
    if (typeof text !== 'string') throw new Error('format')
    return text
  },
  readDelta: (chunk) => {
    const c = chunk as { type?: string; delta?: { type?: string; text?: string } }
    return c?.type === 'content_block_delta' && typeof c.delta?.text === 'string' ? c.delta.text : ''
  },
  usage: (body) => {
    const u = (body as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } })?.usage
    const cached = u?.cache_read_input_tokens || 0
    return { in: (u?.input_tokens || 0) + cached + (u?.cache_creation_input_tokens || 0), out: u?.output_tokens || 0, cached }
  },
  streamUsage: (chunk, acc) => {
    const c = chunk as {
      type?: string
      message?: { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
      usage?: { output_tokens?: number }
    }
    if (c?.type === 'message_start' && c.message?.usage) {
      const u = anthropic.usage({ usage: c.message.usage })
      return { in: u.in || acc.in, out: u.out || acc.out, cached: u.cached ?? acc.cached }
    }
    if (c?.type === 'message_delta' && c.usage?.output_tokens != null) {
      return { ...acc, out: c.usage.output_tokens }
    }
    return acc
  },
}

export const PROVIDERS: ProviderSpec[] = [openai, anthropic]

export const providerOf = (id: string): ProviderSpec => PROVIDERS.find((p) => p.id === id) || openai

export const normalizeProvider = (id: string | undefined): ProviderId => (id === 'anthropic' ? 'anthropic' : 'openai')
