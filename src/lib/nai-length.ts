// NovelAI pools base/character tokens by polarity; count quality/transparency and nsfw/UC, but exclude Furry.
import { characterLabel } from '@/lib/character-label'
import { QUALITY_LABEL, UC_LABEL } from '@/components/editor/labels'
import type { Character, Chip, Doc, ModelId, Section, SectionColor } from '@/types'
import { NSFW_TAG, basePrompt, characterPrompt, chipLiteral, exportString, parsePrompt } from './nai'
import { genderLabel, genderTags } from './gender'
import { TRANSPARENT } from './nai-image'
import { MODELS, modelInfo, qualityText, ucText, type Tokenizer } from './nai-models'
import { composePrompt, composeUc, effectiveSettings } from './nai-write'

export const NAI_TOKEN_LIMIT = Object.fromEntries(Object.values(MODELS).map((m) => [m.id, m.tokenLimit])) as Record<ModelId, number>

export interface Insertion {
  at: number
  text: string
  label: string
}

/** Quality tags append and UC presets prepend; align the untouched side first to disambiguate repeated text. */
export function insertion(orig: string, composed: string, align: 'start' | 'end'): { at: number; text: string } | null {
  if (composed === orig || composed.length < orig.length) return null
  const extra = composed.length - orig.length
  const common = (a: number, b: number, dir: 1 | -1, max: number) => {
    let n = 0
    while (n < max && orig[dir === 1 ? a + n : a - n] === composed[dir === 1 ? b + n : b - n]) n++
    return n
  }
  let pre: number
  let suf: number
  if (align === 'start') {
    pre = common(0, 0, 1, orig.length)
    suf = common(orig.length - 1, composed.length - 1, -1, orig.length - pre)
  } else {
    suf = common(orig.length - 1, composed.length - 1, -1, orig.length)
    pre = common(0, 0, 1, orig.length - suf)
  }
  if (pre + suf !== orig.length) return null
  return { at: pre, text: composed.slice(pre, pre + extra) }
}

const qualityLabel = (doc: Doc) => {
  const s = effectiveSettings(doc.settings)
  const parts = [s.transparent ? '透明背景' : '', s.qualityTags === 'none' ? '' : `质量预设 ${QUALITY_LABEL[s.qualityTags]}`].filter(Boolean)
  return parts.join(' + ')
}

export function naiAdditions(doc: Doc): { prompt: Insertion[]; uc: Insertion[] } {
  const s = effectiveSettings(doc.settings)
  const prompt = basePrompt(doc)
  const anime = composePrompt(prompt, { ...s, mode: 'anime' })
  const real = composePrompt(prompt, s)
  const out: { prompt: Insertion[]; uc: Insertion[] } = { prompt: [], uc: [] }
  if (real !== anime && real.endsWith(anime)) out.prompt.push({ at: 0, text: real.slice(0, real.length - anime.length), label: 'Furry 模式' })
  const q = insertion(prompt, anime, 'start')
  if (q) out.prompt.push({ ...q, label: qualityLabel(doc) })
  const uc = exportString(doc.base.uc)
  const u = insertion(uc, composeUc(uc, s, anime), 'end')
  if (u) out.uc.push({ ...u, label: [/^nsfw\b/.test(u.text) ? 'nsfw' : '', s.ucPreset === 'none' ? '' : `UC 预设 ${UC_LABEL[s.ucPreset]}`].filter(Boolean).join(' + ') })
  return out
}

export interface LengthPart {
  id: string
  name: string
  color: SectionColor | null
  gender?: Character['gender']
  nsfw?: boolean
  text: string
}

const nsfwPart = (doc: Doc): LengthPart[] => (doc.settings.nsfw ? [{ id: 'nsfw', name: 'NSFW', color: null, nsfw: true, text: NSFW_TAG }] : [])

function genderPart(c: Character): LengthPart[] {
  const tags = genderTags(c)
  return tags.length ? [{ id: 'gender', name: `性别 ${genderLabel(c)}`, color: null, gender: c.gender, text: tags.join(', ') }] : []
}

export interface LengthBox {
  key: string
  field: 'prompt' | 'uc'
  name: string
  text: string
  parts: LengthPart[]
}

const live = (sections: Section[]) => sections.filter((s) => !s.muted && s.chips.some((c) => !c.disabled && c.text.trim()))

function sectionParts(sections: Section[]): LengthPart[] {
  return live(sections).map((s) => ({ id: s.id, name: s.name, color: s.color, text: exportString([s]) }))
}

export function lengthPlan(doc: Doc): { limit: number; tokenizer: Tokenizer; boxes: LengthBox[] } {
  const s = effectiveSettings(doc.settings)
  const prompt = basePrompt(doc)
  const withQuality = composePrompt(prompt, { ...s, mode: 'anime' })
  const uc = exportString(doc.base.uc)
  const ucFull = composeUc(uc, s, withQuality)
  const nai = (orig: string, full: string, align: 'start' | 'end'): LengthPart[] => {
    const ins = insertion(orig, full, align)
    return ins ? [{ id: 'nai', name: 'NAI 追加', color: null, text: ins.text }] : []
  }
  const boxes: LengthBox[] = [
    { key: 'base.prompt', field: 'prompt', name: '正面', text: withQuality, parts: [...nsfwPart(doc), ...sectionParts(doc.base.prompt), ...nai(prompt, withQuality, 'start')] },
    { key: 'base.uc', field: 'uc', name: '负面', text: ucFull, parts: [...nai(uc, ucFull, 'end'), ...sectionParts(doc.base.uc)] },
  ]
  doc.characters.forEach((c) => {
    if (!c.enabled) return
    const name = characterLabel(doc, c, true)
    boxes.push({ key: `${c.id}.prompt`, field: 'prompt', name, text: characterPrompt(c), parts: [...genderPart(c), ...sectionParts(c.prompt)] })
    boxes.push({ key: `${c.id}.uc`, field: 'uc', name, text: exportString(c.uc), parts: sectionParts(c.uc) })
  })
  const info = modelInfo(doc.settings.model)
  return { limit: info.tokenLimit, tokenizer: info.tokenizer, boxes }
}

/** BPE merges across separators, so per-section counts must be scaled to the whole-box token count. */
export function scaleParts(raw: number[], total: number): number[] {
  const sum = raw.reduce((a, b) => a + b, 0)
  if (!sum) return raw.map(() => 0)
  const exact = raw.map((n) => (n / sum) * total)
  const out = exact.map(Math.floor)
  let left = total - out.reduce((a, b) => a + b, 0)
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (left <= 0) break
    out[i]++
    left--
  }
  return out
}

export const normKey = (literal: string) => literal.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
export const dupKey = (c: Pick<Chip, 'text' | 'type' | 'interaction'>) => normKey(chipLiteral(c))

export const pieceKey = (piece: string) => {
  const p = parsePrompt(piece)[0]
  return p ? dupKey(p) : ''
}

function presetSources(doc: Doc): Map<string, string> {
  const s = effectiveSettings(doc.settings)
  const out = new Map<string, string>()
  const put = (text: string, label: string) => parsePrompt(text).forEach((p) => out.has(dupKey(p)) || out.set(dupKey(p), label))
  out.set('fur dataset', 'Furry 模式')
  out.set(TRANSPARENT, '透明背景')
  out.set('nsfw', 'nsfw（NAI 自动添加）')
  if (s.qualityTags !== 'none') put(qualityText(s.model, s.qualityTags), `质量预设 ${QUALITY_LABEL[s.qualityTags]}`)
  if (s.ucPreset !== 'none') put(ucText(s.model, s.ucPreset), `UC 预设 ${UC_LABEL[s.ucPreset]}`)
  return out
}

export interface DupGroup {
  tag: string
  key: string
  places: string[]
  occ: DupOcc[]
}
export interface DupOcc {
  chipId?: string
  sectionId?: string
  place: string
  tag: string
}

export interface DupIndex {
  chips: Map<string, string[]>
  boxes: Map<string, { groups: DupGroup[]; keys: Set<string> }>
}

const cache = new WeakMap<Doc, DupIndex>()

export function dupIndex(doc: Doc): DupIndex {
  const hit = cache.get(doc)
  if (hit) return hit
  const add = naiAdditions(doc)
  const sources = presetSources(doc)
  const out: DupIndex = { chips: new Map(), boxes: new Map() }
  const scan = (key: string, sections: Section[], extra: Insertion[], fixed: { tag: string; place: string }[] = []) => {
    const occ = new Map<string, DupOcc[]>()
    const push = (k: string, o: DupOcc) => (occ.get(k) ?? occ.set(k, []).get(k)!).push(o)
    for (const s of sections) {
      if (s.muted) continue
      for (const c of s.chips) {
        if (c.disabled || !c.text.trim() || c.type === 'textrender') continue
        push(dupKey(c), { chipId: c.id, sectionId: s.id, place: s.name, tag: chipLiteral(c) })
      }
    }
    for (const ins of extra)
      for (const p of parsePrompt(ins.text)) if (p.type !== 'textrender') push(dupKey(p), { place: sources.get(dupKey(p)) ?? 'NAI 预设', tag: chipLiteral(p) })
    for (const f of fixed) push(normKey(f.tag), { place: f.place, tag: f.tag })
    const groups: DupGroup[] = []
    for (const [k, list] of occ) {
      const mine = list.filter((o) => o.chipId)
      if (list.length < 2 || !mine.length) continue
      groups.push({ tag: mine[0].tag, key: k, places: [...new Set(list.map((o) => o.place))], occ: list })
      for (const o of mine) {
        const others = list.filter((x) => x !== o).map((x) => (x.chipId && x.sectionId === o.sectionId ? '本区块' : x.place))
        out.chips.set(o.chipId!, [...new Set(others)])
      }
    }
    if (groups.length) out.boxes.set(key, { groups, keys: new Set(groups.map((g) => g.key)) })
  }
  scan('base.prompt', doc.base.prompt, add.prompt, doc.settings.nsfw ? [{ tag: NSFW_TAG, place: 'NSFW' }] : [])
  scan('base.uc', doc.base.uc, add.uc)
  for (const c of doc.characters) {
    if (!c.enabled) continue
    scan(`${c.id}.prompt`, c.prompt, [], genderTags(c).map((tag) => ({ tag, place: `性别 ${genderLabel(c)}` })))
    scan(`${c.id}.uc`, c.uc, [])
  }
  cache.set(doc, out)
  return out
}
