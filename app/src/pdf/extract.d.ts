export interface PdfItem {
  s: string
  x: number
  y: number
  w: number
  fs: number
}

export interface PdfPage {
  n: number
  w: number
  h: number
  items: PdfItem[]
}

export interface PdfLine {
  col: string
  y: number
  x: number
  w: number
  fs: number
  text: string
  start?: boolean
}

export interface OutlineEntry {
  title: string
  section: string
  page: number
  end: number
}

export interface RulePara {
  h?: string
  t?: string
  pg: number
}

export const PROMPT: string
export function words(s: string): string[]
export function faithful(out: string, hay: string[]): boolean
export function readPdf(data: ArrayBuffer): Promise<{ pages: PdfPage[]; outline: OutlineEntry[]; title: string }>
export function bodySize(pages: PdfPage[]): number
export function pageLines(p: PdfPage, body: number): PdfLine[]
export function markParas(lines: PdfLine[], body: number): PdfLine[]
export function detectArticles(allLines: PdfLine[][], body: number): { title: string; pi: number; li: number }[]
export const JUNK: RegExp
export function loadDictWords(): Promise<void>
export function clean(t: string): string
export function joinHyphen(prev: string, next: string): string
export function ruleParas(pagesLines: PdfLine[][], pages: PdfPage[], body: number): RulePara[]
export function mathy(t: string): boolean
export function stripLead(t: string): string
