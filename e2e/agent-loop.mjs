// Keep the network abort even with a fake fetch: a mock miss must never reach paid NovelAI endpoints.
import { chromium } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const GAP = 4000
const MCP = new URL('/mcp', E2E_URL)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await isolate(ctx)
await ctx.route(/novelai\.net/, (route) => route.abort())
await ctx.addInitScript(() => {
  const real = window.fetch.bind(window)
  let fake = null
  window.__naiRequests = []
  window.__inflight = 0
  window.__maxInflight = 0
  window.fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!u.includes('novelai.net')) return real(input, init)
    if (!fake) {
      const mine = window.fetch
      fake = import('/scripts/try-nai-fake.js').then(() => {
        const theirs = window.fetch
        window.fetch = mine
        return theirs
      })
    }
    const f = await fake
    if (!/generate-image|upscale|augment-image/.test(u)) return f(input, init)
    window.__inflight++
    window.__maxInflight = Math.max(window.__maxInflight, window.__inflight)
    const done = () => window.__inflight--
    const res = await f(input, init)
    if (!res.body) return done(), res
    const body = res.body.pipeThrough(new TransformStream({ flush: done }))
    return new Response(body, { status: res.status, headers: res.headers })
  }
})
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && !/novelai\.net|Failed to load resource|503|Service Unavailable|404/.test(m.text()) && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const fails = []
const check = (ok, msg) => (ok ? console.log('ok  ', msg) : (fails.push(msg), console.log('FAIL', msg)))
const tid = (id) => page.getByTestId(id)
const sent = () => page.evaluate(() => window.__naiRequests.filter((r) => !/subscription|encode-vibe/.test(r.url)).length)
const idle = () => page.waitForFunction(() => !document.querySelector('[data-testid=gen-button][data-running]'), null, { timeout: 30000 })
const mod = (p) => `(await window.__peImport('${p}'))`
const run = (body) => page.evaluate(`(async () => { ${body} })()`)
const setAgent = (patch) => run(`${mod('/src/store/ai.ts')}.useAi.getState().setAgent(${JSON.stringify(patch)})`)
const docOf = (tab) => run(`return ${mod('/src/store/tabs.ts')}.getDocStore(${JSON.stringify(tab)}).getState().doc`)
const findSec = (doc, id) => [...doc.base.prompt, ...doc.base.uc, ...doc.characters.flatMap((c) => [...c.prompt, ...c.uc])].find((s) => s.id === id)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await page.goto(E2E_URL)
await resetStore(page, { prefs: { historyOpen: true }, nai: { state: { token: 'pst-test' }, version: 1 } })
await page.reload()
await page.waitForSelector('[data-testid=export-panel]', { timeout: 60000 })
await page.waitForSelector('[data-testid=account-status][data-state=ok]')
await setAgent({ on: true, gen: 'direct', mode: 'direct' })
await run(`${mod('/src/store/agent.ts')}.AGENT_GEN.gapMs = ${GAP}`)
await page.waitForFunction(async () => (await fetch('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status !== 503, null, { timeout: 10000 })

const connect = async (name = 'e2e-agent') => {
  const c = new Client({ name, version: '1.0.0' })
  await c.connect(new StreamableHTTPClientTransport(MCP))
  return c
}
const call = async (c, name, args = {}) => {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 120000 })
  return { error: !!r.isError, text: r.content.filter((x) => x.type === 'text').map((x) => x.text).join(''), images: r.content.filter((x) => x.type === 'image') }
}
const c = await connect()
const c2 = await connect('e2e-agent-2')

const tools = (await c.listTools()).tools.map((t) => t.name)
check(tools.length === 14 && tools.includes('new_document') && tools.includes('reroll_random'), `14 个工具，含 new_document、reroll_random（${tools.join(' ')}）`)

const tabsBefore = JSON.parse((await call(c, 'get_editor_state')).text).tabs
const nd = await call(c, 'new_document', { title: '雨夜的芙莉莲' })
const { tab } = JSON.parse(nd.text)
const tabsAfter = JSON.parse((await call(c, 'get_editor_state')).text).tabs
const mine = tabsAfter.find((t) => t.tab === tab)
check(!nd.error && tabsAfter.length === tabsBefore.length + 1 && mine?.active && mine.title === '雨夜的芙莉莲', `new_document：多一个 tab、是当前 tab、标题「${mine?.title}」`)
let doc = await docOf(tab)
check(doc.base.prompt.length === 1 && doc.base.prompt[0].name === '新区块' && doc.base.prompt[0].chips.length === 0 && doc.characters.length === 0 && !!doc.meta.docId, '内容 = 新建 → 空白（一个空的「新区块」）')

const main = doc.base.prompt[0].id
const ed = await call(c, 'edit_document', { tab, reply: { $schema: 'pe-doc-ai/2', prompt: [{ id: main, name: '主体', tags: ['1girl', 'frieren', 'rain', 'night', 'wet hair'] }] }, request: '雨夜的芙莉莲' })
check(!ed.error && JSON.parse(ed.text).applied >= 1, `edit_document 写进新 tab（${ed.text.slice(0, 60).replace(/\s+/g, ' ')}）`)
async function insertFromPanel(name) {
  const ids = (d) => d.base.prompt.map((s) => s.id)
  const before = new Set(ids(await docOf(tab)))
  await page.keyboard.press('Escape')
  const rows = page.getByTestId('random-row')
  if (!(await rows.count())) await page.locator('[data-testid=lib-folder][data-folder=random]').click()
  const item = page.getByTestId('random-item').filter({ has: page.getByTestId('random-name').getByText(name, { exact: true }) })
  await item.getByTestId('random-row').click()
  await item.getByTestId('random-insert').click()
  for (let i = 0; i < 100; i++) {
    const added = ids(await docOf(tab)).filter((id) => !before.has(id))
    if (added.length) return added[0]
    await sleep(100)
  }
  return null
}
const rnd = await insertFromPanel('画师随机')
check(!!rnd, `左栏「画师随机」点「插入」：新 tab 里多了一块（${rnd}）`)
const read = (await call(c, 'read_document', { tab })).text
const listed = read.slice(read.indexOf('## Random sections'))
check(read.includes('## Random sections') && listed.includes(`- ${rnd} "画师" in prompt: draws 3 artists; nothing locked`), `read_document 在文档后面列出随机区块（${listed.split('\n')[2] ?? ''}）`)
check(!read.slice(read.indexOf('## Current document'), read.indexOf('## Random sections')).includes('"random"'), '文档 JSON 本身不变（没有 random 字段）')

doc = await docOf(tab)
const artists0 = findSec(doc, rnd).chips.map((x) => x.text)
const r1 = await call(c, 'reroll_random', { tab, section: rnd })
const j1 = JSON.parse(r1.text)
doc = await docOf(tab)
const artists1 = findSec(doc, rnd).chips.map((x) => x.text)
check(!r1.error && j1.tags.length === 3 && j1.tags.every((t, i) => t.includes(`artist:${artists1[i]}`)) && j1.drawn.length > 0 && artists1.join() !== artists0.join(), `重抽：换了画师（${artists0.join(', ')} → ${artists1.join(', ')}）`)
await run(`${mod('/src/store/tabs.ts')}.getDocStore(${JSON.stringify(tab)}).temporal.getState().undo()`)
doc = await docOf(tab)
check(findSec(doc, rnd).chips.map((x) => x.text).join() === artists0.join(), '撤销一步 = 回到重抽前')
await run(`${mod('/src/store/tabs.ts')}.getDocStore(${JSON.stringify(tab)}).temporal.getState().redo()`)
await run(`${mod('/src/components/editor/random-ops.ts')}.lockRandom(${mod('/src/store/tabs.ts')}.getDocStore(${JSON.stringify(tab)}), ${JSON.stringify(rnd)}, [${JSON.stringify(artists1[0])}])`)
check((await call(c, 'read_document', { tab })).text.includes(`locked: artist:${artists1[0]}`), `锁了一位：read_document 写「locked: artist:${artists1[0]}」`)
const r2 = JSON.parse((await call(c, 'reroll_random', { tab, section: rnd })).text)
doc = await docOf(tab)
const artists2 = findSec(doc, rnd).chips.map((x) => x.text)
check(artists2.includes(artists1[0]) && r2.locked?.join() === `artist:${artists1[0]}` && !r2.drawn.includes(`artist:${artists1[0]}`), `锁住的留着（${artists2.join(', ')}）`)
const notRandom = await call(c, 'reroll_random', { tab, section: main })
check(notRandom.error && /not a random section/.test(notRandom.text), `不是随机区块：${notRandom.text.slice(0, 50)}`)
check(/No section/.test((await call(c, 'reroll_random', { tab, section: 's_nope' })).text), '没有这个区块：原因')
check(/`section` is required/.test((await call(c, 'reroll_random', { tab })).text), '没给 section：原因')
const empty = await insertFromPanel('随机区块')
const noRange = await call(c, 'reroll_random', { tab, section: empty })
check(noRange.error && /has no range yet/.test(noRange.text), `没选范围的随机区块：${noRange.text.slice(0, 50)}`)
check((await call(c, 'read_document', { tab })).text.includes(`- ${empty} "随机区块" in prompt: draws 1 tag; no range chosen yet`), 'read_document：没选范围的写明')
await run(`const s = ${mod('/src/store/tabs.ts')}.getDocStore(${JSON.stringify(tab)}); s.getState().removeSection(${JSON.stringify(empty)})`)
await run(`${mod('/src/components/editor/random-ops.ts')}.lockRandom(${mod('/src/store/tabs.ts')}.getDocStore(${JSON.stringify(tab)}), ${JSON.stringify(rnd)})`)
const allLocked = JSON.parse((await call(c, 'reroll_random', { tab, section: rnd })).text)
doc = await docOf(tab)
check(/whole section is locked/.test(allLocked.note) && findSec(doc, rnd).chips.map((x) => x.text).join() === artists2.join(), '整块锁住：没变，回「whole section is locked」')
await run(`${mod('/src/components/editor/random-ops.ts')}.lockRandom(${mod('/src/store/tabs.ts')}.getDocStore(${JSON.stringify(tab)}), ${JSON.stringify(rnd)})`)

const n0 = await sent()
const g1 = await call(c, 'generate', { tab })
const j = JSON.parse(g1.text)
const p1 = j.images?.[0]?.path
check(!g1.error && j.waited_seconds === 0 && j.images.length === 1 && g1.images.length === 1, `第一张：没等（waited_seconds ${j.waited_seconds}）`)
check(typeof p1 === 'string' && path.isAbsolute(p1) && existsSync(p1) && statSync(p1).size > 1000 && p1.endsWith('.webp'), `结果带原图的绝对路径，文件在（${p1}）`)
await call(c, 'reroll_random', { tab, section: rnd })
const t0 = Date.now()
const pg2 = call(c, 'generate', { tab })
await sleep(600)
const during = await call(c2, 'generate', { tab })
check(during.error && /waiting out the gap/.test(during.text), `等着的时候另一个代理调：立刻拒绝（${during.text.slice(0, 60)}）`)
check((await sent()) === n0 + 1, '等的时候没发请求')
const g2 = await pg2
const j2 = JSON.parse(g2.text)
const took = Date.now() - t0
const p2 = j2.images?.[0]?.path
check(!g2.error && j2.waited_seconds >= (GAP - 800) / 1000 && j2.waited_seconds <= GAP / 1000 + 0.2 && took >= GAP - 800, `第二张：等了 ${j2.waited_seconds} 秒（间隔 ${GAP / 1000} 秒，从上一张结束算；整个调用 ${took}ms）`)
check(typeof p2 === 'string' && p2 !== p1 && existsSync(p2), `第二张的路径也在（${p2 && path.basename(p2)}）`)
check((await sent()) === n0 + 2, '两张 = 两个请求')

await idle()
const t1 = Date.now()
const pg3 = call(c, 'generate', { tab })
await sleep(800)
await tid('gen-button').click()
const g3 = await pg3
check(g3.error && /started while Tincture was waiting/.test(g3.text) && Date.now() - t1 < GAP, `等的时候用户点了生成：代理马上回 busy（${Date.now() - t1}ms，${g3.text.slice(0, 50)}）`)
await idle()

await setAgent({ gen: 'confirm' })
const t2 = Date.now()
const pg4 = call(c, 'generate', { tab })
await sleep(1500)
check((await tid('gen-confirm').count()) === 0, '每次确认：间隔没到时还没弹气泡')
await tid('gen-confirm').waitFor({ timeout: GAP + 5000 })
const shownAfter = Date.now() - t2
await tid('gen-confirm-run').click()
const g4 = JSON.parse((await pg4).text)
check(shownAfter >= GAP - 1000 && g4.waited_seconds >= (GAP - 1000) / 1000 && g4.images?.length === 1, `气泡在等完以后才弹（${shownAfter}ms），waited_seconds ${g4.waited_seconds}`)
await idle()

const start = await run(`return ${mod('/src/store/tabs.ts')}.useTabs.getState().newTab()`)
const nd2 = JSON.parse((await call(c, 'new_document')).text)
const st = await run(`const s = ${mod('/src/store/tabs.ts')}.useTabs.getState(); return { starts: s.starts, active: s.activeId, n: s.order.length }`)
check(nd2.tab === start && !st.starts.includes(start) && st.active === start && nd2.title === '未命名', `开着新标签页时：用那一页（${nd2.tab}），标题「${nd2.title}」`)

check((await page.evaluate(() => window.__maxInflight)) === 1, `全程同一时间最多 1 个出图请求（${await page.evaluate(() => window.__maxInflight)}）`)
await c.close()
await c2.close()

console.log(fails.length ? `\n${fails.length} FAIL` : '\nall ok', 'errors', errors.length ? errors : 'none')
await browser.close()
process.exit(fails.length ? 1 : 0)
