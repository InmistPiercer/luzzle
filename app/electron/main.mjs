import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, session, shell } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
app.setName('Luzzle')
const isTest = process.env.LUZZLE_EDITION === 'test'
const isSmoke = process.env.LUZZLE_SMOKE_TEST === '1'
const devUrl = process.env.ELECTRON_RENDERER_URL || ''
const distDir = path.resolve(__dirname, '..', isTest ? 'dist-test' : 'dist')
const DOC_EXT = /\.(pdf|epub|txt|md|markdown)$/i
const MAX_BACKUPS = 10

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

const mimeOf = (file) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'

let mainWin = null
let winReady = false
const pendingPaths = []

function extractDocArgs(argv) {
  return argv.filter((arg) => !arg.startsWith('-') && DOC_EXT.test(arg) && fs.existsSync(arg))
}

async function dispatchFiles(filePaths) {
  const valid = filePaths.filter((p) => DOC_EXT.test(p))
  if (!valid.length) return
  if (!mainWin || !winReady) {
    pendingPaths.push(...valid)
    return
  }
  const items = []
  for (const p of valid) {
    try {
      const buf = await fsp.readFile(p)
      items.push({ name: path.basename(p), bytes: new Uint8Array(buf) })
    } catch {}
  }
  if (items.length && mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('luzzle:menu', 'open-files', items)
  }
}

const statePath = () => path.join(app.getPath('userData'), 'window-state.json')
const secretPath = () => path.join(app.getPath('userData'), 'ai-key.enc')
const backupsDir = () => path.join(app.getPath('userData'), 'backups')

function readWinState() {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'))
    if (typeof raw.width === 'number' && typeof raw.height === 'number') return raw
  } catch {}
  return { width: 1320, height: 860 }
}

function saveWinState(win) {
  try {
    const maximized = win.isMaximized()
    const bounds = maximized ? readWinState() : win.getBounds()
    fs.writeFileSync(statePath(), JSON.stringify({ ...bounds, maximized }))
  } catch {}
}

function registerIPC() {
  const canEncrypt = async () =>
    typeof safeStorage.isAsyncEncryptionAvailable === 'function'
      ? safeStorage.isAsyncEncryptionAvailable()
      : safeStorage.isEncryptionAvailable()

  ipcMain.handle('luzzle:secret:get', async () => {
    try {
      if (!(await canEncrypt())) return ''
      const buf = await fsp.readFile(secretPath())
      if (typeof safeStorage.decryptStringAsync === 'function') {
        const out = await safeStorage.decryptStringAsync(buf)
        return out.result
      }
      return safeStorage.decryptString(buf)
    } catch {
      return ''
    }
  })

  ipcMain.handle('luzzle:secret:set', async (_ev, val) => {
    try {
      const text = String(val ?? '')
      if (!text) {
        await fsp.unlink(secretPath()).catch(() => undefined)
        return true
      }
      if (!(await canEncrypt())) return false
      const enc = typeof safeStorage.encryptStringAsync === 'function' ? await safeStorage.encryptStringAsync(text) : safeStorage.encryptString(text)
      await fsp.mkdir(path.dirname(secretPath()), { recursive: true })
      await fsp.writeFile(secretPath(), enc, { mode: 0o600 })
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('luzzle:backup:auto', async (_ev, json, day) => {
    try {
      if (typeof json !== 'string' || !json.startsWith('{')) return false
      const safeDay = /^\d{4}-\d{2}-\d{2}$/.test(String(day)) ? String(day) : new Date().toISOString().slice(0, 10)
      const dir = backupsDir()
      await fsp.mkdir(dir, { recursive: true })
      const target = path.join(dir, `luzzle-auto-${safeDay}.json`)
      const tmp = `${target}.tmp`
      await fsp.writeFile(tmp, json, 'utf8')
      await fsp.rename(tmp, target)
      const files = (await fsp.readdir(dir)).filter((f) => /^luzzle-auto-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse()
      for (const old of files.slice(MAX_BACKUPS)) {
        await fsp.unlink(path.join(dir, old)).catch(() => undefined)
      }
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('luzzle:backup:open-dir', async () => {
    try {
      const dir = backupsDir()
      await fsp.mkdir(dir, { recursive: true })
      await shell.openPath(dir)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('luzzle:backup:clear', async () => {
    try {
      const dir = backupsDir()
      const files = await fsp.readdir(dir).catch(() => [])
      for (const f of files) {
        if (/^luzzle-auto-.*\.json$/.test(f)) await fsp.unlink(path.join(dir, f)).catch(() => undefined)
      }
      return true
    } catch {
      return false
    }
  })
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const send = (action, payload) => {
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('luzzle:menu', action, payload)
  }
  const openDialog = async () => {
    if (!mainWin) return
    const res = await dialog.showOpenDialog(mainWin, {
      title: '导入文档',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '文档 (EPUB / PDF / TXT / Markdown)', extensions: ['epub', 'pdf', 'txt', 'md', 'markdown'] }],
    })
    if (!res.canceled && res.filePaths.length) await dispatchFiles(res.filePaths)
  }

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about', label: '关于 Luzzle' },
              { type: 'separator' },
              { label: '设置…', accelerator: 'CmdOrCtrl+,', click: () => send('open-settings') },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide', label: '隐藏 Luzzle' },
              { role: 'hideOthers', label: '隐藏其他' },
              { role: 'unhide', label: '全部显示' },
              { type: 'separator' },
              { role: 'quit', label: '退出 Luzzle' },
            ],
          },
        ]
      : []),
    {
      label: '文件',
      submenu: [
        { label: '导入文档…', accelerator: 'CmdOrCtrl+O', click: () => void openDialog() },
        { label: '导出备份…', accelerator: 'CmdOrCtrl+S', click: () => send('export-backup') },
        {
          label: '打开自动备份目录',
          click: async () => {
            const dir = backupsDir()
            await fsp.mkdir(dir, { recursive: true })
            await shell.openPath(dir)
          },
        },
        ...(!isMac
          ? [
              { type: 'separator' },
              { label: '设置…', accelerator: 'CmdOrCtrl+,', click: () => send('open-settings') },
              { type: 'separator' },
              { role: 'quit', label: '退出' },
            ]
          : []),
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '拷贝' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '模块',
      submenu: [
        { label: '阅读', accelerator: 'CmdOrCtrl+1', click: () => send('nav', 'read') },
        { label: '拼板', accelerator: 'CmdOrCtrl+2', click: () => send('nav', 'board') },
        { label: '构词', accelerator: 'CmdOrCtrl+3', click: () => send('nav', 'build') },
        { label: '锻造', accelerator: 'CmdOrCtrl+4', click: () => send('nav', 'forge') },
        { type: 'separator' },
        ...(devUrl ? [{ role: 'reload', label: '重新加载' }, { role: 'toggleDevTools', label: '开发者工具' }, { type: 'separator' }] : []),
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '进入全屏幕' },
      ],
    },
    {
      label: '窗口',
      submenu: [{ role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放' }, { role: 'close', label: '关闭窗口' }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  const st = readWinState()
  const win = new BrowserWindow({
    x: st.x,
    y: st.y,
    width: Math.max(900, st.width || 1320),
    height: Math.max(620, st.height || 860),
    minWidth: 900,
    minHeight: 620,
    title: isTest ? 'Luzzle · 测试版' : 'Luzzle',
    backgroundColor: '#F6F4FC',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  })
  mainWin = win
  winReady = false
  if (st.maximized) win.maximize()

  win.once('ready-to-show', () => {
    if (!isSmoke) win.show()
  })
  win.on('close', () => saveWinState(win))
  win.on('closed', () => {
    mainWin = null
    winReady = false
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (ev, url) => {
    const allowed = devUrl ? url.startsWith(devUrl) : url.startsWith('app://luzzle/')
    if (!allowed) ev.preventDefault()
  })
  win.webContents.on('did-finish-load', () => {
    winReady = true
    if (pendingPaths.length) {
      const batch = pendingPaths.splice(0, pendingPaths.length)
      void dispatchFiles(batch)
    }
    if (isSmoke) {
      setTimeout(async () => {
        try {
          const info = await win.webContents.executeJavaScript(
            'fetch("./dict/a.json").then(r => r.ok).then(dictOk => ({ appReady: !!document.querySelector(".app"), isDesktop: !!window.luzzleDesktop?.isDesktop, origin: location.origin, title: document.title, dictOk }))',
          )
          process.stdout.write(`LUZZLE_SMOKE_OK ${JSON.stringify({ ...info, userData: app.getPath('userData') })}\n`)
          app.exit(0)
        } catch (err) {
          process.stderr.write(`LUZZLE_SMOKE_FAIL ${String(err)}\n`)
          app.exit(1)
        }
      }, 900)
    }
  })

  if (devUrl) void win.loadURL(devUrl)
  else void win.loadURL('app://luzzle/index.html')
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_ev, argv) => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore()
      mainWin.focus()
    }
    const docs = extractDocArgs(argv.slice(1))
    if (docs.length) void dispatchFiles(docs)
  })

  app.on('open-file', (ev, filePath) => {
    ev.preventDefault()
    void dispatchFiles([filePath])
  })

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))

    protocol.handle('app', async (req) => {
      try {
        const u = new URL(req.url)
        if (u.hostname !== 'luzzle') return new Response('Not Found', { status: 404 })
        const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html'
        const target = path.resolve(distDir, rel)
        if (target !== distDir && !target.startsWith(distDir + path.sep)) {
          return new Response('Forbidden', { status: 403 })
        }
        const buf = await fsp.readFile(target)
        return new Response(buf, {
          status: 200,
          headers: {
            'content-type': mimeOf(target),
            'cache-control': 'no-cache',
          },
        })
      } catch {
        return new Response('Not Found', { status: 404 })
      }
    })

    registerIPC()
    buildMenu()
    createWindow()
    const cliDocs = extractDocArgs(process.argv.slice(app.isPackaged ? 1 : 2))
    if (cliDocs.length) void dispatchFiles(cliDocs)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
