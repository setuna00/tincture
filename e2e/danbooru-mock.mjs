// Cloudflare challenges headless browsers, so real Danbooru images and API responses are unavailable here.
// The image cache decodes and transcodes CDN responses, so mocks need real JPEG/WebP bytes and permissive CORS.
import { existsSync, readFileSync } from 'node:fs'

const FIXTURE = new URL('./fixtures/danbooru-artists.json', import.meta.url)
let fixture = null
const data = () => (fixture ??= existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : { artists: {}, aliases: {} })
const byTag = () => new Map(Object.values(data().artists).map((a) => [a.tag, a]))

const IMAGE_HOSTS = /^https:\/\/([\w-]+\.)*(donmai\.us|pixiv\.net|twimg\.com|bsky\.app|fanbox\.cc|patreon\.com|weibo\.com|lofter\.com|artstation\.com)\//
export function placeholderSvg(url) {
  let h = 0
  for (const ch of url) h = (h * 31 + ch.charCodeAt(0)) % 3600
  const hue = h % 360
  const height = [480, 360, 240][h % 3]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 45% 72%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 35% 34%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="180" cy="${height * 0.4}" r="56" fill="hsl(${hue} 60% 94% / .5)"/></svg>`
}

const HUES = 12
let rasters = null
function makeRasters(browser) {
  return (rasters ??= (async () => {
    const p = await browser.newPage()
    const out = await p.evaluate(async (HUES) => {
      const b64 = async (blob) => {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        let s = ''
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        return btoa(s)
      }
      const draw = async (w, h, hue, type, quality) => {
        const c = new OffscreenCanvas(w, h)
        const g = c.getContext('2d')
        const lg = g.createLinearGradient(0, 0, w, h)
        lg.addColorStop(0, `hsl(${hue} 45% 72%)`)
        lg.addColorStop(1, `hsl(${(hue + 40) % 360} 35% 34%)`)
        g.fillStyle = lg
        g.fillRect(0, 0, w, h)
        g.fillStyle = `hsl(${hue} 60% 94% / .5)`
        g.beginPath()
        g.arc(w / 2, h * 0.4, w * 0.155, 0, Math.PI * 2)
        g.fill()
        const d = g.getImageData(0, 0, w, h)
        let seed = 7
        for (let i = 0; i < d.data.length; i += 4) {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff
          const n = ((seed >> 16) % 13) - 6
          d.data[i] += n
          d.data[i + 1] += n
          d.data[i + 2] += n
        }
        g.putImageData(d, 0, 0)
        return b64(await c.convertToBlob({ type, quality }))
      }
      const res = {}
      for (let k = 0; k < HUES; k++)
        for (const [j, h] of [480, 360, 240].entries()) {
          const hue = k * (360 / HUES)
          res[`${k}:${j}`] = { small: await draw(360, h, hue, 'image/jpeg', 0.92), bigJpg: await draw(720, h * 2, hue, 'image/jpeg', 0.92), bigWebp: await draw(720, h * 2, hue, 'image/webp', 0.9) }
        }
      return res
    }, HUES)
    await p.close()
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([n, s]) => [n, Buffer.from(s, 'base64')]))]))
  })())
}
function rasterFor(all, url) {
  let h = 0
  for (const ch of url) h = (h * 31 + ch.charCodeAt(0)) % 3600
  const set = all[`${Math.floor((h % 360) / (360 / HUES))}:${h % 3}`]
  if (url.endsWith('.webp')) return { contentType: 'image/webp', body: set.bigWebp }
  return { contentType: 'image/jpeg', body: url.includes('/360x360/') ? set.small : set.bigJpg }
}
const CDN_RASTER = /^https:\/\/cdn\.donmai\.us\/.+\.(jpe?g|png|webp)$/

function apiPost(p) {
  const md5 = p.thumb.match(/([0-9a-f]{32})/)[1]
  const ext = p.orig ? p.orig.split('.').pop() : 'mp4'
  return { id: p.id, md5, file_ext: ext, rating: p.r, image_width: p.w, image_height: p.h, parent_id: p.parent ?? null, has_large: !!p.sample }
}

function api(url) {
  const u = new URL(url)
  const s = u.searchParams
  const tagsOf = (q) => (q ?? '').split(' ').filter(Boolean)
  if (u.pathname === '/posts.json') {
    const t = tagsOf(s.get('tags'))
    const a = byTag().get(t.find((x) => !x.includes(':')))
    if (!a) return []
    const sfw = t.includes('rating:g,s')
    return a.posts[sfw ? 'sfw' : 'all'].slice(0, Number(s.get('limit') ?? 20)).map(apiPost)
  }
  if (u.pathname === '/counts/posts.json') {
    const a = byTag().get(tagsOf(s.get('tags')).find((x) => !x.includes(':')))
    return { counts: { posts: a ? a.nsfwCount : 0 } }
  }
  if (u.pathname === '/artists.json') {
    const a = byTag().get(s.get('search[name]'))
    return a ? [{ name: a.tag, other_names: a.otherNames, urls: a.urls.map((url) => ({ url, is_active: true })) }] : []
  }
  if (u.pathname === '/tag_aliases.json') {
    const to = data().aliases?.[s.get('search[antecedent_name]')]
    return to ? [{ antecedent_name: s.get('search[antecedent_name]'), consequent_name: to }] : []
  }
  if (u.pathname === '/related_tag.json') {
    const t = tagsOf(s.get('search[query]'))
    const mode = t.includes('rating:g,s') ? 'sfw' : 'all'
    const q = t.find((x) => !x.includes(':'))
    if (s.get('search[category]') === 'artist') {
      const hits = [...byTag().values()]
        .map((a) => [a, a.related[mode].find((r) => r[0] === q)?.[1] ?? 0])
        .filter(([, f]) => f > 0)
        .sort((x, y) => y[1] - x[1])
      return { query: q, related_tags: hits.map(([a, f]) => ({ tag: { name: a.tag, post_count: a.postCount, category: 1 }, cosine_similarity: f, frequency: f, overlap_coefficient: f })) }
    }
    const a = byTag().get(q)
    return { query: q, related_tags: (a?.related[mode] ?? []).map(([name, frequency, post_count]) => ({ tag: { name, post_count, category: 0 }, frequency })) }
  }
  return []
}

export async function routeDanbooru(page, { log } = {}) {
  const browser = page.context().browser()
  const all = browser ? await makeRasters(browser) : null
  await page.route(IMAGE_HOSTS, (route) => {
    const url = route.request().url()
    if (/^https:\/\/danbooru\.donmai\.us\/[\w/]+\.json/.test(url)) {
      log?.push(url.replace('https://danbooru.donmai.us', ''))
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(api(url)) })
    }
    if (all && CDN_RASTER.test(url)) return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=31536000' }, ...rasterFor(all, url) })
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: placeholderSvg(url) })
  })
}
