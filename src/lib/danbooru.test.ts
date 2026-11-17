import { describe, expect, it } from 'vitest'
import { cleanOtherNames, coverFirstPosts, dedupePosts, packPosts, pickPosts, postSrcSet, shownWidth, unpackPost, type DanbooruPost } from './danbooru-core'

const post = (id: number, extra: Partial<DanbooruPost> = {}): DanbooruPost => ({
  id,
  r: 'g',
  w: 1000,
  h: 2000,
  thumb: `t${id}`,
  large: `l${id}`,
  ...extra,
})

describe('dedupePosts：同一组差分只留分数最高的一张', () => {
  it('父子帖子算一家，顺着 parent 往上找到头', () => {
    const list = [post(1), post(2, { parent: 1 }), post(3), post(4, { parent: 2 })]
    expect(dedupePosts(list).map((p) => p.id)).toEqual([1, 3])
  })
  it('父帖子不在列表里时，兄弟几个也算一家', () => {
    const list = [post(5, { parent: 99 }), post(6), post(7, { parent: 99 })]
    expect(dedupePosts(list).map((p) => p.id)).toEqual([5, 6])
  })
  it('最多留 n 张', () => {
    expect(dedupePosts([post(1), post(2), post(3)], 2)).toHaveLength(2)
  })
})

describe('postSrcSet：各尺寸的实际宽度从原图宽高算', () => {
  it('竖图：360 / 720 按长边缩，sample 850 宽，原图原宽', () => {
    const p = post(1, { w: 1307, h: 2500, sample: 's', orig: 'o' })
    expect(postSrcSet(p, { thumb: true, large: true, sample: true, orig: true })).toBe('t1 188w, l1 376w, s 850w, o 1307w')
  })
  it('小图不放大；同宽的只留排在前面（文件小）的那个', () => {
    const p = post(1, { w: 600, h: 400, orig: 'o' })
    expect(postSrcSet(p, { thumb: true, large: true, orig: true })).toBe('t1 360w, l1 600w')
  })
  it('显示宽度：cover 按短边撑满，contain 整张放进框', () => {
    const p = post(1, { w: 3000, h: 2000 })
    expect(shownWidth(p, 100, 150, 'cover')).toBe(225)
    expect(shownWidth(p, 376, 470, 'contain')).toBe(376)
  })
})

describe('coverFirstPosts', () => {
  it('卡片上的 3 张按同样顺序排最前，其余不重复、保持原顺序', () => {
    const posts = Array.from({ length: 10 }, (_, i) => post(i))
    const cover = pickPosts('a', 'sfw', posts)
    const out = coverFirstPosts('a', 'sfw', posts)
    expect(out.slice(0, 3)).toEqual(cover)
    expect(out).toHaveLength(10)
    const rest = out.slice(3).map((p) => p.id)
    expect(rest).toEqual(posts.map((p) => p.id).filter((id) => !cover.some((c) => c.id === id)))
  })
})

describe('预存 / 缓存的压缩帖子', () => {
  const md5 = '7a42ff1c29f640f6d668666667490c57'
  it('CDN 地址按 md5 拼：360 jpg、720 webp、sample jpg、原图原格式', () => {
    const p = unpackPost([7027422, md5, 'png', 1307, 2500, 1, 's', 0])
    expect(p.thumb).toBe(`https://cdn.donmai.us/360x360/7a/42/${md5}.jpg`)
    expect(p.large).toBe(`https://cdn.donmai.us/720x720/7a/42/${md5}.webp`)
    expect(p.sample).toBe(`https://cdn.donmai.us/sample/7a/42/sample-${md5}.jpg`)
    expect(p.orig).toBe(`https://cdn.donmai.us/original/7a/42/${md5}.png`)
    expect(p.parent).toBeUndefined()
  })
  it('视频 / 动图没有 sample 和原图（<img> 放不了）；没有 sample 的不给', () => {
    const v = unpackPost([1, md5, 'mp4', 1920, 1080, 1, 'g', 5])
    expect(v.parent).toBe(5)
    expect(v).not.toHaveProperty('sample')
    expect(v).not.toHaveProperty('orig')
    expect(unpackPost([1, md5, 'jpg', 600, 800, 0, 'g', 0]).sample).toBeUndefined()
  })
  it('API 的帖子：没有 md5（不登录看不到）和 Flash 不要', () => {
    const base = { file_ext: 'jpg', rating: 'g' as const, image_width: 1, image_height: 1, parent_id: null, has_large: false }
    expect(packPosts([{ id: 1, md5, ...base }, { id: 2, ...base }, { id: 3, md5, ...base, file_ext: 'swf' }]).map((p) => p[0])).toEqual([1])
  })
  it('其他名字去掉邮箱、网址，去重', () => {
    expect(cleanOtherNames(['wang_ling', 'artist@example.com', 'https://x.com/a', 'wang_ling', '海浪松饼'])).toEqual(['wang_ling', '海浪松饼'])
  })
  it('换了作品列表（预存的换成新抓的），卡片上抽中的不在新列表里就重抽', () => {
    const a = Array.from({ length: 5 }, (_, i) => post(i))
    const first = pickPosts('re', 'all', a)
    expect(pickPosts('re', 'all', a)).toBe(first)
    const b = Array.from({ length: 5 }, (_, i) => post(i + 100))
    expect(pickPosts('re', 'all', b).every((p) => p.id >= 100)).toBe(true)
  })
})
