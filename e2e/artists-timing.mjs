import { chromium } from '@playwright/test'
import { routeDanbooru } from './danbooru-mock.mjs'
import { E2E_URL, isolate } from './store.mjs'

const runs = Number(process.argv[2] ?? 7)
const base = E2E_URL
const browser = await chromium.launch()
const res = { chip: [], card: [], images: [] }
for (let i = 0; i < runs; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await isolate(ctx)
  const page = await ctx.newPage()
  await routeDanbooru(page)
  const t0 = Date.now()
  await page.goto(base)
  await page.locator('.chip').first().waitFor()
  res.chip.push(Date.now() - t0)
  await page.waitForTimeout(800)
  const t1 = Date.now()
  await page.getByTestId('page-artists').click()
  await page.getByTestId('artist-card').first().waitFor()
  res.card.push(Date.now() - t1)
  await page.waitForFunction(() => {
    const vh = innerHeight
    const cards = [...document.querySelectorAll('[data-testid="artist-card"]')].filter((c) => {
      const r = c.getBoundingClientRect()
      return r.bottom > 0 && r.top < vh
    })
    return cards.length > 0 && cards.every((c) => {
      const imgs = [...c.querySelectorAll('img.fade-img')]
      return imgs.length ? imgs.every((im) => im.dataset.state !== 'loading') : !!c.querySelector('[data-placeholder]') || c.querySelector('.artist-media')?.dataset.count === '1'
    })
  }, null, { timeout: 30000 })
  res.images.push(Date.now() - t1)
  await ctx.close()
}
await browser.close()
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1]
for (const [k, label] of [['chip', '首屏（第一个 chip）'], ['card', '打开画师库 → 第一张卡片'], ['images', '打开画师库 → 第一屏都出图']])
  console.log(`${label}：中位数 ${med(res[k])}ms（${res[k].join(' / ')}）`)
