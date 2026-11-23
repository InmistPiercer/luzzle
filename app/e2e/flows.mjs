import { chromium } from 'playwright'
import { mkdirSync, rmSync } from 'node:fs'

const URL = process.env.E2E_URL || 'http://localhost:5173/'
const OUT = new globalThis.URL('./shots/', import.meta.url).pathname
const STYLES = process.env.E2E_STYLES ? process.env.E2E_STYLES.split(',') : ['积木岛屿', '琥珀终端', '霓虹暗房', '制图台']
const errors = []
let shots = 0

rmSync(OUT, { recursive: true, force: true })

async function snap(p, dir, name) {
  mkdirSync(`${OUT}${dir}`, { recursive: true })
  await p.screenshot({ path: `${OUT}${dir}/${String(++shots).padStart(2, '0')}-${name}.png` })
}

async function settings(p, fn) {
  await p.click('#set-btn')
  await p.waitForTimeout(250)
  await fn()
  await p.click('#set-modal .x-btn')
  await p.waitForTimeout(250)
}

const go = (p, v) => p.click(`.nav-group button[data-v="${v}"]`).then(() => p.waitForTimeout(700))
const current = (p) => p.locator('.fq-item.on .fq-txt b').first().textContent({ timeout: 800 }).catch(() => null)

const known = new Map()
const tries = new Map()
const F = '.forge-main '
const cardKey = (p) => p.locator(F + '.card').first().textContent({ timeout: 500 }).catch(() => '')
const count = (p) => p.locator('.fq-head b').first().textContent({ timeout: 800 }).then((t) => t.replace(/\s+/g, ' ').trim()).catch(() => '')

async function next(p) {
  await p.waitForTimeout(400)
  const nx = p.locator('button:has-text("下一个")')
  if (await nx.count()) await nx.first().click()
  await p.waitForTimeout(1400)
}

async function answer(p) {
  const item = (await cardKey(p)) + '|' + (await p.locator(F + '.opt, ' + F + '.mo, ' + F + '.ph-blk, ' + F + '.forge-input').allTextContents()).join('/') + '|' + (await p.locator(F + '.forge-input').getAttribute('placeholder', { timeout: 300 }).catch(() => ''))
  const ans = known.get(item)
  if (await p.locator(F + 'button:has-text("显示意思")').count()) {
    await p.locator(F + 'button:has-text("显示意思")').first().click()
    await p.waitForTimeout(150)
    await p.locator(F + 'button:has-text("认识")').first().click()
    return next(p).then(() => true)
  }
  let picked = false
  for (const sel of [F + '.opt', F + '.mo:not([disabled])']) {
    const opts = p.locator(sel)
    if (!(await opts.count())) continue
    const texts = (await opts.allTextContents()).map((t) => t.trim())
    const tried = (tries.get(item) || tries.set(item, new Set()).get(item))
    const j = ans && texts.includes(ans) ? texts.indexOf(ans) : Math.max(0, texts.findIndex((t) => !tried.has(t)))
    tried.add(texts[j])
    await opts.nth(j).click()
    picked = true
    break
  }
  const peek = async () => (await p.locator(F + 'button:has-text("看答案")').count()) && p.locator(F + 'button:has-text("看答案")').first().click()
  if (picked) void 0
  else if (await p.locator(F + '.ph-blk:not([disabled])').count()) {
    if (ans) for (const t of ans.split(' ')) await p.locator(F + '.ph-blk:not([disabled])', { hasText: t }).first().click()
    else await peek()
  } else if (await p.locator(F + '.forge-input:not([disabled])').count()) {
    const inp = p.locator(F + '.forge-input:not([disabled])').first()
    if (ans) {
      await inp.fill(ans)
      await inp.press('Enter')
    } else await peek()
  }
  await p.waitForTimeout(300)
  const shown = await p.locator(F + '.fb-hint b').first().textContent({ timeout: 500 }).catch(() => null)
  if (process.env.E2E_LOG) console.log('  ans', JSON.stringify(ans), 'shown', JSON.stringify(shown), item.slice(-90))
  if (shown && item) known.set(item, shown.trim())
  await next(p)
  return true
}

async function forgeRun(p, dir, tag) {
  await go(p, 'forge')
  await snap(p, dir, `${tag}-start`)
  let last = await count(p)
  let still = 0
  for (let i = 0; i < 30; i++) {
    if (await p.locator('.done-card').count()) break
    const item = await current(p)
    await answer(p)
    const c = await count(p)
    if (process.env.E2E_LOG) console.log(dir, tag, i, item, c)
    if (c === last) {
      if (++still >= 8) {
        errors.push(`${dir} ${tag}: 进度停在 ${c}（当前 ${item}）`)
        break
      }
    } else still = 0
    last = c
  }
  if (!(await p.locator('.done-card').count())) errors.push(`${dir} ${tag}: 30 步内没有完成当日锻造（${last}）`)
  await snap(p, dir, `${tag}-end`)
}

const browser = await chromium.launch()
for (const st of STYLES) {
  known.clear()
  tries.clear()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errors.push(`${st} pageerror: ${e.message}`))
  p.on('console', (m) => m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_FAILED|net::/.test(m.text()) && errors.push(`${st} console: ${m.text().slice(0, 200)}`))
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort())
  await p.goto(URL)
  await p.waitForTimeout(2500)
  await settings(p, () => p.click(`.style-card:has-text("${st}")`))
  await go(p, 'read')
  await snap(p, st, 'read')
  await go(p, 'board')
  await snap(p, st, 'board-front')
  const flip = p.locator('button:has-text("翻面")')
  if (await flip.count()) {
    await flip.first().click()
    await p.waitForTimeout(1200)
    await snap(p, st, 'board-back')
  }
  await go(p, 'build')
  await snap(p, st, 'build')
  await forgeRun(p, st, 'day1')
  await settings(p, () => p.click('button:has-text("模拟次日")'))
  await forgeRun(p, st, 'day2')
  await settings(p, () => p.click('button:has-text("回到今天")'))
  await ctx.close()
}
await browser.close()

console.log(`截图 ${shots} 张：${OUT}`)
if (errors.length) {
  console.log(`失败 ${errors.length}：\n` + errors.join('\n'))
  process.exit(1)
}
console.log(`通过 ${STYLES.length} 种风格 × 阅读/拼板/构词/锻造/模拟次日，失败 0`)
