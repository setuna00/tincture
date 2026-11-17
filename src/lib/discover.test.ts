import { describe, expect, it } from 'vitest'
import { ancestors, buildCatalog, findNode, foldItems, groupHolding, leafOf, nodeAtoms, nodeCount, occurrences, parseList, pathTo, sorter, untitledName, atomVisible, type TreeFile } from './discover'
import { decodeLookup, type LookupFile } from './tag-data'
import { collectUsage } from './usage'
import { wikiLead } from './wiki'

const { readFileSync } = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { readFileSync(p: URL, enc?: string): Uint8Array & string }
const { gunzipSync } = (await import(/* @vite-ignore */ `node:${'zlib'}`)) as { gunzipSync(b: Uint8Array): Uint8Array }
const gz = <T>(file: string) => JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(new URL(`../assets/tags/${file}.json.gz`, import.meta.url))))) as T
const text = (f: string) => readFileSync(new URL(`../../data/tags/tree/${f}`, import.meta.url), 'utf8') as unknown as string

const ROWS = decodeLookup(gz<LookupFile>('lookup'))
const TREE = gz<TreeFile>('tree')
const C = buildCatalog(ROWS, TREE)
const LISTS = { a: parseList(text('a.txt')), b: parseList(text('b.txt')), c: parseList(text('c.txt')) }

describe('list 解析', () => {
  it('三份内置 list 都用全了全部原子', () => {
    for (const root of Object.values(LISTS)) expect(new Set(nodeAtoms(root))).toEqual(new Set(C.atomInfo.keys()))
  })
  it('标题下只有一个原子 → 标题本身就是这个原子；多个原子 → 原子当叶子', () => {
    const b = LISTS.b
    expect(findNode(b, '外观/头发/长度')?.atom).toBe('发长')
    const hair = findNode(b, '外观/头发/发型')!
    expect(hair.atom).toBeUndefined()
    expect(hair.children.map((c) => c.path)).toEqual(['外观/头发/发型/@扎发', '外观/头发/发型/@编发', '外观/头发/发型/@盘发', '外观/头发/发型/@刘海前发', '外观/头发/发型/@发质造型'])
  })
  it('自建 list 的写法：tag 和 @原子 混写、注释、空行', () => {
    const r = parseList('// 注释\n# 发型\n## 扎发\ntwintails, two side up\n@编发\n\n# 光\nbacklighting')
    expect(r.children.map((c) => c.title)).toEqual(['发型', '光'])
    const tie = findNode(r, '发型/扎发')!
    expect(tie.tags).toEqual(['twintails', 'two side up'])
    expect(tie.children.map((c) => c.path)).toEqual(['发型/扎发/@编发'])
    expect(findNode(r, '光')!.tags).toEqual(['backlighting'])
  })
  it('祖先、节点下第一个这个原子的叶子', () => {
    expect(ancestors('外观/头发/发型/@扎发')).toEqual(['外观', '外观/头发', '外观/头发/发型'])
    expect(leafOf(findNode(LISTS.b, '外观')!, '扎发')).toBe('外观/头发/发型/@扎发')
  })
})

describe('分类数据', () => {
  it('挂多个原子：主位在前（nipples = 胸 + 性征），改了名的旧写法不进目录', () => {
    expect(C.atomsOf.get('nipples')).toEqual(['胸', '性征'])
    expect(C.byAtom.get('性征')!.some((t) => t.name === 'nipples')).toBe(true)
    expect(C.atomsOf.has('see-through')).toBe(false)
    expect(C.renamedTo.get('see-through')).toBe('see-through clothes')
  })
  it('tag 面板给「换成正式写法」的只有新名字在 NAI 里更常见的（swapTo ⊂ renamedTo）', () => {
    expect(C.renamedTo.size).toBe(538)
    expect(C.swapTo.size).toBe(411)
    for (const [a, b] of C.swapTo) expect(C.renamedTo.get(a)).toBe(b)
    expect(C.swapTo.get('hair blowing')).toBe('floating hair')
    expect(C.swapTo.get('twintail')).toBe('twintails')
    for (const t of ['ear biting', 'see-through', 'jewish']) {
      expect(C.renamedTo.has(t)).toBe(true)
      expect(C.swapTo.has(t)).toBe(false)
    }
  })
  it('蕴含：white shirt 折在 shirt 下面，twintails 下面是 low / short twintails', () => {
    const tops = C.byAtom.get('上衣')!
    const items = foldItems(tops, C.parents, sorter('count', true))
    expect(pathTo(items, 'white shirt')).toEqual(['shirt'])
    const tie = foldItems(C.byAtom.get('扎发')!, C.parents, sorter('count', true))
    const tw = tie.find((i) => i.t.name === 'twintails')!
    expect(tw.kids.map((k) => k.t.name)).toEqual(expect.arrayContaining(['low twintails', 'short twintails']))
    expect(tie[0].t.count).toBeGreaterThanOrEqual(tie[1].t.count)
  })
  it('只看没用过时上位词不在，下位词当顶层', () => {
    const list = C.byAtom.get('扎发')!.filter((t) => t.name !== 'twintails')
    const items = foldItems(list, C.parents, sorter('count', true))
    expect(items.some((i) => i.t.name === 'low twintails')).toBe(true)
  })
  it('「拿着」按拿的东西分组，分不出的在最后', () => {
    const items = foldItems(C.byAtom.get('拿着')!, C.parents, sorter('count', true))
    const groups = groupHolding(items, C.holdingAtom)
    expect(C.holdingAtom.get('holding sword')).toBe('冷兵器')
    expect(groups[groups.length - 1].atom).toBe('')
    expect(groups.length).toBeGreaterThan(10)
  })
  it('NSFW 关着：R18 / R18G 的原子整个不出现，节点个数也不算', () => {
    expect(atomVisible(C, '性征', 1)).toBe(false)
    expect(atomVisible(C, '性征', 2)).toBe(true)
    expect(atomVisible(C, '猎奇', 2)).toBe(false)
    const r18 = findNode(LISTS.b, 'R18')!
    expect(nodeCount(C, r18, 1)).toBe(0)
    expect(nodeCount(C, r18, 2)).toBeGreaterThan(1000)
    const chest = findNode(LISTS.a, '身体/部位/@胸')!
    expect(nodeCount(C, chest, 1)).toBeLessThan(nodeCount(C, chest, 2))
  })
  it('词义不露骨的从 R18 原子挪出来，关着时也在目录里', () => {
    expect(C.byAtom.get('腰腹')!.some((t) => t.name === 'pregnant')).toBe(true)
    expect(C.byAtom.get('手臂姿势')!.some((t) => t.name === 'bound wrists')).toBe(true)
    expect(atomVisible(C, '腰腹', 1) && atomVisible(C, '手臂姿势', 1)).toBe(true)
    expect(C.byAtom.get('束缚调教')!.some((t) => t.name === 'bound wrists')).toBe(false)
  })
})

describe('tag 在 list 里的位置', () => {
  it('服装在 B 里有「按类型」「按部位」两处，按类型在前', () => {
    expect(occurrences(LISTS.b, C.atomsOf.get('white shirt')!)).toEqual(['外观/服装/按类型/上衣外套/@上衣', '外观/服装/按部位/上身/@上衣'])
  })
  it('挂两个原子的：主位那一处在前', () => {
    const occ = occurrences(LISTS.b, C.atomsOf.get('cloudy sky')!)
    expect(occ[0]).toContain('@天空宇宙')
    expect(occ.some((p) => p.endsWith('@天气'))).toBe(true)
  })
  it('扎发在 A / B / C 里各一处', () => {
    expect(occurrences(LISTS.a, ['扎发'])).toEqual(['头发/发型/@扎发'])
    expect(occurrences(LISTS.c, ['扎发'])).toEqual(['头部/头发/@扎发'])
  })
})

describe('未命名 N（和新建文件夹一样）', () => {
  it('没有就「未命名」，有了取第一个空着的', () => {
    expect(untitledName([])).toBe('未命名')
    expect(untitledName(['未命名'])).toBe('未命名 2')
    expect(untitledName(['未命名', '未命名 2', '未命名 4'])).toBe('未命名 3')
    expect(untitledName(['雨天'])).toBe('未命名')
  })
})

describe('wiki 正文开头', () => {
  it('第一个小标题之前、最多 3 段，去掉链接和格式', () => {
    const body =
      'A hair style where the hair is tied into [[ponytail|two ponytails]].\r\n\r\nIf any hair falls normally, it is [[two side up]] instead.\r\n\r\nNot to be confused with [[multiple tails]].\r\n\r\nFourth.\r\n\r\nh4. Examples\r\n\r\n* !post #1'
    expect(wikiLead(body)).toEqual(['A hair style where the hair is tied into two ponytails.', 'If any hair falls normally, it is two side up instead.', 'Not to be confused with multiple tails.'])
  })
  it('只有例图 / 列表的：空', () => {
    expect(wikiLead('h4. See also\r\n\r\n* [[a]]')).toEqual([])
    expect(wikiLead('* !post #1\r\n* !post #2')).toEqual([])
  })
  it('外链、粗体', () => {
    expect(wikiLead('See "the guide":/wiki_pages/howto and [b]this[/b].')).toEqual(['See the guide and this.'])
  })
})

describe('用过', () => {
  it('写在哪就记哪，同一处只记一次；自定义写法 / 别名记在官方 tag 上；画师不算', () => {
    const official = (t: string) => (t === 'smiling' ? 'smile' : t)
    const u = collectUsage(
      [
        { place: '文档「A」', chips: [{ type: 'tag', text: 'smile' }, { type: 'tag', text: 'smiling' }, { type: 'artist', text: 'wlop' }] },
        { place: '区块模板「B」', chips: [{ type: 'tag', text: 'smile' }] },
      ],
      official,
    )
    expect(u.get('smile')).toEqual(['文档「A」', '区块模板「B」'])
    expect(u.has('smiling')).toBe(false)
    expect(u.has('wlop')).toBe(false)
  })
})
