import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const stage = process.argv[3] ?? 'after'
const width = Number(process.argv[4] ?? 1440)
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 })
await isolate(context)
await context.addInitScript(() => {
  const post = Worker.prototype.postMessage
  window.__freshAsks = 0
  Worker.prototype.postMessage = function (m, ...rest) {
    if (m?.type === 'recommend' && m.opts?.fresh) window.__freshAsks++
    return post.call(this, m, ...rest)
  }
})
const page = await context.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(E2E_URL)
await resetStore(page, { theme })
await page.reload()
await page.getByTestId('chip').first().waitFor()
await page.waitForLoadState('networkidle')

const fails = []
const check = (ok, msg) => (ok ? console.log('ok  ', msg) : (fails.push(msg), console.log('FAIL', msg)))
const suffix = `${theme}${width === 1440 ? '' : `-${width}`}`
const clip = async (loc, name, pad = 8, away = true) => {
  if (away) await page.mouse.move(2, 890)
  await page.waitForTimeout(400)
  const b = await loc.boundingBox()
  const file = `${out}/recs-fresh-${stage}-${name}-${suffix}.png`
  await page.screenshot({ path: file, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 } })
  console.log('clip', file)
}
const section = (name) => page.getByTestId('section').filter({ has: page.getByTestId('section-name').getByText(name, { exact: true }) }).first()
const chip = (text) => page.getByTestId('chip').filter({ has: page.locator('.chip-text').getByText(text, { exact: true }) }).first()
const recs = page.getByTestId('section-recs')
const names = () => recs.locator('[data-testid=rec-chip] .chip-text').allTextContents()
const srcs = () => recs.getByTestId('rec-chip').evaluateAll((els) => els.map((el) => el.dataset.src))
const freshAsks = () => page.evaluate(() => window.__freshAsks)
const sectionTexts = (name) => section(name).locator('[data-testid=chip] .chip-text').allTextContents()
const clickBlank = async (name) => {
  const b = await section(name).boundingBox()
  await page.mouse.click(b.x + b.width - 60, b.y + b.height - 16)
}
const clickHead = async (name) => {
  await section(name).scrollIntoViewIfNeeded()
  const b = await section(name).boundingBox()
  await page.mouse.click(b.x + b.width * 0.6, b.y + 14)
}
const next = recs.getByTestId('section-recs-next')
const round = async () => Number(await recs.getAttribute('data-round'))
const tipText = async (loc) => {
  await page.mouse.move(2, 890)
  await page.waitForTimeout(300)
  await loc.hover()
  await page.waitForTimeout(700)
  return (await page.locator('[data-slot=tooltip-content], [role=tooltip]').first().textContent().catch(() => '')) ?? ''
}
const swap = async () => {
  const r = await round()
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid=section-recs] .recs-list')
    const seen = (window.__swap = { leaving: false, heights: new Set(), fadeOut: '', frames: [] })
    const t0 = performance.now()
    const sample = () => {
      seen.frames.push(el.offsetHeight)
      if (performance.now() - t0 < 600) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
    new MutationObserver((_, o) => {
      if (el.hasAttribute('data-leaving') && !seen.leaving) {
        seen.leaving = true
        const c = el.querySelector('.rec-chip')
        seen.fadeOut = c ? getComputedStyle(c).transition : ''
      }
      if (el.style.height) seen.heights.add(el.style.height)
      if (!el.hasAttribute('data-swapping') && seen.leaving) o.disconnect()
    }).observe(el, { attributes: true })
  })
  await next.click()
  await page.waitForFunction(
    (r) => {
      const el = document.querySelector('[data-testid=section-recs]')
      return Number(el?.dataset.round) === r + 1 && !el.querySelector('.recs-list[data-swapping]')
    },
    r,
    { timeout: 3000 },
  )
  await page.waitForTimeout(450)
  return page.evaluate(() => ({ leaving: window.__swap.leaving, heights: window.__swap.heights.size, fadeOut: window.__swap.fadeOut, frames: window.__swap.frames }))
}
const ordered = (kinds) => kinds.indexOf('fresh') < 0 || kinds.slice(kinds.indexOf('fresh')).every((k) => k === 'fresh')
await page.evaluate(() => {
  const t0 = performance.now()
  new MutationObserver((_, o) => {
    if (!document.querySelector('[data-testid=section-recs] [data-testid=rec-chip]')) return
    window.__openMs = performance.now() - t0
    o.disconnect()
  }).observe(document.body, { childList: true, subtree: true })
})
await clickBlank('场景')
await recs.getByTestId('rec-chip').first().waitFor()
console.log(`     点下到推荐区出来 ${Math.round(await page.evaluate(() => window.__openMs))}ms（含点击）`)
await page.waitForTimeout(500)
const first = await names()
console.log('第一组：', first.join(', '))
await clip(section('场景'), 'section')

if (stage === 'after') {
  check((await recs.getByTestId('recs-mode').count()) === 0, '标题行没有「常见搭配 | 换点新的」分段')
  check(/^补充推荐 · 基于本区块 \d+ 个 tag$/.test((await recs.getByTestId('section-recs-title').textContent()) ?? ''), '标题照旧「补充推荐 · 基于本区块 N 个 tag」')
  check((await recs.getByTestId('section-recs-more').count()) === 0, '没有「显示更多」')
  check((await freshAsks()) === 2, `「换点新的」：这一组 + 下一组各一次（${await freshAsks()}）`)

  const all = first
  const kinds = await srcs()
  const common = all.filter((_, i) => kinds[i] === 'common')
  const fresh = all.filter((_, i) => kinds[i] === 'fresh')
  console.log(`展开：常见 ${common.length} + 新的 ${fresh.length}`)
  console.log('  常见：', common.join(', '))
  console.log('  新的：', fresh.join(', '))
  check(common.length === 15 && fresh.length >= 10 && fresh.length <= 15, `常见 15 + 新的 10–15（${common.length} + ${fresh.length}）`)
  check(kinds.indexOf('fresh') === common.length && kinds.lastIndexOf('common') === common.length - 1, '先常见、后新的，不交错')
  check(new Set(all).size === all.length, '不重复')
  const have = await sectionTexts('场景')
  check(!all.some((n) => have.includes(n)), '不出区块里已有的')
  check((await recs.locator('[data-testid=rec-chip][data-more]').count()) === 0, '第一组跟着推荐区一起展开，不一个个淡入')
  await page.mouse.move(2, 890)
  await page.waitForTimeout(300)
  const looks = await recs.getByTestId('rec-chip').evaluateAll((els) => [...new Set(els.map((el) => `${el.className}|${getComputedStyle(el).borderStyle}`))])
  check(looks.length === 1, `常见和新的同一种候选 chip（${looks.join(' / ')}）`)

  const freshChip = recs.locator('[data-testid=rec-chip][data-src=fresh]').first()
  await freshChip.hover()
  await page.waitForTimeout(700)
  const tip = await page.locator('[data-slot=tooltip-content], [role=tooltip]').first().textContent().catch(() => '')
  check(/推荐依据：/.test(tip ?? ''), `悬停新的「推荐依据：xx」（${tip}）`)
  const pick = fresh[0]
  await freshChip.click()
  await page.waitForTimeout(600)
  check((await chip(pick).count()) === 1, `点新的加进区块（${pick}）`)
  check(!(await names()).includes(pick), '加进去的不再出现在推荐里')
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(300)
  check((await chip(pick).count()) === 0, 'Ctrl+Z 撤回添加的候选')

  await page.waitForTimeout(300)
  check(await next.isVisible(), '有「换一组」')
  const head = recs.locator('.section-recs-head')
  check(await head.locator(':scope > :last-child').evaluate((el) => el.dataset.testid === 'section-recs-next'), '「换一组」在标题行最右边')
  const hb = await head.boundingBox()
  const nb = await next.boundingBox()
  const tb = await recs.boundingBox()
  const firstChip = await recs.getByTestId('rec-chip').first().boundingBox()
  check(hb.height <= 17, `标题行没被按钮撑高（${hb.height}px）`)
  check(((await next.textContent()) ?? '').trim() === '换一组', `按钮「换一组 ⟳」（${await next.textContent()}）`)
  check(!((await head.textContent()) ?? '').includes('点击添加'), '标题行没有「点击添加」')
  check(Math.abs(nb.y + nb.height / 2 - (hb.y + hb.height / 2)) <= 1, '按钮和标题行竖直居中')
  const right = tb.x + tb.width - (nb.x + nb.width - 4)
  const left = firstChip.x - tb.x
  console.log(`     ⟳ 右边距 ${right.toFixed(1)}px · 候选左边距 ${left.toFixed(1)}px`)
  check(Math.abs(right - left) <= 2, '⟳ 的右边距和候选的左边距一样')
  check((await round()) === 0, '一打开是第一组')
  check((await next.getAttribute('aria-disabled')) === null, '有下一组时可点')
  check((await tipText(next)) === '', '可点时不出悬停说明（按钮上已经写了）')
  await clip(section('场景'), 'section-next-hover', 8, false)
  const docBefore = await sectionTexts('场景')
  const groups = [await names()]
  for (let k = 1; k <= 3; k++) {
    const t = await swap()
    const now = await names()
    const kinds = await srcs()
    const prev = groups.flat()
    const fresh = kinds.filter((x) => x === 'fresh').length
    console.log(`第 ${k + 1} 组：常见 ${now.length - fresh} + 新的 ${fresh}：${now.join(', ')}`)
    check(now.length > 0 && !now.some((n) => prev.includes(n)), `第 ${k + 1} 组和前几组不重复（${now.length} 个）`)
    check(new Set(now).size === now.length && ordered(kinds), `第 ${k + 1} 组不重复、先常见后新的`)
    if (k === 1) {
      check(t.leaving && /opacity/.test(t.fadeOut), `换组时旧的淡出（${t.fadeOut}）`)
      check(t.heights >= 1, `换组时外框锁高、跟着过渡（量到 ${t.heights} 个高度）`)
      check((await recs.locator('[data-testid=rec-chip]:not([data-more])').count()) === 0, '换上的一组整份淡入')
      const heightTr = await recs.locator('.recs-list').evaluate((el) => {
        el.setAttribute('data-swapping', '')
        const s = getComputedStyle(el).transition
        el.removeAttribute('data-swapping')
        return s
      })
      check(/height/.test(heightTr), `高度过渡（${heightTr}）`)
      await clip(section('场景'), 'section-group2')
    }
    groups.push(now)
  }
  check(JSON.stringify(await sectionTexts('场景')) === JSON.stringify(docBefore), '换组不改文档')
  const g = groups.at(-1)
  const add2 = g[0]
  await recs.getByTestId('rec-chip').first().click()
  await page.waitForTimeout(700)
  check((await chip(add2).count()) === 1, `点第 4 组的推荐加进区块（${add2}）`)
  const kept = await names()
  check((await round()) === 3, `加 tag 后不跳回第一组（第 ${(await round()) + 1} 组）`)
  check(!kept.includes(add2) && !kept.some((n) => groups.slice(0, -1).flat().includes(n)), '加 tag 后重算的这一组照样不出前几组的')
  check(kept.filter((n) => g.includes(n)).length >= Math.min(g.length - 1, 5), `重算后大部分还是这一组（${kept.filter((n) => g.includes(n)).length}/${g.length}）`)
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(400)
  check((await chip(add2).count()) === 0, 'Ctrl+Z 撤回添加的推荐')
  await chip('cherry blossoms').click()
  await page.waitForTimeout(500)
  check((await round()) === 0 && (await recs.getAttribute('data-mode')) === 'tag', '选中 tag：回到第一组')
  await clickHead('场景')
  await page.waitForTimeout(500)
  check((await recs.getAttribute('data-mode')) === 'section' && (await round()) === 0, '点回区块：第一组')
  check(JSON.stringify(await names()) === JSON.stringify(first), '点回区块：和最开始一样')

  await clickHead('质量')
  await recs.getByTestId('rec-chip').first().waitFor()
  await page.waitForTimeout(300)
  const qGroups = [await names()]
  for (let k = 0; k < 8 && (await next.getAttribute('aria-disabled')) === null; k++) {
    const t = await swap()
    const now = await names()
    check(!now.some((n) => qGroups.flat().includes(n)), `质量第 ${k + 2} 组不重复（${now.join(', ')}）`)
    const [a, b] = [t.frames[0], t.frames.at(-1)]
    if (a !== b) {
      const mid = t.frames.filter((h) => h < Math.max(a, b) && h > Math.min(a, b))
      check(mid.length >= 2, `质量第 ${k + 2} 组：高度 ${a} → ${b} 过渡（中间 ${mid.length} 帧）`)
    }
    qGroups.push(now)
  }
  console.log('质量每组个数：', qGroups.map((x) => x.length).join(' · '))
  check((await next.getAttribute('aria-disabled')) === 'true', '质量块换到下一组为空时置灰')
  check((await tipText(next)) === '暂无更多推荐', '置灰时悬停「暂无更多推荐」')
  const rq = await round()
  await next.click({ force: true })
  await page.waitForTimeout(400)
  check((await round()) === rq, '置灰时点了不换')
  await section('质量').evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.mouse.move(2, 890)
  await page.waitForTimeout(300)
  await next.hover()
  await page.waitForTimeout(500)
  await clip(section('质量'), 'quality-empty', 8, false)

  await clickHead('主体')
  await recs.getByTestId('rec-chip').first().waitFor()
  await page.waitForTimeout(300)
  check((await recs.getAttribute('data-for')) === (await section('主体').getAttribute('data-section-id')) && (await round()) === 0, '换区块后是第一组')

  await chip('cherry blossoms').click()
  await page.waitForTimeout(500)
  check((await recs.getAttribute('data-mode')) === 'tag', '选中 tag：与 xx 搭配')
  check(((await recs.getByTestId('section-recs-title').textContent()) ?? '').includes('cherry blossoms'), '标题「与 cherry blossoms 搭配」')
  const tagKinds = await srcs()
  const tagFresh = tagKinds.filter((k) => k === 'fresh').length
  console.log(`与 cherry blossoms 搭配：常见 ${tagKinds.length - tagFresh} + 新的 ${tagFresh}`)
  check(tagFresh >= 4 && tagKinds.indexOf('fresh') === tagKinds.length - tagFresh, `按 tag 也接新的，排在常见后面（${tagFresh} 个）`)
  await clip(section('场景'), 'tag')
  const tagFirst = await names()
  await swap()
  const tagNext = await names()
  console.log(`与 cherry blossoms 搭配第 2 组：${tagNext.join(', ')}`)
  check((await round()) === 1 && tagNext.length > 0 && !tagNext.some((n) => tagFirst.includes(n)), `按 tag 也能换一组，不重复（${tagNext.length} 个）`)
  check(((await recs.getByTestId('section-recs-title').textContent()) ?? '').includes('cherry blossoms'), '换组后标题不变')

  await page.setViewportSize({ width: 1100, height: 900 })
  await page.waitForTimeout(400)
  const fit = await recs.evaluate((tray) => {
    const t = tray.querySelector('[data-testid=section-recs-title]').getBoundingClientRect()
    const b = tray.querySelector('[data-testid=section-recs-next]').getBoundingClientRect()
    const r = tray.getBoundingClientRect()
    return t.right <= b.left && b.right <= r.right - 4
  })
  check(fit, '窄窗口标题行放得下')
}

check(errors.length === 0, `console 没有报错${errors.length ? '：' + errors.join(' | ') : ''}`)
await browser.close()
console.log(fails.length ? `\n${fails.length} 个失败` : '\n全部通过')
process.exit(fails.length ? 1 : 0)
