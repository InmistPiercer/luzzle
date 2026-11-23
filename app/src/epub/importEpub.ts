import JSZip from 'jszip'
import type { DocData, Para } from '../core/types'

export interface EpubUnit {
  title: string
  section: string
  files: string[]
  anchor?: string
  endAnchor?: string
  words: number
  paras: Para[]
}

export interface ParsedEpub {
  name: string
  title: string
  units: EpubUnit[]
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '')
const resolve = (base: string, href: string) => {
  const parts = (base + decodeURIComponent(href)).split('/')
  const out: string[] = []
  for (const s of parts) {
    if (s === '..') out.pop()
    else if (s !== '.') out.push(s)
  }
  return out.join('/')
}
const xml = (s: string, type: DOMParserSupportedType = 'application/xhtml+xml') => {
  const d = new DOMParser().parseFromString(s, type)
  return d.querySelector('parsererror') ? new DOMParser().parseFromString(s, 'text/html') : d
}
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
const count = (ps: Para[]) => ps.reduce((n, p) => n + (p.kind === 'code' ? 0 : (p.t || '').split(/\s+/).filter(Boolean).length), 0)

const SKIP = 'script,style,nav,figure,img,svg,table,aside,sup,math,.noteref,.footnote,.footnotes,[epub\\:type~="footnote"],[epub\\:type~="noteref"],[epub\\:type~="pagebreak"],[role="doc-noteref"],[role="doc-pagebreak"],[role="doc-footnote"]'
const BLOCK = /^(P|LI|BLOCKQUOTE|DD|DT|DIV|SECTION|ARTICLE|PRE|H[1-6]|UL|OL|DL|BODY|HEADER|FOOTER|MAIN|FIGCAPTION)$/

function walk(root: Element, out: { el: Element; kind: 'h' | 'p' | 'code' | 'li' }[], ids: Map<string, number>) {
  for (const el of Array.from(root.children)) {
    if (el.id) ids.set(el.id, out.length)
    el.querySelectorAll('[id]').forEach((x) => {
      if (!ids.has(x.id) && !BLOCK.test(x.tagName.toUpperCase())) ids.set(x.id, out.length)
    })
    if (el.matches(SKIP)) continue
    const tag = el.tagName.toUpperCase()
    if (/^H[1-6]$/.test(tag)) out.push({ el, kind: 'h' })
    else if (tag === 'PRE') out.push({ el, kind: 'code' })
    else if (tag === 'P' || tag === 'DT' || tag === 'DD' || tag === 'FIGCAPTION') out.push({ el, kind: 'p' })
    else if (tag === 'LI' || tag === 'BLOCKQUOTE' || tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'MAIN' || tag === 'HEADER') {
      const hasBlock = Array.from(el.children).some((c) => BLOCK.test(c.tagName.toUpperCase()))
      if (hasBlock) walk(el, out, ids)
      else out.push({ el, kind: tag === 'LI' ? 'li' : 'p' })
    } else if (tag === 'UL' || tag === 'OL' || tag === 'DL') walk(el, out, ids)
  }
}

const textOf = (el: Element) => {
  const c = el.cloneNode(true) as Element
  c.querySelectorAll(SKIP).forEach((x) => x.remove())
  c.querySelectorAll('br').forEach((x) => x.replaceWith(' '))
  return norm(c.textContent || '')
}

interface FileBlocks {
  blocks: { kind: 'h' | 'p' | 'code' | 'li'; text: string }[]
  ids: Map<string, number>
  heading: string
}

async function readFile(zip: JSZip, path: string): Promise<FileBlocks> {
  const raw = await zip.file(path)?.async('string')
  if (!raw) return { blocks: [], ids: new Map(), heading: '' }
  const doc = xml(raw)
  const body = doc.querySelector('body') || doc.documentElement
  const items: { el: Element; kind: 'h' | 'p' | 'code' | 'li' }[] = []
  const ids = new Map<string, number>()
  walk(body, items, ids)
  const blocks = items
    .map((x) => ({ kind: x.kind, text: x.kind === 'code' ? (x.el.textContent || '').replace(/\s+$/, '') : textOf(x.el) }))
    .filter((b) => b.text)
  return { blocks, ids, heading: blocks.find((b) => b.kind === 'h')?.text || '' }
}

interface TocEntry {
  title: string
  file: string
  anchor?: string
  depth: number
}

function navToc(doc: Document, base: string): TocEntry[] {
  const nav = Array.from(doc.querySelectorAll('nav')).find((n) => /toc/.test(n.getAttribute('epub:type') || n.getAttribute('role') || n.id || '')) || doc.querySelector('nav')
  if (!nav) return []
  const out: TocEntry[] = []
  nav.querySelectorAll('a[href]').forEach((a) => {
    let depth = 0
    for (let p = a.parentElement; p && p !== nav; p = p.parentElement) if (p.tagName.toUpperCase() === 'OL' || p.tagName.toUpperCase() === 'UL') depth++
    const [f, anchor] = (a.getAttribute('href') || '').split('#')
    out.push({ title: norm(a.textContent || ''), file: resolve(base, f), anchor, depth })
  })
  return out
}

function ncxToc(doc: Document, base: string): TocEntry[] {
  const out: TocEntry[] = []
  const visit = (el: Element, depth: number) => {
    for (const np of Array.from(el.children).filter((c) => c.localName === 'navPoint')) {
      const label = norm(np.querySelector('navLabel text, navLabel')?.textContent || '')
      const src = np.querySelector('content')?.getAttribute('src') || ''
      const [f, anchor] = src.split('#')
      out.push({ title: label, file: resolve(base, f), anchor, depth })
      visit(np, depth + 1)
    }
  }
  const map = Array.from(doc.getElementsByTagName('*')).find((e) => e.localName === 'navMap')
  if (map) visit(map, 1)
  return out
}

export async function parseEpub(buf: ArrayBuffer, name: string): Promise<ParsedEpub> {
  const zip = await JSZip.loadAsync(buf)
  const container = await zip.file('META-INF/container.xml')?.async('string')
  const opfPath = (container && /full-path="([^"]+)"/.exec(container)?.[1]) || Object.keys(zip.files).find((f) => f.endsWith('.opf')) || ''
  const opf = xml((await zip.file(opfPath)?.async('string')) || '<package/>', 'application/xml')
  const base = dirOf(opfPath)
  const all = Array.from(opf.getElementsByTagName('*'))
  const title = norm(all.find((e) => e.localName === 'title')?.textContent || '') || name.replace(/\.epub$/i, '')
  const manifest = new Map<string, { href: string; props: string; type: string }>()
  for (const e of all.filter((x) => x.localName === 'item')) manifest.set(e.getAttribute('id') || '', { href: resolve(base, e.getAttribute('href') || ''), props: e.getAttribute('properties') || '', type: e.getAttribute('media-type') || '' })
  const spine = all.filter((x) => x.localName === 'itemref').map((e) => manifest.get(e.getAttribute('idref') || '')?.href || '').filter((h) => h && zip.file(h))
  const files = new Map<string, FileBlocks>()
  for (const f of spine) files.set(f, await readFile(zip, f))
  let toc: TocEntry[] = []
  const navItem = [...manifest.values()].find((m) => m.props.split(' ').includes('nav'))
  if (navItem && zip.file(navItem.href)) toc = navToc(xml((await zip.file(navItem.href)!.async('string')) || ''), dirOf(navItem.href))
  if (!toc.length) {
    const ncx = [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml')
    if (ncx && zip.file(ncx.href)) toc = ncxToc(xml((await zip.file(ncx.href)!.async('string')) || '', 'application/xml'), dirOf(ncx.href))
  }
  toc = toc.filter((t) => spine.includes(t.file))
  const seen = new Set<string>()
  toc = toc.filter((t) => {
    const k = `${t.file}#${t.anchor || ''}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  if (toc.length && spine.indexOf(toc[0].file) > 0) toc.unshift(...spine.slice(0, spine.indexOf(toc[0].file)).map((f) => ({ title: files.get(f)?.heading || '', file: f, depth: 1 })))
  if (!toc.length) toc = spine.map((f) => ({ title: files.get(f)?.heading || f.split('/').pop() || '', file: f, depth: 1 }))
  const pos = (t: TocEntry) => {
    const fb = files.get(t.file)
    return { si: spine.indexOf(t.file), bi: t.anchor && fb?.ids.has(t.anchor) ? (fb.ids.get(t.anchor) as number) : 0 }
  }
  const build = (entries: TocEntry[]) => {
    const sections: string[] = []
    return entries.map((t, i) => {
      sections[t.depth] = t.title
      const a = pos(t)
      const nx = entries[i + 1]
      const b = nx ? pos(nx) : { si: spine.length, bi: 0 }
      const blocks: FileBlocks['blocks'] = []
      for (let si = a.si; si <= Math.min(b.si, spine.length - 1); si++) {
        const fb = files.get(spine[si])?.blocks || []
        const from = si === a.si ? a.bi : 0
        const to = si === b.si ? b.bi : fb.length
        blocks.push(...fb.slice(from, to))
      }
      const paras: Para[] = blocks.map((x) => (x.kind === 'h' ? { h: x.text } : x.kind === 'code' ? { raw: '', t: x.text, kind: 'code' as const } : x.kind === 'li' ? { raw: '', t: x.text, kind: 'list' as const } : { raw: '', t: x.text }))
      const key = (x: string) => norm(x).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      while (paras[0]?.h && key(t.title).includes(key(paras[0].h))) paras.shift()
      const unit: EpubUnit = { title: t.title || blocks.find((x) => x.kind === 'h')?.text || `${i + 1}`, section: t.depth > 1 ? sections[t.depth - 1] || '' : '', files: [], words: count(paras), paras }
      return unit
    })
  }
  const top = toc.filter((t) => t.depth <= 1)
  const topUnits = build(top)
  const nextOf = (t: TocEntry) => toc[toc.indexOf(t) + 1]
  const parents = top.filter((t) => nextOf(t)?.depth === 2)
  const ownWords = (t: TocEntry) => build([t, nextOf(t)])[0].words
  const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)] || 0
  const dividers = parents.length >= 2 && parents.filter((t) => ownWords(t) < 150).length > parents.length / 2
  const huge = median(topUnits.map((u) => u.words)) > 15000
  const units = dividers || huge || top.length < 3 ? build(toc.filter((t) => t.depth <= 2)) : topUnits
  return { name, title, units: units.filter((u) => u.paras.length || u.words) }
}

export function buildEpubDoc(u: EpubUnit, vault: number, id: string): DocData {
  let n = 0
  const paras = u.paras.map((p) => (p.h ? { h: p.h } : { ...p, id: `${id}-P${++n}` }))
  return { id, title: u.title, vault, rebuilt: false, cachedRebuilt: false, user: true, paras }
}
