import type { Day } from '../core/date'
import { costOf, estTokens, priceOf, toUSD, type Tokens } from './pricing'
import { normalizeProvider, providerOf } from './providers'
import { AIError, type AIConfig, type ChatMessage, type ProviderSpec } from './types'

export const AI_TIMEOUT_MS = 20000
export const LONG_MAX_TOKENS = 8192
const DEFAULT_MAX_TOKENS = 2048

export interface Tally {
  req: number
  inTok: number
  outTok: number
  cost: number
}

export interface Usage extends Tally {
  day: Day
  total: Tally & { since: Day }
}

export interface CallDeps {
  fetch?: typeof fetch
  today: Day
  usage: () => Usage
  record: (t: Tally) => void
  timeoutMs?: number
  jsonMode?: boolean
  maxTokens?: number
  estOut?: number
  onPartial?: (partial: Record<string, unknown>) => void
}

const ZERO: Tally = { req: 0, inTok: 0, outTok: 0, cost: 0 }

export const emptyUsage = (day: Day): Usage => ({ day, ...ZERO, total: { ...ZERO, since: day } })

export function addUsage(u: Usage, t: Tally, day: Day): Usage {
  const cur = u.day === day ? u : { ...u, day, ...ZERO }
  const add = <T extends Tally>(a: T): T => ({ ...a, req: a.req + t.req, inTok: a.inTok + t.inTok, outTok: a.outTok + t.outTok, cost: a.cost + t.cost })
  return { ...add(cur), total: add(cur.total) }
}

export const todayOf = (u: Usage, day: Day): Tally => (u.day === day ? u : ZERO)

const active = new WeakMap<CallDeps['usage'], Map<Day, Tally>>()

export const reservedInput = (messages: ChatMessage[]) =>
  messages.reduce((sum, message) => sum + estTokens(message.content) + 24, 32)

export function accountedUsage(deps: CallDeps): Tally {
  const recorded = todayOf(deps.usage(), deps.today)
  const pending = active.get(deps.usage)?.get(deps.today) || ZERO
  return { ...recorded, req: recorded.req + pending.req, cost: recorded.cost + pending.cost }
}

export function overLimit(cfg: AIConfig, u: Tally) {
  const p = priceOf(cfg, providerOf(cfg.provider).model)
  if (p) return cfg.budget > 0 && u.cost >= toUSD(cfg.budget, cfg.cur)
  return cfg.dailyLimit > 0 && u.req >= cfg.dailyLimit
}

export const defaultAIConfig = (): AIConfig => ({
  provider: 'openai',
  baseUrl: '',
  apiKey: '',
  model: '',
  dailyLimit: 30,
  budget: 5,
  cur: 'CNY',
})

export const normalizeAIConfig = (raw: Omit<Partial<AIConfig>, 'provider'> & { provider?: string } = {}): AIConfig => {
  const legacyDeepseek = raw.provider === 'deepseek'
  return {
    ...defaultAIConfig(),
    ...raw,
    provider: normalizeProvider(raw.provider),
    baseUrl: raw.baseUrl || (legacyDeepseek ? 'https://api.deepseek.com' : ''),
    dailyLimit: Math.max(5, raw.dailyLimit || 30),
    budget: raw.budget ?? 5,
    cur: raw.cur === 'USD' ? 'USD' : 'CNY',
  }
}

export const readLegacyAIConfig = (storage: Pick<Storage, 'getItem'>): AIConfig | null => {
  const g = (k: string) => storage.getItem(`luzzle_${k}`) ?? storage.getItem(`lx_${k}`) ?? ''
  const apiKey = g('api_key')
  if (!apiKey) return null
  return normalizeAIConfig({ provider: g('ai_prov'), baseUrl: g('api_base'), model: g('api_model'), apiKey })
}

export const clearLegacyAIConfig = (storage: Pick<Storage, 'removeItem'>) => {
  for (const p of ['luzzle_', 'lx_']) {
    for (const k of ['api_key', 'ai_prov', 'api_base', 'api_model']) storage.removeItem(p + k)
  }
}

export function isInsecureRemoteUrl(rawUrl: string): boolean {
  try {
    const origin = typeof location !== 'undefined' ? location.origin : 'https://localhost'
    const u = new URL(rawUrl, origin)
    if (u.protocol === 'https:') return false
    if (u.protocol !== 'http:') return true
    const h = u.hostname.toLowerCase()
    return h !== 'localhost' && h !== '127.0.0.1' && h !== '[::1]' && h !== '::1'
  } catch {
    return true
  }
}

function readJsonStr(s: string, start: number): { val: string; next: number; done: boolean } {
  let out = ''
  let i = start + 1
  const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }
  while (i < s.length) {
    const ch = s[i]
    if (ch === '"') return { val: out, next: i + 1, done: true }
    if (ch === '\\') {
      if (i + 1 >= s.length) break
      const esc = s[i + 1]
      if (esc === 'u') {
        if (i + 6 > s.length) break
        const hex = s.slice(i + 2, i + 6)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16))
          i += 6
          continue
        }
      }
      out += map[esc] ?? esc
      i += 2
      continue
    }
    out += ch
    i++
  }
  return { val: out, next: i, done: false }
}

export function extractPartialJSON(s: string): Record<string, unknown> | null {
  const first = s.indexOf('{')
  if (first < 0) return null
  if (s.trimEnd().endsWith('}')) {
    try {
      const full = extractJSON(s)
      if (full && typeof full === 'object' && !Array.isArray(full)) return full as Record<string, unknown>
    } catch {}
  }
  const out: Record<string, unknown> = {}
  let i = first + 1
  const skip = () => {
    while (i < s.length && /[\s,]/.test(s[i])) i++
  }
  while (i < s.length) {
    skip()
    if (i >= s.length || s[i] === '}') break
    if (s[i] !== '"') break
    const k = readJsonStr(s, i)
    if (!k.done) break
    i = k.next
    while (i < s.length && /\s/.test(s[i])) i++
    if (s[i] !== ':') break
    i++
    while (i < s.length && /\s/.test(s[i])) i++
    if (i >= s.length) break
    const c = s[i]
    if (c === '"') {
      const v = readJsonStr(s, i)
      out[k.val] = v.val
      i = v.next
      if (!v.done) break
    } else if (s.startsWith('true', i)) {
      out[k.val] = true
      i += 4
    } else if (s.startsWith('false', i)) {
      out[k.val] = false
      i += 5
    } else if (s.startsWith('null', i)) {
      out[k.val] = null
      i += 4
    } else if (c === '-' || (c >= '0' && c <= '9')) {
      const m = s.slice(i).match(/^-?\d+(?:\.\d+)?/)
      if (!m) break
      const end = i + m[0].length
      if (end < s.length && /[\s,}]/.test(s[end])) {
        out[k.val] = Number(m[0])
        i = end
      } else break
    } else if (c === '[' || c === '{') {
      const open = c
      const close = c === '[' ? ']' : '}'
      let depth = 0
      let j = i
      let str = false
      while (j < s.length) {
        const x = s[j]
        if (str) {
          if (x === '\\') j++
          else if (x === '"') str = false
        } else if (x === '"') str = true
        else if (x === open) depth++
        else if (x === close && --depth === 0) {
          j++
          break
        }
        j++
      }
      if (depth === 0) {
        try {
          out[k.val] = JSON.parse(s.slice(i, j))
        } catch {}
        i = j
      } else {
        if (open === '[') {
          const items: string[] = []
          let p = i + 1
          while (p < s.length) {
            while (p < s.length && /[\s,]/.test(s[p])) p++
            if (p >= s.length || s[p] !== '"') break
            const elem = readJsonStr(s, p)
            if (!elem.done) break
            items.push(elem.val)
            p = elem.next
          }
          if (items.length) out[k.val] = items
        }
        break
      }
    } else break
  }
  return Object.keys(out).length ? out : null
}

async function readSSE(res: Response, spec: ProviderSpec, onText: (t: string) => void): Promise<{ text: string; usage: Tokens }> {
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let text = ''
  let usage: Tokens = { in: 0, out: 0 }
  const feed = (line: string) => {
    if (!line.startsWith('data:')) return
    const raw = line.slice(5).trim()
    if (!raw || raw === '[DONE]') return
    try {
      const pkt: unknown = JSON.parse(raw)
      if (spec.streamUsage) usage = spec.streamUsage(pkt, usage)
      const delta = spec.readDelta ? spec.readDelta(pkt) : ''
      if (delta) {
        text += delta
        onText(text)
      }
    } catch {}
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl = buf.indexOf('\n')
    while (nl >= 0) {
      feed(buf.slice(0, nl).trim())
      buf = buf.slice(nl + 1)
      nl = buf.indexOf('\n')
    }
  }
  buf += dec.decode()
  if (buf.trim()) feed(buf.trim())
  return { text, usage }
}

export const extractJSON = (s: string) => {
  const m = s.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('format')
  try {
    return JSON.parse(m[0])
  } catch {
    return JSON.parse(m[0].replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\'))
  }
}

export async function callLong<T>(cfg: AIConfig, system: string, user: string, deps: CallDeps, accept: (out: Record<string, unknown>) => T | null, onTry?: () => void): Promise<T | null> {
  const estOut = Math.min(LONG_MAX_TOKENS, Math.max(256, Math.ceil(estTokens(user) * 1.5)))
  for (let t = 0; t < 2; t++) {
    try {
      onTry?.()
      const out = (await callAI(cfg, [{ role: 'system', content: system }, { role: 'user', content: user }], { ...deps, json: true, jsonMode: true, maxTokens: LONG_MAX_TOKENS, estOut, timeoutMs: 60000 })) as Record<string, unknown>
      const v = accept(out)
      if (v != null) return v
    } catch (e) {
      const code = (e as AIError).code
      if (code === 'quota' || code === 'no-key' || code === 'insecure-url') throw e
    }
  }
  return null
}

export async function callAI(cfg: AIConfig, messages: ChatMessage[], deps: CallDeps & { json: true }): Promise<unknown>
export async function callAI(cfg: AIConfig, messages: ChatMessage[], deps: CallDeps & { json?: false }): Promise<string>
export async function callAI(cfg: AIConfig, messages: ChatMessage[], deps: CallDeps & { json?: boolean }): Promise<unknown> {
  if (!cfg.apiKey) throw new AIError('no-key')
  const spec = providerOf(cfg.provider)
  const p = priceOf(cfg, spec.model)
  const maxTokens = deps.maxTokens ?? DEFAULT_MAX_TOKENS
  const wantStream = !!deps.onPartial
  const { url, init } = spec.build(cfg, messages, { json: deps.jsonMode, maxTokens, stream: wantStream })
  if (isInsecureRemoteUrl(url)) throw new AIError('insecure-url')
  const reserved = p ? costOf(p, { in: reservedInput(messages), out: Math.min(maxTokens, deps.estOut ?? maxTokens) }) : 0
  const used = accountedUsage(deps)
  if (overLimit(cfg, used) || (p && cfg.budget > 0 && used.cost + reserved > toUSD(cfg.budget, cfg.cur))) throw new AIError('quota')
  const days = active.get(deps.usage) || new Map<Day, Tally>()
  const pending = days.get(deps.today) || { ...ZERO }
  active.set(deps.usage, days)
  days.set(deps.today, pending)
  pending.req++
  pending.cost += reserved
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? AI_TIMEOUT_MS)
  const doFetch = deps.fetch || fetch
  try {
    let res = await doFetch(url, { ...init, signal: ctrl.signal })
    if (wantStream && res.status === 400) {
      const fallback = spec.build(cfg, messages, { json: deps.jsonMode, maxTokens })
      res = await doFetch(fallback.url, { ...fallback.init, signal: ctrl.signal })
    }
    if (!res.ok) {
      const raw = await res.text().catch(() => '')
      const safe = cfg.apiKey ? raw.split(cfg.apiKey).join('***') : raw
      throw new AIError('http', safe, res.status)
    }
    try {
      const ct = res.headers.get('content-type') || ''
      if (wantStream && res.body && ct.includes('text/event-stream')) {
        const { text, usage } = await readSSE(res, spec, (acc) => {
          if (!deps.json || !deps.onPartial) return
          const partial = extractPartialJSON(acc)
          if (partial) deps.onPartial(partial)
        })
        const t = usage.in || usage.out ? usage : { in: reservedInput(messages), out: estTokens(text) }
        deps.record({ req: 1, inTok: t.in, outTok: t.out, cost: p ? costOf(p, t) : 0 })
        return deps.json ? extractJSON(text) : text
      }
      const body: unknown = await res.json()
      const t = spec.usage(body)
      deps.record({ req: 1, inTok: t.in, outTok: t.out, cost: p ? costOf(p, t) : 0 })
      const text = spec.read(body)
      return deps.json ? extractJSON(text) : text
    } catch {
      throw new AIError(ctrl.signal.aborted ? 'timeout' : 'format')
    }
  } catch (e) {
    if (e instanceof AIError) throw e
    const msg = String(e)
    throw new AIError(ctrl.signal.aborted ? 'timeout' : 'network', cfg.apiKey ? msg.split(cfg.apiKey).join('***') : msg)
  } finally {
    clearTimeout(timer)
    pending.req--
    pending.cost = Math.max(0, pending.cost - reserved)
    if (!pending.req) days.delete(deps.today)
  }
}
