import { spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const modeArgs = process.argv.includes('--test') ? ['--mode', 'test'] : []
const port = modeArgs.length ? '5179' : '5178'
const url = `http://127.0.0.1:${port}`
const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx'

const vite = spawn(npxBin, ['vite', '--host', '127.0.0.1', '--port', port, '--strictPort', ...modeArgs], {
  cwd: root,
  stdio: 'inherit',
})

const waitReady = () =>
  new Promise((resolve, reject) => {
    let tries = 0
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        if (++tries > 80) reject(new Error('Vite server start timed out'))
        else setTimeout(tick, 150)
      })
    }
    tick()
  })

waitReady()
  .then(() => {
    const env = { ...process.env, ELECTRON_RENDERER_URL: url, ...(modeArgs.length ? { LUZZLE_EDITION: 'test' } : {}) }
    delete env.ELECTRON_RUN_AS_NODE
    const elec = spawn(npxBin, ['electron', '.'], { cwd: root, stdio: 'inherit', env })
    elec.on('exit', (code) => {
      vite.kill()
      process.exit(code ?? 0)
    })
  })
  .catch((err) => {
    console.error(err.message)
    vite.kill()
    process.exit(1)
  })
