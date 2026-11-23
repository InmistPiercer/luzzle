import type { Tokens } from './pricing'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ProviderId = 'openai' | 'anthropic'

export interface AIConfig {
  provider: ProviderId
  baseUrl: string
  apiKey: string
  model: string
  dailyLimit: number
  budget: number
  cur: 'CNY' | 'USD'
  price?: { in: number; out: number }
}

export interface BuildOpts {
  json?: boolean
  maxTokens?: number
  stream?: boolean
}

export interface ProviderSpec {
  id: ProviderId
  label: string
  baseUrl: string
  model: string
  build: (cfg: AIConfig, messages: ChatMessage[], opts?: BuildOpts) => { url: string; init: RequestInit }
  read: (body: unknown) => string
  usage: (body: unknown) => Tokens
  readDelta?: (chunk: unknown) => string
  streamUsage?: (chunk: unknown, acc: Tokens) => Tokens
}

export type AIErrorCode = 'no-key' | 'quota' | 'timeout' | 'network' | 'http' | 'format' | 'insecure-url'

export class AIError extends Error {
  code: AIErrorCode
  status?: number

  constructor(code: AIErrorCode, message?: string, status?: number) {
    super(message || code)
    this.code = code
    this.status = status
  }
}
