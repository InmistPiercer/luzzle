import { useApp } from '../app/store'
import { allDocs, deleteDoc, paraIdsOf, purgeMarks, restoreDoc } from '../content/docs'
import type { DocData } from '../core/types'
import { startEpubImport, startPdfImport } from '../pdf/PdfUI'
import { parseTextDoc } from './importDoc'
import { useReader } from './session'

export function importReaderFile(f: File | undefined) {
  if (!f) return
  const { data, update, say, go, view } = useApp.getState()
  if (view !== 'read') go('read')
  if (/\.pdf$/i.test(f.name)) return void startPdfImport(f)
  if (/\.epub$/i.test(f.name)) return void startEpubImport(f)
  if (!/\.(txt|md|markdown)$/i.test(f.name)) return say('目前支持 EPUB / PDF / TXT / Markdown')
  void f.text().then((t) => {
    const nd = parseTextDoc(t, f.name, data.curVault)
    update((d) => ({ ...d, docs: [...d.docs, nd as unknown as (typeof d.docs)[number]] }))
    useReader.getState().set({ cur: nd.id, sel: null, po: false, ctx: false })
    say(nd.title)
  })
}

export function cleanupLater(doc: DocData) {
  setTimeout(() => {
    const d = useApp.getState().data
    const docs = allDocs(d)
    if (docs.some((x) => x.id === doc.id)) return
    const pids = paraIdsOf(doc)
    const marks = purgeMarks(d.marks, pids)
    if (Object.keys(marks).length !== Object.keys(d.marks).length) useApp.getState().update((x) => ({ ...x, marks: purgeMarks(x.marks, pids) }))
  }, 6000)
}

export function removeDocWithUndo(id: string) {
  const { data, update, say } = useApp.getState()
  const doc = allDocs(data).find((x) => x.id === id)
  if (!doc) return
  const out = deleteDoc(data, id)
  update(() => out.data)
  const r = useReader.getState()
  if (r.cur === id) r.set({ cur: null, sel: null, po: false, ctx: false, ann: null })
  say(`已删除「${doc.title}」`, () => {
    useApp.getState().update((x) => restoreDoc(x, out.removed))
    useReader.getState().set({ cur: id })
  })
  cleanupLater(doc)
}
