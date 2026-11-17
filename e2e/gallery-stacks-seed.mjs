const WLOP = 'artist:wlop, painterly, thick paint'
const SOFT = 'backlighting, soft lighting, lens flare'
const RAIN = '1girl, solo, frieren, elf, white hair, long hair, rain, night, umbrella, cityscape'
const STAND = '1girl, solo, frieren, standing, holding umbrella, street, day, from below, wind'

/** Fixture tuples are [version, image count, positive prompt, extra sections]; preserve this order when adding cases. */
export const STACK_DOCS = [
  {
    tab: 'd_rain',
    title: '雨夜芙莉莲',
    size: [832, 1216],
    hue: 262,
    versions: [
      [1, 4, RAIN],
      [2, 4, `${RAIN}, smile`],
      [3, 3, `${RAIN}, smile, closed eyes`],
      [4, 4, STAND],
      [5, 2, `${STAND}, falling petals`],
      [6, 3, `${STAND}, falling petals, looking back`],
    ],
    tpl: { chips: WLOP, id: 'tpl_wlop' },
  },
  {
    tab: 'd_fern',
    title: '雨夜芙莉莲 · 菲伦版',
    fork: { docId: 'd_rain', version: 4, title: '雨夜芙莉莲' },
    size: [832, 1216],
    hue: 318,
    versions: [
      [1, 4, '2girls, fern, frieren, purple hair, white hair, umbrella, rain, night'],
      [2, 2, '2girls, fern, frieren, purple hair, white hair, umbrella, rain, night, smile'],
    ],
    tpl: { chips: `${WLOP}, artist:ningen mame`, id: 'tpl_wlop', edited: true },
  },
  {
    tab: 'd_beach',
    title: '海边日落',
    size: [1216, 832],
    hue: 22,
    versions: [
      [1, 4, '1girl, solo, beach, sunset, smile, long hair, white dress'],
      [2, 4, '1girl, solo, beach, sunset, smile, long hair, white dress, wind'],
      [3, 4, 'no humans, beach, sunset, scenery, ocean, cloud, horizon'],
    ],
    tpl: { chips: WLOP },
  },
  {
    tab: 'd_cat',
    title: '猫耳少女',
    size: [1024, 1024],
    hue: 140,
    versions: [
      [1, 3, '1girl, solo, cat ears, school uniform, classroom, indoors'],
      [2, 3, '1girl, solo, cat ears, school uniform, classroom, indoors, smile'],
    ],
    tpl: { chips: SOFT, id: 'tpl_soft' },
  },
  {
    tab: 'd_cyber',
    title: '赛博朋克街头',
    size: [832, 1216],
    hue: 200,
    versions: [[1, 4, '1girl, solo, cyberpunk, neon lights, night, cityscape, short hair, jacket']],
  },
]

export async function seedStacks(page) {
  return page.evaluate(
    async ({ DOCS, WLOP, SOFT }) => {
      const { imageStore, settleWrites } = await window.__peImport('/src/store/storage.ts')
      const { blankDoc } = await window.__peImport('/src/store/sample.ts')
      const { parsePrompt, toChip } = await window.__peImport('/src/lib/nai.ts')
      const { useLibrary } = await window.__peImport('/src/store/library.ts')
      const chips = (text) => parsePrompt(text).map((c, i) => ({ ...toChip(c), id: `c${i}${Math.random()}` }))
      const bare = (text) => chips(text).map(({ id: _, ...c }) => c)
      const now = Date.now()
      useLibrary.setState((s) => ({
        sectionTemplates: [
          { id: 'tpl_wlop', name: 'wlop 厚涂', color: 'violet', chips: bare(WLOP), folder: '', createdAt: now },
          { id: 'tpl_soft', name: '柔和逆光', color: 'amber', chips: bare(SOFT), folder: '', createdAt: now },
          ...s.sectionTemplates.filter((t) => t.id !== 'tpl_wlop' && t.id !== 'tpl_soft'),
        ],
      }))
      const draw = async (w, h, hue, label, seed) => {
        const cw = Math.round(w / 4)
        const ch = Math.round(h / 4)
        const c = new OffscreenCanvas(cw, ch)
        const g = c.getContext('2d')
        const grd = g.createLinearGradient(0, 0, cw, ch)
        grd.addColorStop(0, `hsl(${hue} 58% 70%)`)
        grd.addColorStop(1, `hsl(${(hue + 40) % 360} 52% 34%)`)
        g.fillStyle = grd
        g.fillRect(0, 0, cw, ch)
        const r = (k) => (Math.sin(seed * 0.37 * k) + 1) / 2
        g.fillStyle = 'rgba(255,255,255,.32)'
        g.beginPath()
        g.arc(cw * (0.25 + r(3) * 0.5), ch * (0.22 + r(5) * 0.3), Math.min(cw, ch) * (0.12 + r(7) * 0.1), 0, Math.PI * 2)
        g.fill()
        g.fillStyle = 'rgba(20,16,40,.35)'
        g.beginPath()
        g.roundRect(cw * (0.2 + r(11) * 0.45), ch * 0.5, cw * 0.32, ch * 0.62, cw * 0.16)
        g.fill()
        g.fillStyle = 'rgba(255,255,255,.85)'
        g.font = `600 ${Math.round(Math.min(cw, ch) / 9)}px sans-serif`
        g.fillText(label, cw * 0.06, ch - Math.min(cw, ch) * 0.06)
        return c.convertToBlob({ type: 'image/webp', quality: 0.85 })
      }
      const ids = {}
      let t = now - 3 * 86400_000
      let seq = 0
      const put = async ({ key, ...rec }, blob) => {
        await imageStore.put(rec, blob)
        ids[key] = rec.id
      }
      for (const d of [...DOCS].reverse()) {
        for (const [n, count, text] of d.versions) {
          t += 9 * 60_000
          const doc = blankDoc(d.title)
          doc.meta.docId = d.tab
          if (d.fork) doc.meta.forkedFrom = d.fork
          doc.settings.gen.width = d.size[0]
          doc.settings.gen.height = d.size[1]
          doc.base.prompt[0].chips = chips(text)
          if (d.tpl) doc.base.prompt.push({ ...doc.base.prompt[0], id: `s_tpl_${n}`, name: '画风', chips: chips(d.tpl.chips), ...(d.tpl.id ? { templateId: d.tpl.id } : {}), ...(d.tpl.edited ? { templateEdited: true } : {}) })
          doc.base.uc[0].chips = chips('lowres, bad anatomy, blurry')
          const batch = `b_${d.tab}_${n}`
          for (let k = 0; k < count; k++) {
            const id = `img_${String(++seq).padStart(4, '0')}`
            const blob = await draw(d.size[0], d.size[1], d.hue + n * 9, `v${n} #${k + 1}`, seq)
            await put({ key: `${d.tab}:${n}:${k + 1}`, id, tabId: d.tab, batch, index: k, createdAt: t, seed: 1000 + seq, width: d.size[0], height: d.size[1], model: 'nai-diffusion-4-5-full', mime: blob.type, size: blob.size, doc }, blob)
          }
          if (d.tab === 'd_rain' && n === 3) {
            const src = ids['d_rain:3:1']
            const blob = await draw(d.size[0] * 2, d.size[1] * 2, d.hue + n * 9, 'v3 放大', 999)
            await put({ key: 'd_rain:3:up', id: `img_${String(++seq).padStart(4, '0')}`, tabId: d.tab, batch: 'b_up', index: 0, createdAt: now - 3600_000, seed: 1000, width: d.size[0] * 2, height: d.size[1] * 2, model: 'nai-diffusion-4-5-full', label: 'upscale', sourceId: src, mime: blob.type, size: blob.size, doc }, blob)
          }
        }
      }
      for (const [k, text, p] of [
        [1, '1girl, solo, maid, apron, indoors, tea', 'p1'],
        [2, '1girl, solo, maid, apron, indoors, tea', 'p1'],
        [3, 'no humans, landscape, mountain, lake', 'p2'],
      ]) {
        t += 60_000
        const doc = blankDoc(`NAI 下载 ${k}`)
        doc.base.prompt[0].chips = chips(text)
        const blob = await draw(832, 1216, 40 + k * 60, '导入', 500 + k)
        await put({ key: `imported:${p}:${k}`, id: `img_${String(++seq).padStart(4, '0')}`, tabId: 'imported', batch: `b_imp_${k}`, index: 0, createdAt: t, seed: 0, width: 832, height: 1216, model: 'nai-diffusion-4-5-full', mime: blob.type, size: blob.size, doc }, blob)
      }
      await settleWrites()
      await fetch('/api/test/reopen', { method: 'POST' })
      const { useMarks } = await window.__peImport('/src/store/gallery-marks.ts')
      useMarks.setState({
        fav: { [ids['d_rain:4:2']]: true },
        dirs: [
          { id: 'dir_wall', name: '壁纸候选', parent: null, items: { [ids['d_rain:3:up']]: now, [ids['d_beach:1:2']]: now }, createdAt: now },
          { id: 'dir_share', name: '发群里', parent: null, items: { [ids['d_fern:1:1']]: now }, createdAt: now + 1 },
          { id: 'dir_style', name: '风格参考', parent: null, items: { [ids['d_cat:2:1']]: now, [ids['d_cat:1:2']]: now }, createdAt: now + 2 },
        ],
      })
      await settleWrites()
      return { ids }
    },
    { DOCS: STACK_DOCS, WLOP, SOFT },
  )
}
