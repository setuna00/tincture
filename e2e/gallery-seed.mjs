export const DOCS = [
  { tab: 't_rain', title: '雨夜芙莉莲', model: 'v5-full', tags: '1girl, solo, frieren, elf, white hair, long hair, rain, night, umbrella, cityscape', artists: ['wlop', 'ningen mame'] },
  { tab: 't_beach', title: '海边日落', model: 'v5-full', tags: '1girl, solo, beach, sunset, smile, long hair, white dress, outdoors', artists: ['rella'] },
  { tab: 't_cyber', title: '赛博朋克街头', model: 'v45-full', tags: '1girl, solo, cyberpunk, neon lights, night, cityscape, short hair, jacket, Text: Neon Dreams', artists: ['mika pikazo', 'wlop'] },
  { tab: 't_cat', title: '猫耳少女', model: 'v5-curated', tags: '1girl, solo, cat ears, school uniform, smile, indoors, classroom', artists: ['ningen mame'] },
  { tab: 't_forest', title: '森林', model: 'v5-full', tags: 'no humans, forest, tree, fern, sunlight filtering through ancient pine trees, scenery, outdoors', artists: [] },
  { tab: 't_fern', title: '菲伦和芙莉莲', model: 'v5-full', tags: '2girls, frieren, fern (sousou no frieren), elf, purple hair, white hair, rain, outdoors', artists: ['wlop'] },
]
const SIZES = [
  [832, 1216],
  [832, 1216],
  [832, 1216],
  [1216, 832],
  [1024, 1024],
]

export async function seed(page, n, { scale = 1, start = Date.UTC(2026, 9, 30, 6, 0), tab = '' } = {}) {
  return page.evaluate(
    async ({ n, scale, start, tab, DOCS, SIZES, browserOnly }) => {
      const { imageStore, settleWrites } = await window.__peImport('/src/store/storage.ts')
      const { blankDoc } = await import('/src/store/sample.ts')
      const { parsePrompt, toChip } = await import('/src/lib/nai.ts')
      const chips = (text) => parsePrompt(text).map((c, i) => ({ ...toChip(c), id: `c${i}${Math.random()}` }))
      const cache = new Map()
      const draw = async (w, h, hue, label) => {
        const key = `${w}x${h}:${hue}:${scale === 1 ? label : ''}`
        if (cache.has(key)) return cache.get(key)
        const cw = Math.round(w * scale)
        const ch = Math.round(h * scale)
        const c = new OffscreenCanvas(cw, ch)
        const g = c.getContext('2d')
        const grd = g.createLinearGradient(0, 0, cw, ch)
        grd.addColorStop(0, `hsl(${hue} 65% 64%)`)
        grd.addColorStop(1, `hsl(${(hue + 70) % 360} 60% 36%)`)
        g.fillStyle = grd
        g.fillRect(0, 0, cw, ch)
        g.fillStyle = 'rgba(255,255,255,.28)'
        g.beginPath()
        g.arc(cw * 0.5, ch * 0.42, Math.min(cw, ch) * 0.26, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = 'rgba(255,255,255,.9)'
        g.font = `600 ${Math.round(cw / 7)}px sans-serif`
        g.textAlign = 'center'
        g.fillText(scale === 1 ? label : `${hue}`, cw / 2, ch * 0.82)
        const blob = await c.convertToBlob({ type: 'image/webp', quality: 0.8 })
        cache.set(key, blob)
        return blob
      }
      const ids = []
      let i = 0
      let b = 0
      while (i < n) {
        const d = tab ? { ...DOCS[b % DOCS.length], tab } : DOCS[b % DOCS.length]
        const [w, h] = SIZES[(b * 7) % SIZES.length]
        const count = Math.min(n - i, [1, 4, 2, 1, 3, 1, 2][b % 7])
        const doc = blankDoc(d.title)
        doc.settings.model = d.model
        doc.settings.gen.width = w
        doc.settings.gen.height = h
        doc.base.prompt[0].chips = chips([...d.artists.map((a) => `artist:${a}`), d.tags].filter(Boolean).join(', '))
        doc.base.uc[0].chips = chips('lowres, bad anatomy, blurry')
        const batch = `b_${b}`
        const createdAt = start - b * 7 * 60_000
        for (let k = 0; k < count; k++, i++) {
          const id = `img_${String(i).padStart(4, '0')}`
          const hue = ((b * 37 + k * 23) % 12) * 30
          const blob = await draw(w, h, hue, `#${i + 1}`)
          const rec = { id, tabId: d.tab, batch, index: k, createdAt, seed: 1000 + i, width: w, height: h, model: d.model === 'v45-full' ? 'nai-diffusion-4-5-full' : d.model === 'v5-curated' ? 'nai-diffusion-5-curated' : 'nai-diffusion-5-full', mime: blob.type, size: blob.size, doc }
          await imageStore.put(rec, blob)
          ids.push(id)
        }
        b++
      }
      await settleWrites()
      if (!browserOnly) await fetch('/api/test/reopen', { method: 'POST' })
      return ids
    },
    { n, scale, start, tab, DOCS, SIZES, browserOnly: !!process.env.PREVIEW },
  )
}
