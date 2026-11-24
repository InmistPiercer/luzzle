import type { AIConfig } from './types'

export const PRICE_DATE = '2026-11-17'
export const USD_CNY = 7.1

export interface Tokens {
  in: number
  out: number
  cached?: number
}

export interface Price {
  label: string
  in: number
  cache: number
  out: number
  peak?: 'deepseek'
  custom?: boolean
}

type Row = [key: string, label: string, input: number, cache: number | null, output: number, peak?: 'deepseek']

const ROWS: Row[] = [
  ['gpt-6-astra', 'GPT-6 Astra', 10, 1, 50],
  ['gpt-6-1-sol', 'GPT-6.1 Sol', 2, 0.1, 10],
  ['gpt-6-sol', 'GPT-6 Sol', 2, 0.1, 10],
  ['gpt-6-1-terra', 'GPT-6.1 Terra', 1, 0.05, 5],
  ['gpt-6-luna', 'GPT-6 Luna', 0.1, 0.01, 0.5],
  ['gpt-5-6-sol', 'GPT-5.6 Sol', 4, 0.4, 20],
  ['gpt-5-mini', 'GPT-5 mini', 0.25, 0.025, 2],
  ['gpt-5-nano', 'GPT-5 nano', 0.05, 0.005, 0.4],
  ['gpt-5', 'GPT-5', 1.25, 0.125, 10],
  ['gpt-4-1-mini', 'GPT-4.1 mini', 0.4, 0.1, 1.6],
  ['gpt-4-1-nano', 'GPT-4.1 nano', 0.1, 0.025, 0.4],
  ['gpt-4-1', 'GPT-4.1', 2, 0.5, 8],
  ['gpt-4o-mini', 'GPT-4o mini', 0.15, 0.075, 0.6],
  ['gpt-4o', 'GPT-4o', 2.5, 1.25, 10],
  ['claude-fable-5-2', 'Claude Fable 5.2', 8, 0.2, 40],
  ['claude-fable-5-1', 'Claude Fable 5.1', 10, 0.25, 50],
  ['claude-opus-5-5', 'Claude Opus 5.5', 4, 0.2, 20],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5', 2, 0.1, 10],
  ['claude-haiku-5-5', 'Claude Haiku 5.5', 0.1, 0.01, 0.5],
  ['claude-haiku-4-5', 'Claude Haiku 4.5', 1, 0.1, 5],
  ['claude-opus-4', 'Claude Opus 4', 15, 1.5, 75],
  ['claude-sonnet-4', 'Claude Sonnet 4', 3, 0.3, 15],
  ['gemini-4-carbon', 'Gemini 4 Carbon', 2, 0.1, 10],
  ['gemini-4-argon', 'Gemini 4 Argon', 2, 0.1, 10],
  ['gemini-4-hydrogen', 'Gemini 4 Hydrogen', 1.5, 0.075, 7.5],
  ['gemini-3-8-flash', 'Gemini 3.8 Flash', 0.75, 0.075, 3.75],
  ['gemini-3-5-flash-lite', 'Gemini 3.5 Flash-Lite', 0.3, 0.03, 2.5],
  ['gemini-3-1-pro', 'Gemini 3.1 Pro', 2, 0.2, 12],
  ['gemini-2-5-pro', 'Gemini 2.5 Pro', 1.25, 0.125, 10],
  ['gemini-2-5-flash-lite', 'Gemini 2.5 Flash-Lite', 0.1, 0.025, 0.4],
  ['gemini-2-5-flash', 'Gemini 2.5 Flash', 0.3, 0.075, 2.5],
  ['grok-4-7', 'Grok 4.7', 2, 0.5, 6],
  ['grok-4-3', 'Grok 4.3', 1.25, 0.2, 2.5],
  ['grok-4-1-fast', 'Grok 4.1 Fast', 0.2, null, 0.5],
  ['deepseek-v4-pro', 'DeepSeek V4 Pro', 1.32, 0.044, 3.96, 'deepseek'],
  ['deepseek-reasoner', 'DeepSeek V4 Pro', 1.32, 0.044, 3.96, 'deepseek'],
  ['deepseek-r1', 'DeepSeek R1', 0.55, 0.14, 2.19, 'deepseek'],
  ['deepseek-v3', 'DeepSeek V3', 0.27, 0.07, 1.1, 'deepseek'],
  ['deepseek', 'DeepSeek V4.1 Flash', 0.3, 0.006, 1.2, 'deepseek'],
  ['qwen4-max', 'Qwen4 Max', 1.5, 0.075, 4.5],
  ['qwen3-7-plus', 'Qwen3.7-Plus', 0.276, null, 1.1],
  ['qwen3-8-flash', 'Qwen3.8-Flash', 0.15, null, 0.47],
  ['qwen3-7-flash', 'Qwen3.7-Flash', 0.03, null, 0.13],
  ['kimi-k3-1-pro', 'Kimi K3.1 Pro', 2, 0.2, 10],
  ['kimi-k3', 'Kimi K3', 3, 0.3, 15],
  ['kimi-k2-7', 'Kimi K2.7 Code', 0.95, 0.19, 4],
  ['kimi-k2-6', 'Kimi K2.6', 0.95, 0.16, 4],
  ['glm-5-3-flash', 'GLM-5.3-Flash', 0.11, 0.03, 0.39],
  ['glm-5-3', 'GLM-5.3', 1.13, 0.28, 3.94],
  ['mistral-medium-3-5', 'Mistral Medium 3.5', 1.5, null, 7.5],
  ['mistral-large-4', 'Mistral Large 4', 0.7, 0.07, 2.1],
  ['mistral-small-4', 'Mistral Small 4', 0.15, null, 0.6],
  ['m3-1-flash', 'MiniMax M3.1-Flash', 0.15, 0.015, 0.6],
]

const norm = (m: string) => m.toLowerCase().replace(/[\s._/]+/g, '-')

export function matchPrice(model: string): Price | null {
  const m = norm(model)
  const r = m && ROWS.find(([key]) => m.includes(key))
  return r ? { label: r[1], in: r[2], cache: r[3] ?? r[2], out: r[4], peak: r[5] } : null
}

export const toUSD = (v: number, cur: AIConfig['cur']) => (cur === 'CNY' ? v / USD_CNY : v)

export function priceOf(cfg: AIConfig, defaultModel = ''): Price | null {
  if (cfg.price && cfg.price.in > 0 && cfg.price.out > 0) {
    const i = toUSD(cfg.price.in, cfg.cur)
    return { label: '自定义', in: i, cache: i, out: toUSD(cfg.price.out, cfg.cur), custom: true }
  }
  return matchPrice(cfg.model || defaultModel)
}

export function beijingTime(at = new Date()) {
  const bj = new Date(at.getTime() + 8 * 3600_000)
  const day = bj.getUTCDay()
  const hour = bj.getUTCHours()
  const minute = bj.getUTCMinutes()
  return { day, hour, minute, hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` }
}

export function deepseekPeak(at = new Date()) {
  const { day, hour } = beijingTime(at)
  return day >= 1 && day <= 5 && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18))
}

export const priceRate = (p: Price, at = new Date()) => (p.peak === 'deepseek' && !deepseekPeak(at) ? 0.5 : 1)

export function costOf(p: Price, t: Tokens, at = new Date()) {
  const cached = Math.min(t.cached || 0, t.in)
  return (((t.in - cached) * p.in + cached * p.cache + t.out * p.out) / 1e6) * priceRate(p, at)
}

export const maxCost = (p: Price, t: Tokens) => (t.in * p.in + t.out * p.out) / 1e6

export const estTokens = (text: string) => Math.ceil(text.length / 3.6)

export function money(usd: number, cur: AIConfig['cur']) {
  const v = cur === 'CNY' ? usd * USD_CNY : usd
  const s = v >= 10 ? v.toFixed(1) : v >= 0.1 ? v.toFixed(2) : v.toFixed(3)
  return `${cur === 'CNY' ? '¥' : '$'}${s}`
}
