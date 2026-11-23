import Dexie, { type EntityTable } from 'dexie'
import type { AppState, UserDoc } from '../core/types'

interface KV {
  key: string
  value: unknown
  revision?: number
}

export interface ReviewRow {
  id?: number
  at: number
  day: string
  piece: string
  card: string
  task: string
  grade: number
  fresh: boolean
  source: string
}

interface CacheRow {
  key: string
  value: unknown
  at: number
}

export class LuzzleDB extends Dexie {
  kv!: EntityTable<KV, 'key'>
  docs!: EntityTable<UserDoc, 'id'>
  cache!: EntityTable<CacheRow, 'key'>
  reviews!: EntityTable<ReviewRow, 'id'>

  constructor(name = 'luzzle') {
    super(name)
    this.version(1).stores({ kv: '&key', docs: '&id', cache: '&key, at' })
    this.version(2).stores({ kv: '&key', docs: '&id', cache: '&key, at', files: '&id' })
    this.version(3).stores({ kv: '&key', docs: '&id', cache: '&key, at', files: '&id', reviews: '++id, piece, day' })
    this.version(4).stores({ files: null })
  }
}

export const db = new LuzzleDB()

export type StoredState = Omit<AppState, 'docs'>
