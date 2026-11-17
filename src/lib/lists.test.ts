import { describe, expect, it } from 'vitest'
import { addNode, addTags, allTags, normalizeNodes, canMoveNode, deleteNode, ensurePath, exampleLists, findListNode, moveNode, moveTags, nodeChain, nodeText, parseNodeText, removeTags, renameNode, setTags, siblingIndex, toListTree, applyListOps, resolveNode, packHistory, unpackHistory, type UserList, type UserListNode } from './lists'
import { findNode } from './discover'

const node = (id: string, title: string, tags: string[] = [], children: UserListNode[] = []): UserListNode => ({ id, title, tags, children })
const tree = () => [node('a', '人物', [], [node('a1', '发型', ['hime cut', 'sidelocks']), node('a2', '表情', ['smile'])]), node('b', '场景', ['outdoors'], [node('b1', '樱花', ['petals'])])]

describe('自建 list：查', () => {
  it('找节点、从根到它的一串、节点和下面全部的 tag（去重）', () => {
    const t = tree()
    expect(findListNode(t, 'a2')?.title).toBe('表情')
    expect(nodeChain(t, 'b1').map((n) => n.title)).toEqual(['场景', '樱花'])
    expect(allTags(t[1])).toEqual(['outdoors', 'petals'])
  })
  it('换成发现页的树：path 是一串 id，标题另放', () => {
    const l = { id: 'l', name: '我的', nodes: tree(), createdAt: 0 }
    const r = toListTree(l)
    expect(r.children.map((c) => c.path)).toEqual(['a', 'b'])
    const n = findNode(r, 'a/a1')!
    expect(n.title).toBe('发型')
    expect(n.tags).toEqual(['hime cut', 'sidelocks'])
    expect(n.id).toBe('a1')
  })
})

describe('自建 list：改', () => {
  it('加 tag：已经在里面的跳过（不分大小写），返回真正加进去的；什么都没加时原样返回', () => {
    const t = tree()
    const r = addTags(t, 'a1', ['Hime Cut', 'bangs', 'bangs', ' '])
    expect(r.added).toEqual(['bangs'])
    expect(findListNode(r.nodes, 'a1')!.tags).toEqual(['hime cut', 'sidelocks', 'bangs'])
    expect(findListNode(t, 'a1')!.tags).toEqual(['hime cut', 'sidelocks'])
    expect(addTags(t, 'a1', ['sidelocks']).nodes).toBe(t)
  })
  it('移出（多选来自几个节点）、移到别的节点（目标里有的不重复）', () => {
    const t = tree()
    const r = removeTags(t, [
      ['a1', 'sidelocks'],
      ['a2', 'smile'],
    ])
    expect(findListNode(r, 'a1')!.tags).toEqual(['hime cut'])
    expect(findListNode(r, 'a2')!.tags).toEqual([])
    const m = moveTags(addTags(t, 'b1', ['hime cut']).nodes, [['a1', 'hime cut'], ['a1', 'sidelocks']], 'b1')
    expect(findListNode(m, 'a1')!.tags).toEqual([])
    expect(findListNode(m, 'b1')!.tags).toEqual(['petals', 'hime cut', 'sidelocks'])
  })
  it('文本入口：逗号分隔、末尾带逗号；拆回时权重去掉、下划线当空格、重复的只留一个，写法原样', () => {
    expect(nodeText(['a', 'b'])).toBe('a, b, ')
    expect(nodeText([])).toBe('')
    expect(parseNodeText('long_hair, 1.2::Smiling::, {blush}, smile, Smile, artist:wlop,')).toEqual(['long hair', 'Smiling', 'blush', 'smile', 'artist:wlop'])
    const t = tree()
    expect(setTags(t, 'a1', ['hime cut', 'sidelocks'])).toBe(t)
    expect(findListNode(setTags(t, 'a1', ['bangs']), 'a1')!.tags).toEqual(['bangs'])
  })
  it('新建节点：未命名 / 未命名 2；按路径建（有就用、没有一层层建）', () => {
    let t = tree()
    const r1 = addNode(t, null)
    t = r1.nodes
    expect(r1.node.title).toBe('未命名')
    const r2 = addNode(t, null)
    expect(r2.node.title).toBe('未命名 2')
    const r3 = ensurePath(tree(), null, '人物 / 发型')
    expect(r3.node!.id).toBe('a1')
    const r4 = ensurePath(tree(), 'b', '夜樱/灯笼')
    expect(nodeChain(r4.nodes, r4.node!.id).map((n) => n.title)).toEqual(['场景', '夜樱', '灯笼'])
  })
  it('改名、删除节点（连同里面的）', () => {
    const t = tree()
    expect(findListNode(renameNode(t, 'a1', ' 头发 '), 'a1')!.title).toBe('头发')
    expect(renameNode(t, 'a1', '  ')).toBe(t)
    const d = deleteNode(t, 'a')
    expect(d.map((n) => n.id)).toEqual(['b'])
  })
  it('拖节点：前 / 后 / 放进去；不能放进自己下面', () => {
    const t = tree()
    expect(moveNode(t, 'b', 'a', 'before').map((n) => n.id)).toEqual(['b', 'a'])
    expect(findListNode(moveNode(t, 'a2', 'b1', 'after'), 'b')!.children.map((n) => n.id)).toEqual(['b1', 'a2'])
    expect(findListNode(moveNode(t, 'a1', 'b', 'inside'), 'b')!.children.map((n) => n.id)).toEqual(['b1', 'a1'])
    expect(canMoveNode(t, 'a', 'a1')).toBe(false)
    expect(moveNode(t, 'a', 'a1', 'inside')).toBe(t)
  })
})

describe('自建 list：推荐补充', () => {
  it('同一个节点里的兄弟（官方写法；别名换成正式写法，不认得的不进来）', () => {
    const lists = [{ id: 'l', name: 'x', createdAt: 0, nodes: [node('n', '表情', ['smile', 'smiling', 'light smile', 'gentle smile']), node('m', '别的', ['smile', 'blush'])] }]
    const official = (t: string) => (t === 'smiling' ? 'smile' : t === 'gentle smile' ? null : t)
    const siblings = siblingIndex(lists, official)
    expect(siblings('smile')).toEqual(['light smile', 'blush'])
    expect(siblings('light smile')).toEqual(['smile'])
    expect(siblings('gentle smile')).toEqual([])
  })
  it('几千个 tag 的节点（大节点全选放进来）：加、移出、建索引都不卡', () => {
    const many = Array.from({ length: 9000 }, (_, i) => `tag ${i}`)
    let t = performance.now()
    const r = addTags(tree(), 'a1', many)
    expect(r.added.length).toBe(9000)
    expect(addTags(r.nodes, 'a1', many).added.length).toBe(0)
    const r2 = removeTags(r.nodes, many.slice(0, 8000).map((x) => ['a1', x] as [string, string]))
    expect(findListNode(r2, 'a1')!.tags.length).toBe(2 + 1000)
    const siblings = siblingIndex([{ id: 'l', name: 'x', createdAt: 0, nodes: r.nodes }], (x) => x)
    expect(siblings('tag 1').length).toBe(9000 + 2 - 1)
    expect(performance.now() - t).toBeLessThan(1000)
    t = performance.now()
    expect(parseNodeText(many.join(', ')).length).toBe(9000)
    expect(performance.now() - t).toBeLessThan(500)
  })
  it('示例 list：两层，有未识别的词；别名已经合进正式写法', () => {
    const [l] = exampleLists()
    expect(l.name).toBe('樱花场景')
    expect(l.nodes.map((n) => n.title)).toEqual(['人物', '场景'])
    const all = l.nodes.flatMap(allTags)
    expect(all).not.toContain('smiling')
    expect(all).toContain('rim lighting')
  })
  it('整份换成正式写法：每个节点里换完去重，没变的节点引用不变', () => {
    const t = [node('a', '表情', ['smile', 'smiling', 'Light Smile']), node('b', '发型', ['twintails', 'twintail'], [node('c', '别的', ['bangs'])])]
    const fn = (x: string) => ({ smiling: 'smile', twintail: 'twintails', 'light smile': 'light smile' })[x.toLowerCase()] ?? x
    const r = normalizeNodes(t, fn)
    expect(findListNode(r, 'a')!.tags).toEqual(['smile', 'light smile'])
    expect(findListNode(r, 'b')!.tags).toEqual(['twintails'])
    expect(findListNode(r, 'c')).toBe(t[1].children[0])
    expect(normalizeNodes(r, fn)).toBe(r)
  })
})

describe('AI 代理改 list（edit_list）', () => {
  const norm = (tags: string[]) => {
    const merged: [string, string][] = []
    const out = tags.map((t) => {
      if (t !== 'smiling') return t
      merged.push([t, 'smile'])
      return 'smile'
    })
    return { tags: out, merged }
  }
  const list = () => ({ id: 'l', name: '我的', nodes: tree(), createdAt: 0 })
  it('节点按 id 或标题路径找', () => {
    const t = tree()
    expect(resolveNode(t, 'a2')?.title).toBe('表情')
    expect(resolveNode(t, '人物/表情')?.id).toBe('a2')
    expect(resolveNode(t, '人物/没有')).toBeUndefined()
  })
  it('一串操作按顺序做：路径没有就建、写法换成正式写法、出错的那步跳过、后面照做', () => {
    const r = applyListOps(
      list(),
      [
        { op: 'add_tags', node: '服装/外套', tags: ['winter coat', 'smiling', 'winter coat'] },
        { op: 'remove_tags', node: 'a2', tags: ['SMILE'] },
        { op: 'delete_node', node: '没有' },
        { op: 'move_tags', node: '人物/发型', to: 'b1', tags: ['sidelocks'] },
        { op: 'rename_node', node: 'b', title: '背景' },
        { op: 'rename_list', title: '冬天' },
      ],
      norm,
    )
    expect(r.list.name).toBe('冬天')
    expect(resolveNode(r.list.nodes, '服装/外套')?.tags).toEqual(['winter coat', 'smile'])
    expect(findListNode(r.list.nodes, 'a2')?.tags).toEqual([])
    expect(findListNode(r.list.nodes, 'b1')?.tags).toEqual(['petals', 'sidelocks'])
    expect(findListNode(r.list.nodes, 'b')?.title).toBe('背景')
    expect(r.log[0]).toMatch(/added 2 .*1 already there.*smiling → smile/)
    expect(r.log[2]).toMatch(/skipped \(Node not found: 没有\)/)
    expect(r.log).toHaveLength(6)
  })
  it('什么都没改：原样返回（不进撤销）', () => {
    const l = list()
    expect(applyListOps(l, [{ op: 'add_tags', node: 'a2', tags: ['smile'] }], norm).list).toBe(l)
  })
})

describe('撤销记录存档', () => {
  const mk = (): UserList[] => [{ id: 'l1', name: '我的', nodes: tree(), createdAt: 0 }, { id: 'l2', name: '别的', nodes: [node('c', '杂', ['x'])], createdAt: 0 }]
  it('没改过的 list、节点只记 id；解开以后是现在的同一个对象', () => {
    const before = mk()
    const after = [{ ...before[0], nodes: removeTags(before[0].nodes, [['a1', 'hime cut']]) }, before[1]]
    const packed = packHistory([before], after)
    const json = JSON.parse(JSON.stringify(packed))
    expect(json[0][1]).toEqual({ $ref: 'l2' })
    const l1 = json[0][0]
    expect(l1.nodes[1]).toEqual({ $ref: 'b' })
    expect(l1.nodes[0].children[1]).toEqual({ $ref: 'a2' })
    expect(l1.nodes[0].children[0].tags).toEqual(['hime cut', 'sidelocks'])
    const back = unpackHistory(json, after)!
    expect(back[0][0].nodes[0].children[0].tags).toEqual(['hime cut', 'sidelocks'])
    expect(back[0][1]).toBe(after[1])
    expect(back[0][0].nodes[1]).toBe(after[0].nodes[1])
  })
  it('删掉的 list 整份存；对不上（存档坏了）就不要这份记录', () => {
    const before = mk()
    const after = [before[1]]
    const json = JSON.parse(JSON.stringify(packHistory([before], after)))
    expect(json[0][0].name).toBe('我的')
    expect(unpackHistory(json, after)![0][0].nodes[0].children[0].title).toBe('发型')
    expect(unpackHistory([[{ $ref: 'nope' }]], after)).toBeNull()
    expect(unpackHistory('x', after)).toBeNull()
  })
})
