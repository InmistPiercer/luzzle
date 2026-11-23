import { useEffect, useState } from 'react'
import { BoardView } from '../board/BoardView'
import { today } from '../core/date'
import { desktop, type DesktopFile } from '../core/desktop'
import { ForgeView } from '../forge/ForgeView'
import { MorphView } from '../morph/MorphView'
import { importReaderFile } from '../reader/docActions'
import { FlyLayer } from '../reader/FlyLayer'
import { ReaderView } from '../reader/ReaderView'
import { exportBackup } from '../storage/persist'
import { DemoAsk } from './DemoAsk'
import { IS_TEST } from '../core/edition'
import { Nav } from './Nav'
import { DeleteParentModal } from './DeleteParentModal'
import { Settings } from './Settings'
import { useApp, useDueCount } from './store'
import { SVG_DEFS } from './svgDefs'
import { Toast } from './Toast'
import { useSenseSync } from '../learn/senseSync'

export function App() {
  const ready = useApp((x) => x.ready)
  const view = useApp((x) => x.view)
  const hydrate = useApp((x) => x.hydrate)
  const prefs = useApp((x) => x.data.prefs)
  const settings = useApp((x) => x.settingsOpen)
  const setSettings = (v: boolean) => useApp.setState({ settingsOpen: v })

  useEffect(() => {
    document.title = IS_TEST ? 'Luzzle · 测试版' : 'Luzzle'
    void hydrate()
  }, [hydrate])
  useEffect(() => {
    if (!desktop) return
    return desktop.onMenuAction((action, payload) => {
      const s = useApp.getState()
      if (action === 'open-settings') {
        useApp.setState({ settingsOpen: true })
      } else if (action === 'nav' && (payload === 'read' || payload === 'board' || payload === 'build' || payload === 'forge')) {
        s.go(payload)
      } else if (action === 'export-backup') {
        const url = URL.createObjectURL(new Blob([exportBackup(s.data)], { type: 'application/json' }))
        const a = Object.assign(document.createElement('a'), { href: url, download: `luzzle-backup-${today()}.json` })
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        s.say('已导出')
      } else if (action === 'open-files' && Array.isArray(payload)) {
        for (const it of payload as DesktopFile[]) {
          if (it?.name && it.bytes) importReaderFile(new File([new Uint8Array(it.bytes)], it.name))
        }
      }
    })
  }, [])
  useSenseSync()

  useEffect(() => {
    const el = document.documentElement
    el.dataset.style = prefs.style
    el.style.setProperty('--fs', `${prefs.fs}px`)
    el.style.setProperty('--w', `${prefs.ww}em`)
  }, [prefs])

  if (!ready) return null
  const on = (v: string) => `view${view === v ? ' on' : ''}`
  return (
    <>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: SVG_DEFS }} />
      <div className="app">
        <Nav onSettings={() => setSettings(true)} />
        <main className="sheet">
          <section className={on('read')} id="v-read">
            <ReaderView />
          </section>
          <section className={on('board')} id="v-board">
            <BoardView />
          </section>
          <section className={on('forge')} id="v-forge">
            <ForgeView />
          </section>
          <section className={on('build')} id="v-build">
            <MorphView />
          </section>
        </main>
        {prefs.style === 'amber' && <StatusBar />}
      </div>
      <Settings open={settings} onClose={() => setSettings(false)} />
      <DeleteParentModal />
      <FlyLayer />
      {IS_TEST && <DemoAsk />}
      <Toast />
    </>
  )
}

const MODE: Record<string, string> = { read: 'READ', board: 'BOARD', build: 'MORPH', forge: 'FORGE' }

function StatusBar() {
  const view = useApp((x) => x.view)
  const learn = useApp((x) => x.data.learn)
  const due = useDueCount()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const ids = Object.keys(learn)
  const live = ids.filter((id) => learn[id].stage === 5).length
  const cells: [string, string | number][] = [
    ['MODE', MODE[view] || ''],
    ['PIECES', ids.length],
    ['DUE', due],
    ['LIVE', live],
  ]
  return (
    <footer className="term-bar">
      {cells.map(([k, v]) => (
        <span key={k}>
          {k} <b>{v}</b>
        </span>
      ))}
      <time>{now.toTimeString().slice(0, 8)}</time>
    </footer>
  )
}
