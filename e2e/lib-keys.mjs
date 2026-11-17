import { chromium, expect } from '@playwright/test'
import { blockAI, E2E_URL, isolate, resetStore } from './store.mjs'
import { routeDanbooru } from './danbooru-mock.mjs'

const browser = await chromium.launch()
let passed = 0
let fails = 0
async function check(label, assertion) {
  try {
    await assertion()
    console.log('ok  ', label)
    passed++
  } catch (error) {
    console.error('FAIL', label, error.message)
    fails++
  }
}

try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()))
  await isolate(page.context())
  await blockAI(page.context())
  await routeDanbooru(page)
  await page.goto(E2E_URL)
  const by = (id) => page.getByTestId(id)
  await by('status-bar').waitFor()
  await resetStore(page)
  await page.reload()
  await by('template-filter').waitFor()

  const search = by('template-filter')
  const status = by('status-hint')
  const lib = by('assist-library')
  const press = (key) => page.keyboard.press(key)
  const focusIs = (loc) => expect(loc).toBeFocused()
  const row = (name) => lib.getByTestId('template-row').filter({ has: by('template-name').getByText(name, { exact: true }) }).first()
  const hover = lib.getByTestId('template-row').first()
  await hover.hover({ position: { x: 65, y: 14 } })
  await page.waitForTimeout(800)
  await check('无行提示，状态栏说明拖动到编辑区', async () => {
    await expect(page.locator('[data-slot=tooltip-content]')).toHaveCount(0)
    await expect(status).toHaveAttribute('data-state', 'library')
    await expect(status).toContainText('拖动到编辑区')
    expect(await status.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  })
  await page.mouse.move(900, 400)
  await check('移出库恢复普通状态', () => expect(status).toHaveAttribute('data-state', 'none'))
  await press('Control+k')
  await check('Ctrl+K 聚焦库搜索框，状态栏跟随焦点', async () => {
    await focusIs(search)
    await expect(status).toHaveAttribute('data-state', 'library')
  })
  await search.fill('笑')
  await press('ArrowDown')
  await check('搜索后的第一行是全部目录', () => focusIs(by('tpl-tree-toggle')))
  await press('ArrowUp')
  await check('第一行向上回到搜索框', () => focusIs(search))
  await press('ArrowDown')
  for (const [key, path] of [['ArrowDown', '表情'], ['ArrowDown', '表情/笑'], ['ArrowUp', '表情']]) {
    await press(key)
    await check(key + ' → ' + path, () => focusIs(lib.locator('[data-testid=template-folder][data-path="' + path + '"]')))
  }
  for (let i = 0; i < 3; i++) await press('ArrowDown')
  const smirk = row('坏笑')
  await check('方向键到坏笑', () => focusIs(smirk))
  const sections = by('section')
  let count = await sections.count()
  await press('Enter')
  await check('回车展开坏笑', async () => {
    await expect(smirk).toHaveAttribute('aria-expanded', 'true')
    await expect(smirk.locator('..').getByTestId('template-details')).toBeVisible()
  })
  await press('Enter')
  await check('再按回车插入，详情保持展开', async () => {
    await expect(sections).toHaveCount(count + 1)
    await expect(smirk).toHaveAttribute('aria-expanded', 'true')
    await focusIs(smirk)
  })
  await press('Escape')
  await check('Esc 收起详情，焦点留在原行', async () => {
    await expect(smirk).toHaveAttribute('aria-expanded', 'false')
    await focusIs(smirk)
  })
  await press('Escape')
  await check('再按 Esc 回搜索，保留搜索词', async () => {
    await focusIs(search)
    await expect(search).toHaveValue('笑')
  })
  await by('library-tab-characters').click()
  await check('角色分段提示添加到角色区', () => expect(status).toContainText('拖动到角色区'))
  await press('Control+k')
  await press('ArrowDown')
  await check('搜索框进入角色分组', () => focusIs(by('chr-works-toggle')))
  await press('ArrowDown')
  await check('角色分组向下到作品行', () => focusIs(by('work-row').first()))
  await press('ArrowDown')
  await press('Enter')
  const characterRow = by('char-tpl-row').first()
  await check('回车展开角色模板', () => expect(characterRow).toHaveAttribute('aria-expanded', 'true'))
  const characters = await by('character').count()
  await press('Enter')
  await check('再按回车添加角色', () => expect(by('character')).toHaveCount(characters + 1))
  await by('library-tab-sections').click()
  await search.fill('')
  await press('ArrowDown')
  const random = by('lib-folder').and(page.locator('[data-folder=random]'))
  await press('Enter')
  await check('回车展开随机目录', () => expect(random).toHaveAttribute('aria-expanded', 'true'))
  for (let i = 0; i < 3; i++) await press('ArrowDown')
  const randomRow = by('random-row').filter({ hasText: '随机区块' }).last()
  await check('方向键进入随机区块', () => focusIs(randomRow))
  await press('Enter')
  await check('回车展开随机详情', () => expect(randomRow).toHaveAttribute('aria-expanded', 'true'))
  count = await sections.count()
  await press('Enter')
  await check('再按回车插入随机区块', () => expect(sections).toHaveCount(count + 1))

  const subject = sections.filter({ has: by('section-name').getByText('主体', { exact: true }) }).first()
  await subject.scrollIntoViewIfNeeded()
  const bounds = await subject.boundingBox()
  await page.mouse.click(bounds.x + bounds.width - 60, bounds.y + bounds.height - 16)
  await by('section-inspector').waitFor()
  await press('ArrowDown')
  await check('面板盖住库，编辑区方向键不抢焦点', async () => {
    await expect(status).toHaveAttribute('data-state', 'section')
    expect(await lib.evaluate((el) => el.contains(document.activeElement))).toBe(false)
  })
  const save = by('section-inspector-save')
  await save.click()
  await page.locator('[data-sonner-toast]').filter({ hasText: '已保存为区块模板「主体」' }).getByRole('button', { name: '编辑' }).click()
  await check('从 toast 打开新模板编辑弹窗', async () => {
    await expect(by('template-edit')).toBeVisible()
    await expect(by('template-edit-name')).toHaveValue('主体')
  })
  await by('template-edit-name').fill('主体测试模板')
  await by('template-edit-save').click()
  await expect(by('template-edit')).toBeHidden()
  await save.locator('..').hover()
  await check('来源未改，保存置灰并显示原因', async () => {
    await expect(save).toBeDisabled()
    await expect(page.getByRole('tooltip')).toHaveText('与模板「主体测试模板」相同')
  })
  await subject.getByTestId('section-more').click()
  await check('区块菜单禁止重复保存', () => expect(by('save-template')).toBeDisabled())
  await press('Escape')
  await subject.getByTestId('chip').first().click()
  await page.mouse.wheel(0, -100)
  await press('Escape')
  await check('修改 tag 后可以另存', async () => {
    await expect(save).toHaveText('保存为新模板')
    await expect(save).toBeEnabled()
  })
  await by('new-tab').click()
  await check('新标签页不显示助手栏', async () => {
    await expect(by('assistant')).toHaveCount(0)
    await expect(status).toHaveAttribute('data-state', 'start')
  })
  await check('控制台和页面无报错', () => expect(errors).toEqual([]))
} catch (error) {
  fails++
  console.error(error)
} finally {
  await browser.close()
}
console.log(`${passed} passed, ${fails} fails`)
process.exitCode = fails ? 1 : 0
