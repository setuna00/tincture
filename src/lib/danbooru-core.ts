/** Danbooru rating codes: g = general, s = sensitive, q = questionable, e = explicit; sfw includes g/s. */
export type Rating = 'g' | 's' | 'q' | 'e'
export type RatingMode = 'sfw' | 'all'

export interface DanbooruPost {
  id: number
  r: Rating
  w: number
  h: number
  parent?: number
  thumb: string
  large: string
  sample?: string
  orig?: string
}

/** Packed rows store [id, md5, extension, width, height, hasSample(1/0), rating, parentId(0 if absent)]. */
export type PackedPost = [number, string, string, number, number, 0 | 1, Rating, number]

const CDN = 'https://cdn.donmai.us'
const STATIC = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'])
export function unpackPost([id, md5, ext, w, h, large, r, parent]: PackedPost): DanbooruPost {
  const dir = `${md5.slice(0, 2)}/${md5.slice(2, 4)}`
  const still = STATIC.has(ext)
  return {
    id,
    r,
    w,
    h,
    ...(parent ? { parent } : {}),
    thumb: `${CDN}/360x360/${dir}/${md5}.jpg`,
    large: `${CDN}/720x720/${dir}/${md5}.webp`,
    // Animated/video samples are WebM, which an <img> cannot display.
    ...(large && still && ext !== 'gif' ? { sample: `${CDN}/sample/${dir}/sample-${md5}.jpg` } : {}),
    ...(still ? { orig: `${CDN}/original/${dir}/${md5}.${ext}` } : {}),
  }
}

export interface ApiPost {
  id: number
  md5?: string
  file_ext: string
  rating: Rating
  image_width: number
  image_height: number
  parent_id: number | null
  has_large: boolean
}
export const POST_FIELDS = 'id,md5,file_ext,rating,image_width,image_height,parent_id,has_large'
export const packPosts = (list: ApiPost[]): PackedPost[] =>
  list.filter((p) => p.md5 && p.file_ext !== 'swf').map((p) => [p.id, p.md5!, p.file_ext, p.image_width, p.image_height, p.has_large ? 1 : 0, p.rating, p.parent_id ?? 0])

export const toTag = (name: string) => name.replace(/ /g, '_')
export const fromTag = (tag: string) => tag.replace(/_/g, ' ')

export const danbooruArtistUrl = (name: string) => `https://danbooru.donmai.us/artists/show_or_new?name=${encodeURIComponent(toTag(name))}`
export const DANBOORU_ICON = 'https://danbooru.donmai.us/favicon.svg'

export function dedupePosts<T extends { id: number; parent?: number }>(posts: T[], n = 20): T[] {
  const up = new Map<number, number>()
  const find = (x: number): number => {
    while (up.has(x) && up.get(x) !== x) x = up.get(x)!
    return x
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) up.set(ra, rb)
  }
  for (const p of posts) if (p.parent) union(p.id, p.parent)
  const families = new Set<number>()
  const kept: T[] = []
  for (const p of posts) {
    const f = find(p.id)
    if (families.has(f)) continue
    families.add(f)
    kept.push(p)
    if (kept.length >= n) break
  }
  return kept
}

const picked = new Map<string, DanbooruPost[]>()
export function pickPosts(name: string, mode: RatingMode, posts: DanbooruPost[], n = 3): DanbooruPost[] {
  const key = `${mode}:${name}`
  let got = picked.get(key)
  if (got && !got.every((p) => posts.some((x) => x.id === p.id))) got = undefined
  if (!got) {
    const pool = [...posts]
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    got = pool.slice(0, n)
    picked.set(key, got)
  }
  return got
}

export function coverFirstPosts(name: string, mode: RatingMode, posts: DanbooruPost[]): DanbooruPost[] {
  const cover = pickPosts(name, mode, posts)
  const ids = new Set(cover.map((p) => p.id))
  return [...cover, ...posts.filter((p) => !ids.has(p.id))]
}

export function postSrcSet(p: DanbooruPost, use: { thumb?: boolean; large?: boolean; sample?: boolean; orig?: boolean }): string {
  const fit = (box: number) => Math.round(p.w * Math.min(1, box / Math.max(p.w, p.h)))
  const list: [string | undefined, number][] = [
    [use.thumb ? p.thumb : undefined, fit(360)],
    [use.large ? p.large : undefined, fit(720)],
    [use.sample ? p.sample : undefined, Math.min(850, p.w)],
    [use.orig ? p.orig : undefined, p.w],
  ]
  const widths = new Set<number>()
  const out: string[] = []
  for (const [url, w] of list) {
    if (!url || widths.has(w)) continue
    widths.add(w)
    out.push(`${url} ${w}w`)
  }
  return out.join(', ')
}

export function shownWidth(p: DanbooruPost, boxW: number, boxH: number, fit: 'cover' | 'contain'): number {
  const ratio = p.w / p.h
  return Math.round(fit === 'cover' ? Math.max(boxW, boxH * ratio) : Math.min(boxW, boxH * ratio))
}

export function cardCell(count: number, i: number, W: number): [number, number] {
  if (count === 1) return [W, W]
  if (count === 2) return [W / 2, W]
  return i === 0 ? [(W * 2) / 3, W] : [W / 3, W / 2]
}

const GALLERY_W = 376
export const galleryShown = (p: DanbooruPost) => shownWidth(p, GALLERY_W, GALLERY_W * 1.25, 'contain')
export function gallerySrc(p: DanbooruPost) {
  return { srcSet: postSrcSet(p, { large: true, sample: true }), sizes: `${galleryShown(p)}px` }
}

export type Related = [string, number, number]

export type TopicKind = 'style' | 'look' | 'outfit' | 'scene' | 'other'

export interface TopicMeta {
  totalPosts: number
  kinds: Record<string, TopicKind>
  implies: Record<string, string[]>
}

export function relatedFromApi(lists: { related_tags: { tag: { name: string; post_count: number }; frequency: number }[] }[]): Related[] {
  const seen = new Map<string, Related>()
  for (const l of lists)
    for (const r of l.related_tags)
      if (r.frequency >= 0.04 && !seen.has(r.tag.name)) seen.set(r.tag.name, [r.tag.name, Math.round(r.frequency * 1000) / 1000, r.tag.post_count])
  return [...seen.values()]
}

const TOPIC_NOISE = new Set([
  'twitter_username', 'artist_name', 'signature', 'dated', 'watermark', 'web_address', 'patreon_username', 'pixiv_username',
  'character_name', 'copyright_name', 'one-hour_drawing_challenge', 'artist_logo', 'twitter_logo', 'sample_watermark',
  'commentary', 'commentary_request', 'translated', 'highres', 'absurdres', 'copyright_notice', 'company_name', 'page_number',
  'cover', 'logo', 'english_text', 'border', 'grey_border', 'white_border', 'virtual_youtuber', 'alternate_costume',
])
const GENERIC_SCENE = new Set('indoors outdoors day night sky cloud blue_sky cloudy_sky tree grass building sunlight window'.split(' '))
const isNoise = (tag: string) => TOPIC_NOISE.has(tag) || GENERIC_SCENE.has(tag) || /_(username|logo)$/.test(tag)

const wordSet = (s: string) => new Set(s.split(/\s+/))
const STYLE_FALLBACK = wordSet(
  'colorful light_particles spot_color lens_flare sparkle glowing glow bloom motion_blur motion_lines speed_lines film_grain halftone dithering gradient pastel_colors limited_palette flat_color lineart sketch watercolor_(medium) traditional_media oil_painting_(medium) pixel_art chibi tachi-e',
)
const OUTFIT_WORDS = wordSet(
  'dress skirt shirt glove gloves shoes boots socks thighhighs kneehighs pantyhose legwear footwear headwear jacket coat hat cap uniform kimono sleeves sleeve collar trim belt ribbon bow necktie tie panties bra swimsuit bikini hood cape cloak armor gauntlets helmet apron shorts pants choker earrings necklace jewelry bracelet hairband headband ornament hairclip scarf vest sweater hoodie leotard bodysuit clothes clothing print plaid frills lace buttons pocket cardigan serafuku sailor blazer camisole corset garter cuffs bandages eyewear glasses goggles mask veil crown tiara halo underwear buckle lapels fatigues costume strap straps harness zipper epaulettes badge emblem armband sash obi sandals heels sneakers loafers leggings bloomers suspenders bowtie neckerchief capelet chain',
)
const LOOK_WORDS = wordSet(
  'hair bangs ponytail twintails braid braids bob_cut ahoge sidelocks eyes pupils eyelashes eyebrows breasts lips nose skin teeth fang fingernails nail_polish makeup ears tail horns wings mole freckles tan muscular abs thighs navel collarbone cleavage heterochromia eyeshadow lipstick stubble beard drills petite curvy',
)
const SCENE_WORDS = wordSet(
  'flower flowers fish butterfly chair book books cup food fruit bird cat dog animal plant plants leaf leaves petals umbrella weapon sword gun katana instrument guitar phone cellphone bag bottle table bed pillow curtains lantern candle balloon moon stars bubble',
)
export function topicKind(tag: string, meta: Pick<TopicMeta, 'kinds'>): TopicKind {
  const k = meta.kinds[tag]
  if (k) return k
  if (STYLE_FALLBACK.has(tag)) return 'style'
  const parts = tag.split('_')
  const has = (set: Set<string>) => set.has(tag) || parts.some((x) => set.has(x))
  if (has(OUTFIT_WORDS) || tag.endsWith('wear')) return 'outfit'
  if (has(LOOK_WORDS)) return 'look'
  if (has(SCENE_WORDS)) return 'scene'
  return 'other'
}

const SIDE_CAP: Partial<Record<TopicKind, number>> = { outfit: 3, scene: 2, other: 3 }
const MIN_LIFT: Partial<Record<TopicKind, number>> = { scene: 10, other: 3 }
const KIND_ORDER: TopicKind[] = ['style', 'look', 'outfit', 'scene', 'other']

interface TopicCand {
  tag: string
  kind: TopicKind
  score: number
}

export function artistTopics(related: Related[], meta: TopicMeta, n = 20): string[] {
  const moreSpecific = (a: string, b: string) => (meta.implies[a] ?? []).includes(b) || a.endsWith('_' + b)
  const all: TopicCand[] = related
    .filter(([tag, freq]) => freq >= 0.04 && !isNoise(tag))
    .map(([tag, freq, count]) => ({ tag, freq, lift: freq / (count / meta.totalPosts), kind: topicKind(tag, meta) }))
    .filter((c) => c.lift >= (MIN_LIFT[c.kind] ?? 2))
    .map(({ tag, freq, lift, kind }) => ({ tag, kind, score: freq * Math.log2(lift) }))
    .sort((x, y) => y.score - x.score)
  const drop = new Set<string>()
  for (const x of all)
    for (const y of all)
      if (x !== y && moreSpecific(y.tag, x.tag)) drop.add(y.score >= x.score * 0.3 ? x.tag : y.tag)
  const byKind = new Map<TopicKind, TopicCand[]>(KIND_ORDER.map((k) => [k, []]))
  for (const c of all) if (!drop.has(c.tag)) byKind.get(c.kind)!.push(c)

  const side = (['outfit', 'scene', 'other'] as const).flatMap((k) => byKind.get(k)!.slice(0, SIDE_CAP[k]))
  const style = byKind.get('style')!
  const look = byKind.get('look')!
  const strength = (list: TopicCand[]) => list.slice(0, 10).reduce((sum, c) => sum + c.score, 0)
  const main = Math.max(0, n - side.length)
  const S = strength(style)
  const L = strength(look)
  let qStyle = S + L ? Math.round((main * S) / (S + L)) : 0
  qStyle = Math.max(Math.min(3, style.length), Math.min(qStyle, style.length, main - Math.min(3, look.length)))
  const qLook = Math.min(look.length, main - qStyle)
  qStyle = Math.min(style.length, main - qLook)
  return [...style.slice(0, qStyle), ...look.slice(0, qLook), ...side].map((c) => fromTag(c.tag))
}

const SITES: { label: string; match: RegExp; icon: string }[] = [
  { label: 'pixiv', match: /pixiv\.net\/(en\/)?(users|member\.php)|pixiv\.me\//, icon: 'https://www.pixiv.net/favicon.ico' },
  { label: 'X', match: /\/\/(www\.)?(twitter|x)\.com\/(?!i\/)(?!intent\/)[^/?#]+/, icon: 'https://abs.twimg.com/favicons/twitter.3.ico' },
  { label: 'Bluesky', match: /bsky\.app\/profile\//, icon: 'https://bsky.app/static/favicon-32x32.png' },
  { label: 'FANBOX', match: /\/\/(?!www\.)[\w-]+\.fanbox\.cc/, icon: 'https://www.fanbox.cc/favicon.ico' },
  { label: 'Patreon', match: /patreon\.com\/(?!user\?)[^/?#]+/, icon: 'https://www.patreon.com/favicon.ico' },
  { label: '微博', match: /weibo\.(com|cn)\/(?!n\/)/, icon: 'https://weibo.com/favicon.ico' },
  { label: 'LOFTER', match: /\/\/(?!www\.)[\w-]+\.lofter\.com/, icon: 'https://www.lofter.com/favicon.ico' },
  { label: 'ArtStation', match: /artstation\.com\/(?!artwork)[^/?#]+/, icon: 'https://www.artstation.com/favicon.ico' },
]

export function pickSiteUrls(urls: string[]): string[] {
  const found = new Map<string, string>()
  for (const url of urls) {
    const site = SITES.find((x) => x.match.test(url))
    if (site && !found.has(site.label)) found.set(site.label, url)
  }
  return SITES.filter((x) => found.has(x.label)).map((x) => found.get(x.label)!)
}

export interface ArtistLink {
  label: string
  url: string
  icon: string
}

export function artistLinks(name: string, urls: string[]): ArtistLink[] {
  return [
    { label: 'Danbooru', url: danbooruArtistUrl(name), icon: DANBOORU_ICON },
    ...pickSiteUrls(urls).map((url) => {
      const site = SITES.find((x) => x.match.test(url))!
      return { label: site.label, url, icon: site.icon }
    }),
  ]
}

export const cleanOtherNames = (names: string[]) => [...new Set(names.filter((x) => x && !x.includes('@') && !/^https?:|\.(com|net|jp|cn)\b/i.test(x)))]

export const isNsfwMain = (postCount: number, nsfwCount: number) => postCount > 0 && nsfwCount / postCount >= 0.5
