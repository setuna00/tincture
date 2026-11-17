import { beforeEach, describe, expect, it } from 'vitest'
import { blankDoc } from './sample'
import type { GenImage } from './storage'
import { useMarks } from './gallery-marks'
import { currentDocTitles, makeNamer, nameKey, renameImage, renameStack } from './gallery-names'
import { getDocStore, useTabs } from './tabs'

let t = 0
const img = (tabId: string, versionId: string | undefined, title: string, extra: Partial<GenImage> = {}): GenImage => {
  const doc = blankDoc(title)
  doc.meta.docId = tabId
  return { id: `i${++t}`, tabId, versionId, batch: 'b', index: 0, createdAt: t, seed: t, width: 832, height: 1216, model: '', mime: 'image/webp', size: 1, doc, ...extra }
}

beforeEach(() => useMarks.setState({ stackNames: {}, imageNames: {} }))

describe('图库里的名字', () => {
  it('没起过名 = 文档现在的名字（没有 = 快照里的）；导入的图 = 文件名', () => {
    const a = img('d1', 'v1', '雨夜')
    const imp = img('imported', undefined, 'NAI 下载 1')
    const n = makeNamer(new Map([['d1', '雨夜芙莉莲']]), {}, {})
    expect(n.image(a)).toBe('雨夜芙莉莲')
    expect(n.image(img('d2', 'v9', '海边'))).toBe('海边')
    expect(n.image(imp)).toBe('NAI 下载 1')
    expect(n.custom(a)).toBe(false)
  })
  it('叠的名字挂在那一版上；单张自己起的优先；几版的叠先看封面那版', () => {
    const v1a = img('d1', 'v1', '雨夜')
    const v1b = img('d1', 'v1', '雨夜')
    const v2 = img('d1', 'v2', '雨夜')
    const n = makeNamer(new Map(), { 'v:v1': '撑伞', 'v:v2': '回头' }, { [v1b.id]: '这张做头像' })
    expect(n.image(v1a)).toBe('撑伞')
    expect(n.image(v1b)).toBe('这张做头像')
    expect(n.stack([v1a, v1b], v1a)).toBe('撑伞')
    expect(n.stack([v1a, v2], v2)).toBe('回头')
    expect(nameKey(img('imported', undefined, 'x'))).toMatch(/^imp:/)
    expect(nameKey(img('d1', undefined, 'x'))).toBeNull()
  })
  it('改名：一叠几版一起改；改成和默认一样 / 清空 = 回到默认（跟着文档名）', () => {
    const v1 = img('d1', 'v1', '雨夜')
    const v2 = img('d1', 'v2', '雨夜')
    renameStack([v1, v2], v2, '  撑伞站姿 ')
    expect(useMarks.getState().stackNames).toEqual({ 'v:v1': '撑伞站姿', 'v:v2': '撑伞站姿' })
    renameImage(v1, '撑伞站姿')
    expect(useMarks.getState().imageNames).toEqual({})
    renameImage(v1, '头像')
    expect(useMarks.getState().imageNames).toEqual({ [v1.id]: '头像' })
    renameImage(v1, '')
    renameStack([v1, v2], v2, '雨夜')
    expect(useMarks.getState()).toMatchObject({ stackNames: {}, imageNames: {} })
  })
  it('文档现在的名字：开着的 tab 优先', () => {
    const id = useTabs.getState().forkTab()
    const store = getDocStore(id)
    store.getState().setTitle('改过名的文档')
    const docId = store.getState().doc.meta.docId!
    expect(currentDocTitles().get(docId)).toBe('改过名的文档')
  })
})
