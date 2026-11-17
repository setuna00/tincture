import { describe, expect, it, vi } from 'vitest'
import { cardTier, evict, galleryFits720, mergeIndex, postMd5, shrinkForCache, type ImageIndex } from './artist-image-core'
import { unpackPost } from './danbooru-core'

const md5 = '0123456789abcdef0123456789abcdef'
const MB = 1024 * 1024

describe('画师图存到本地：留多少', () => {
  const idx: ImageIndex = {
    'a:360': { a: ['fav artist'], s: 200 * MB, t: 1 },
    'b:720': { a: ['old'], s: 100 * MB, t: 2 },
    'c:720': { a: ['mid'], s: 100 * MB, t: 3 },
    'd:360': { a: ['new'], s: 150 * MB, t: 4 },
  }
  const inColl = (n: string) => n === 'fav artist'

  it('收藏 / 合集里的不清：总量超了也不算它，最久没看过也不挤它', () => {
    expect(evict(idx, inColl, 300 * MB)).toEqual(['b:720'])
  })

  it('超了按上次看的时间从旧到新挤，挤到不超为止', () => {
    expect(evict(idx, () => false, 300 * MB)).toEqual(['a:360', 'b:720'])
    expect(evict(idx, () => false, 150 * MB)).toEqual(['a:360', 'b:720', 'c:720'])
  })

  it('正好等于上限不挤；没超不挤', () => {
    expect(evict(idx, inColl, 350 * MB)).toEqual([])
    expect(evict({}, inColl)).toEqual([])
  })

  it('一张挂在几个画师名下：其中一个在合集里就留着', () => {
    expect(evict({ 'x:720': { a: ['other', 'fav artist'], s: 400 * MB, t: 1 } }, inColl, 300 * MB)).toEqual([])
  })
})

describe('画师图存到本地：索引批量写', () => {
  it('时间取新的、画师并进去、大小用新的', () => {
    const out = mergeIndex({ 'a:360': { a: ['x'], s: 10, t: 5 } }, [
      ['a:360', { t: 9, a: 'y' }],
      ['b:720', { t: 3, a: 'x', s: 20 }],
    ])
    expect(out).toEqual({ 'a:360': { a: ['x', 'y'], s: 10, t: 9 }, 'b:720': { a: ['x'], s: 20, t: 3 } })
  })

  it('同一个画师不重复；时间往回不改；不知道多大的新条目不加', () => {
    const out = mergeIndex({ 'a:360': { a: ['x'], s: 10, t: 5 } }, [
      ['a:360', { t: 1, a: 'x' }],
      ['c:360', { t: 2, a: 'x' }],
    ])
    expect(out).toEqual({ 'a:360': { a: ['x'], s: 10, t: 5 } })
  })

  it('补上的孤图：没有画师', () => {
    expect(mergeIndex({}, [['o:360', { t: 1, s: 5 }]])).toEqual({ 'o:360': { a: [], s: 5, t: 1 } })
  })
})

describe('画师图存到本地：存哪档', () => {
  const p = unpackPost([1, md5, 'jpg', 1000, 1500, 1, 'g', 0])

  it('md5 从 720 那档的地址拿', () => {
    expect(postMd5(p)).toBe(md5)
  })

  it('显示宽 × 像素密度放得进 360 那档用 360，放不进用 720（同 srcset）', () => {
    expect(cardTier(p, 120, 2)).toBe(360)
    expect(cardTier(p, 240, 1)).toBe(360)
    expect(cardTier(p, 130, 2)).toBe(720)
  })

  it('原图小到两档一样宽（srcset 里只有 360）：用 360', () => {
    const small = unpackPost([2, md5, 'jpg', 300, 200, 0, 'g', 0])
    expect(cardTier(small, 300, 2)).toBe(360)
  })

  it('gallery：720 那档够宽就不叠 sample；没有 sample 的也够', () => {
    expect(galleryFits720(p, 240, 2)).toBe(true)
    expect(galleryFits720(p, 300, 2)).toBe(false)
    expect(galleryFits720(unpackPost([3, md5, 'mp4', 1000, 1500, 1, 'g', 0]), 300, 2)).toBe(true)
  })
})

describe('画师图存到本地：转 WebP', () => {
  const jpg = new Blob([new Uint8Array(100)], { type: 'image/jpeg' })

  it('转完更小：存 WebP', async () => {
    const webp = new Blob([new Uint8Array(60)], { type: 'image/webp' })
    expect(await shrinkForCache(jpg, async () => webp)).toBe(webp)
  })

  it('转完反而更大（或一样大）：存原样', async () => {
    expect(await shrinkForCache(jpg, async () => new Blob([new Uint8Array(140)], { type: 'image/webp' }))).toBe(jpg)
    expect(await shrinkForCache(jpg, async () => new Blob([new Uint8Array(100)], { type: 'image/webp' }))).toBe(jpg)
  })

  it('转不了：存原样；本来就是 WebP：不转', async () => {
    expect(
      await shrinkForCache(jpg, async () => {
        throw new Error('decode')
      }),
    ).toBe(jpg)
    const webp = new Blob([new Uint8Array(80)], { type: 'image/webp' })
    const encode = vi.fn()
    expect(await shrinkForCache(webp, encode)).toBe(webp)
    expect(encode).not.toHaveBeenCalled()
  })
})
