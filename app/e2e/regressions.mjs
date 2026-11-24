import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { chromium } from 'playwright'

const dist = resolve(process.env.E2E_DIST || 'dist')
const trial = resolve(process.env.E2E_TRIAL_DIST || 'dist-test')
const shots = new URL('./shots/regressions/', import.meta.url)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2' }
let aiCalls = 0
let onSent
let onCancelled
const aiSent = new Promise((done) => { onSent = done })
const aiCancelled = new Promise((done) => { onCancelled = done })
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  if (path === '/fake-ai/v1/chat/completions' && req.method === 'POST') {
    aiCalls++
    onSent()
    req.resume()
    const timer = setTimeout(() => res.writeHead(500).end(), 10000)
    res.on('close', () => {
      clearTimeout(timer)
      if (!res.writableFinished) onCancelled(true)
    })
    return
  }
  const root = path.startsWith('/trial/') ? trial : dist
  const relative = path.replace(/^\/(trial|web)\//, '') || 'index.html'
  const file = resolve(root, relative)
  if (!file.startsWith(root + sep)) return res.writeHead(404).end()
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(body)
  } catch {
    res.writeHead(404).end()
  }
})

function shortPdf() {
  const stream = 'BT /F1 12 Tf 40 650 Td (Brief glossary note.) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((body, index) => {
    const offset = pdf.length
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
    return offset
  })
  const xref = pdf.length
  pdf += 'xref\n0 6\n0000000000 65535 f \n'
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  return Buffer.from(pdf + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)
}

await mkdir(shots, { recursive: true })
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const base = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 900, height: 620 } })
  page.setDefaultTimeout(7000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  const shot = (name) => page.screenshot({ path: new URL(name + '.png', shots).pathname, animations: 'disabled' })
  const settings = () => page.locator('#set-btn').click()
  const close = () => page.locator('#set-modal .x-btn').click()

  await page.goto(base + '/web/')
  await page.locator('#col .empty-state').waitFor()
  await page.locator('#v-read input[type=file]').setInputFiles([
    { name: 'Regression text.txt', mimeType: 'text/plain', buffer: Buffer.from('A sample for local reading.\n\nEvery word has a context.') },
    { name: 'Regression short.pdf', mimeType: 'application/pdf', buffer: shortPdf() },
  ])
  await page.locator('#col').getByText('glossary', { exact: true }).waitFor()
  await shot('01-short-pdf')
  await page.locator('#doc-btn').click()
  await page.getByRole('option', { name: /^Regression text/ }).click()

  await page.locator('#rd').focus()
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'rd')
  await page.keyboard.press('Alt+ArrowDown')
  await page.keyboard.press('Space')
  await page.locator('#po.open').waitFor()
  await shot('02-keyboard-reading')
  await page.keyboard.press('Enter')
  await page.locator('#ctx.open').waitFor()
  await page.keyboard.press('Escape')
  await settings()
  const modal = page.getByRole('dialog', { name: '设置' })
  await modal.locator('.x-btn').waitFor()
  await page.keyboard.press('Shift+Tab')
  assert.ok(await modal.evaluate((node) => node.contains(document.activeElement)))
  await shot('03-settings-keyboard')
  await page.keyboard.press('Escape')
  await modal.waitFor({ state: 'hidden' })

  await settings()
  await page.locator('input[placeholder^="Base URL:"]').fill(base + '/fake-ai/v1')
  await page.locator('input[type=password]').fill('audit-fixture')
  await modal.getByRole('button', { name: '保存配置' }).click()
  await close()
  await page.locator('#trmode').getByRole('button', { name: '双语' }).click()
  const sent = page.waitForRequest((request) => request.url().includes('/fake-ai/'))
  await page.locator('#ai-confirm').getByRole('button', { name: '开始' }).click()
  await Promise.all([sent, aiSent])
  const failed = page.waitForEvent('requestfailed', { predicate: (request) => request.url().includes('/fake-ai/') })
  await page.getByRole('button', { name: '停止翻译' }).click()
  await failed
  await page.waitForFunction(() => !document.querySelector('#trmode [aria-label="停止翻译"]'))
  assert.ok(aiCalls >= 1)
  await shot('04-stopped-translation')

  await page.goto(base + '/trial/')
  await page.locator('.app').waitFor()
  assert.equal(await page.title(), 'Luzzle · 测试版')
  await page.locator('#doc-btn').click()
  assert.equal(await page.getByRole('option', { name: /^Regression / }).count(), 0)
  await page.keyboard.press('Escape')
  await shot('05-isolated-trial')
  await page.locator('.nav-group [data-v=forge]').click()
  const reveal = page.locator('.forge-main').getByRole('button', { name: '显示意思' })
  await reveal.waitFor()
  await page.keyboard.press('Space')
  const recall = page.locator('.forge-main').getByRole('button', { name: '认识', exact: true })
  await recall.waitFor()
  await shot('06-revealed-before-date-change')
  await settings()
  await modal.getByRole('button', { name: '模拟次日' }).click()
  await close()
  await recall.waitFor({ state: 'hidden' })
  await shot('07-reset-after-date-change')
  await page.setViewportSize({ width: 390, height: 844 })
  await settings()
  await shot('08-settings-narrow')
  await page.keyboard.press('Escape')
  await modal.waitFor({ state: 'hidden' })
  assert.ok(await Promise.race([aiCancelled, new Promise((done) => setTimeout(() => done(false), 1000))]),
    'Stopping translation must disconnect the in-flight request')
  assert.deepEqual(errors, [])
  console.log('通过：短 PDF 与多文件导入、正文和设置键盘、取消在途翻译、同源版别隔离、锻造中途切换日期。截图 8 张。')
} finally {
  await browser?.close()
  await new Promise((done) => server.close(done))
}
