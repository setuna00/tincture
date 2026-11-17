import { describe, expect, it } from 'vitest'
import { createMatcher, createSearcher } from './search-core'
import { ENTRIES } from './tag-fixture'

const search = createSearcher(ENTRIES)
const top = (q: string) => search(q, 5).map((h) => h.tag.name)

describe('tag 搜索', () => {
  it('英文前缀', () => expect(top('long ha')[0]).toBe('long hair'))
  it('下划线当空格', () => expect(top('long_ha')[0]).toBe('long hair'))
  it('中文', () => expect(top('长发')[0]).toBe('long hair'))
  it('全拼', () => expect(top('changfa')).toContain('long hair'))
  it('首字母', () => expect(top('cf')).toContain('long hair'))
  it('全拼首字母混打', () => expect(top('chuyin')[0]).toBe('hatsune miku'))
  it('别名', () => expect(top('miku')[0]).toBe('hatsune miku'))
  it('拼错兜底', () => expect(top('blnde hair')).toContain('blonde hair'))
  it('画师', () => {
    expect(top('mika pi')[0]).toBe('mika pikazo')
    expect(top('kanto')[0]).toBe('kantoku')
    expect(top('long')[0]).toBe('long hair')
    expect(search('red', 6).every((h) => h.tag.category === 'general')).toBe(true)
  })
})

describe('真实数据补的规则', () => {
  const cats = (q: string, n = 5) => search(q, n).map((h) => h.tag.category)
  it('打的是通用 tag 的中文名：角色、作品往后排（长发不先出长发公主）', () => {
    expect(top('长发')[0]).toBe('long hair')
    expect(cats('长发')).not.toContain('character')
  })
  it('打角色名的拼音：角色本人排第一，不被 cosplay 条目挤下去', () => expect(top('chuyin')[0]).toBe('hatsune miku'))
  it('别的中文叫法也能搜到（显示的是「蓝眼」）', () => expect(top('蓝色眼睛')[0]).toBe('blue eyes'))
  it('英文别名至少 3 个字母才算前缀命中', () => expect(top('cf')).not.toContain('clothed female nude male'))
  it('元信息噪声不进补全，打全了照样有', () => {
    expect(top('comm')).not.toContain('commentary request')
    expect(top('commentary request')[0]).toBe('commentary request')
  })
  it('已弃用的旧词：NAI 认的补上了旧作品数照常排；还是 0 的打全了排第一，前缀命中往后排', () => {
    expect(top('bangs')[0]).toBe('bangs')
    expect(top('bang')[0]).toBe('bangs')
    expect(top('both nude')[0]).toBe('both nude')
    const both = search('both', 20).map((h) => h.tag.name)
    expect(both).toContain('mark under both eyes')
    expect(both.indexOf('both nude')).toBeGreaterThan(both.indexOf('mark under both eyes'))
  })
})

describe('改了名的旧写法和新名字同分', () => {
  it('打 twin：新名字 twintails 在旧写法 twintail 前面', () => {
    const r = top('twin')
    expect(r.indexOf('twintails')).toBeLessThan(r.indexOf('twintail'))
    expect(r[0]).toBe('twintails')
  })
  it('打 fril、see-th：一样', () => {
    expect(top('fril').indexOf('frills')).toBeLessThan(top('fril').indexOf('frill'))
    expect(top('see-th')[0]).toBe('see-through clothes')
  })
  it('打全了旧写法，完全一样的照旧第一', () => {
    expect(top('twintail')[0]).toBe('twintail')
    expect(top('frill')[0]).toBe('frill')
  })
})

describe('未识别的 tag 按字面找像的（createMatcher）', () => {
  const match = createMatcher(ENTRIES, search)
  const names = (q: string) => match(q).map((t) => t.name)
  it('中文：tag 中文名的字都在输入里的排最前，不管顺序', () => {
    const r = names('粉色眼睛睁开')
    expect(r.slice(0, 3)).toContain('pink eyes')
    expect(r.slice(0, 5)).toContain('wide-eyed')
    expect(r).not.toContain('blue eyes')
    expect(r).not.toContain('pink hair')
  })
  it('英文：按词，eyes ≈ eye', () => expect(names('pink eye open')[0]).toBe('pink eyes'))
  it('短的照样整个搜（前缀 / 中文名）', () => expect(names('顶级')[0]).toBe('top aesthetic'))
  it('拼错的先给普通搜索的结果', () => expect(names('blnde hair')[0]).toBe('blonde hair'))
  it('字面重合只在通用 tag 里找：不出作品名（stone ocean）', () => {
    const r = names('stone staircase')
    expect(r).toContain('stone stairs')
    expect(r).not.toContain('stone ocean')
  })
  it('作品数 0 的旧词不进「可能是」', () => expect(names('pink eye open')).not.toContain('eyes'))
  it('乱写的一个都不出', () => {
    expect(names('前后确认好日期哦')).toEqual([])
    expect(names('asdf qwer')).toEqual([])
  })
})
