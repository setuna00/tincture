import { characterLabel } from '@/lib/character-label'
import { QUALITY_LABEL, UC_LABEL } from '@/components/editor/labels'
import { sameValue } from './doc-equal'
import { genderLabel } from './gender'
import { chipLiteral, formatWeight } from './nai'
import { SAMPLER_NAMES } from './nai-image'
import { modelName } from './nai-models'
import { CHARACTER_REF_LABEL, DEFAULT_NOISE, DEFAULT_STRENGTH } from './nai-refs'
import type { Chip, Doc, DocSettings, GenParams, RefImage, Section } from '@/types'

const sectionContent = (s: Section) => ({ muted: s.muted, chips: s.chips.map((c) => ({ text: c.text, type: c.type, weight: c.weight, disabled: c.disabled, interaction: c.interaction })) })

export function versionContent(doc: Doc) {
  const { perModel: _p, gen, ...settings } = doc.settings
  const { seed: _s, nSamples: _n, strength, noise, ...rest } = gen
  const g = settings.baseImage ? { ...rest, strength, noise } : rest
  return {
    base: { prompt: doc.base.prompt.map(sectionContent), uc: doc.base.uc.map(sectionContent) },
    characters: doc.characters.map((c) => ({ gender: c.gender, genderExtra: c.genderExtra, enabled: c.enabled, center: c.center, prompt: c.prompt.map(sectionContent), uc: c.uc.map(sectionContent) })),
    settings: { ...settings, gen: g },
  }
}

export const sameVersion = (a: Doc, b: Doc) => sameValue(versionContent(a), versionContent(b))

const keys = new WeakMap<Doc, string>()
export function versionKey(doc: Doc): string {
  let k = keys.get(doc)
  if (k === undefined) keys.set(doc, (k = stable(versionContent(doc))))
  return k
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const ks = Object.keys(o).filter((k) => o[k] !== undefined).sort()
    return `{${ks.map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

export function groupBatches<T extends { id: string; batch: string; createdAt: number; index: number; doc: Doc }>(images: T[], existing: { n: number; snapshot: Doc }[] = []) {
  const sorted = [...images].sort((a, b) => a.createdAt - b.createdAt || a.batch.localeCompare(b.batch) || a.index - b.index)
  const versions: { n: number; createdAt: number; snapshot: Doc }[] = []
  const of = new Map<string, number>()
  const byKey = new Map(existing.map((v) => [versionKey(v.snapshot), v.n]))
  let max = Math.max(0, ...existing.map((v) => v.n))
  let batch = ''
  let n = 0
  for (const img of sorted) {
    if (img.batch !== batch) {
      batch = img.batch
      const key = versionKey(img.doc)
      const hit = byKey.get(key)
      if (hit) n = hit
      else {
        n = ++max
        byKey.set(key, n)
        versions.push({ n, createdAt: img.createdAt, snapshot: img.doc })
      }
    }
    of.set(img.id, n)
  }
  return { versions, of }
}

export interface ChangePart {
  kind: 'add' | 'del' | 'weight' | 'set'
  text: string
}

export interface ChangeGroup {
  scope: string | null
  parts: ChangePart[]
}

const weighted = (c: Chip) => (c.weight === 1 ? chipLiteral(c) : `${formatWeight(c.weight)}::${chipLiteral(c)}::`)
const keyOf = (c: Chip) => `${c.type}\u0000${chipLiteral(c)}`

function sectionParts(before: Section | undefined, after: Section | undefined, out: ChangePart[]) {
  if (!after) {
    for (const c of before!.chips) if (!c.disabled) out.push({ kind: 'del', text: weighted(c) })
    return
  }
  if (!before) {
    for (const c of after.chips) if (!c.disabled) out.push({ kind: 'add', text: weighted(c) })
    return
  }
  if (before.muted !== after.muted) out.push({ kind: 'set', text: `${after.muted ? '停用' : '启用'}「${after.name}」` })
  const pool = new Map<string, Chip[]>()
  for (const c of before.chips) pool.set(keyOf(c), [...(pool.get(keyOf(c)) ?? []), c])
  const kept: Chip[] = []
  const dels: ChangePart[] = []
  const rest: ChangePart[] = []
  for (const c of after.chips) {
    const cands = pool.get(keyOf(c))
    const b = cands?.shift()
    if (!b) {
      if (!c.disabled) rest.push({ kind: 'add', text: weighted(c) })
      continue
    }
    kept.push(b)
    if (b.disabled !== c.disabled) (c.disabled ? dels : rest).push({ kind: c.disabled ? 'del' : 'add', text: weighted(c) })
    else if (b.weight !== c.weight && !c.disabled) rest.push({ kind: 'weight', text: `${chipLiteral(c)} ${formatWeight(b.weight)} → ${formatWeight(c.weight)}` })
  }
  for (const c of before.chips) if (!c.disabled && !kept.includes(c)) dels.push({ kind: 'del', text: weighted(c) })
  out.push(...dels, ...rest)
  const order = before.chips.filter((c) => kept.includes(c))
  if (order.some((c, i) => c !== kept[i])) out.push({ kind: 'set', text: `「${after.name}」调整顺序` })
}

function boxParts(before: Section[], after: Section[]): ChangePart[] {
  const out: ChangePart[] = []
  const was = new Map(before.map((s) => [s.id, s]))
  const now = new Set(after.map((s) => s.id))
  for (const s of before) if (!now.has(s.id)) sectionParts(s, undefined, out)
  for (const s of after) sectionParts(was.get(s.id), s, out)
  const order = after.filter((s) => was.has(s.id)).map((s) => s.id)
  if (before.filter((s) => now.has(s.id)).some((s, i) => s.id !== order[i])) out.push({ kind: 'set', text: '调整区块顺序' })
  return out
}

const onOff = (v: boolean | undefined) => (v ? '开' : '关')
const fmtCenter = (p: { x: number; y: number }) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`

function settingParts(a: DocSettings, b: DocSettings): ChangePart[] {
  const out: ChangePart[] = []
  const push = (title: string, from: string, to: string) => from !== to && out.push({ kind: 'set', text: `${title} ${from} → ${to}` })
  push('模型', modelName(a.model), modelName(b.model))
  push('Effort', a.effort === 'high' ? 'High' : 'Medium', b.effort === 'high' ? 'High' : 'Medium')
  push('模式', a.mode === 'anime' ? 'Anime' : 'Furry', b.mode === 'anime' ? 'Anime' : 'Furry')
  push('质量', QUALITY_LABEL[a.qualityTags], QUALITY_LABEL[b.qualityTags])
  push('UC 预设', UC_LABEL[a.ucPreset], UC_LABEL[b.ucPreset])
  push('透明背景', onOff(a.transparent), onOff(b.transparent))
  push('NSFW', onOff(a.nsfw), onOff(b.nsfw))
  push('角色位置', a.useCoords ? 'Custom' : "AI's Choice", b.useCoords ? 'Custom' : "AI's Choice")
  const g: GenParams = a.gen
  const h: GenParams = b.gen
  push('尺寸', `${g.width} × ${g.height}`, `${h.width} × ${h.height}`)
  push('步数', String(g.steps), String(h.steps))
  push('引导', String(g.scale), String(h.scale))
  push('Variety+', onOff(g.varietyPlus), onOff(h.varietyPlus))
  push('Rescale', String(g.cfgRescale), String(h.cfgRescale))
  push('采样', SAMPLER_NAMES[g.sampler] ?? g.sampler, SAMPLER_NAMES[h.sampler] ?? h.sampler)
  push('噪声调度', g.noiseSchedule ?? '默认', h.noiseSchedule ?? '默认')
  push('Legacy UC', onOff(g.legacyUc), onOff(h.legacyUc))
  push('平衡强度', onOff(g.normalizeRefs !== false), onOff(h.normalizeRefs !== false))
  if (!a.baseImage && b.baseImage) out.push({ kind: 'set', text: '添加底图' })
  else if (a.baseImage && !b.baseImage) out.push({ kind: 'set', text: '移除底图' })
  else if (a.baseImage && b.baseImage) {
    if (a.baseImage.image !== b.baseImage.image) out.push({ kind: 'set', text: '更换底图' })
    push('底图强度', String(g.strength ?? DEFAULT_STRENGTH), String(h.strength ?? DEFAULT_STRENGTH))
    push('底图噪声', String(g.noise ?? DEFAULT_NOISE), String(h.noise ?? DEFAULT_NOISE))
  }
  refListParts('Vibe Transfer', a.vibes ?? [], b.vibes ?? [], out, (x, y) => [
    ['信息量', String(x.informationExtracted), String(y.informationExtracted)],
    ['强度', String(x.strength), String(y.strength)],
  ])
  refListParts('精准参考', a.characterRefs ?? [], b.characterRefs ?? [], out, (x, y) => [
    ['类型', CHARACTER_REF_LABEL[x.description], CHARACTER_REF_LABEL[y.description]],
    ['强度', String(x.strength), String(y.strength)],
    ['Fidelity', String(x.fidelity), String(y.fidelity)],
  ])
  return out
}

function refListParts<T extends RefImage & { enabled: boolean }>(name: string, before: T[], after: T[], out: ChangePart[], fields: (x: T, y: T) => [string, string, string][]) {
  const pool = new Map<string, T[]>()
  for (const x of before) pool.set(x.image, [...(pool.get(x.image) ?? []), x])
  const kept = new Set<T>()
  let added = 0
  const own: ChangePart[] = []
  after.forEach((y, i) => {
    const x = pool.get(y.image)?.shift()
    if (!x) return void added++
    kept.add(x)
    const at = after.length > 1 ? `${name} 第 ${i + 1} 张` : name
    if (x.enabled !== y.enabled) own.push({ kind: 'set', text: `${y.enabled ? '启用' : '停用'} ${at}` })
    for (const [k, from, to] of fields(x, y)) if (from !== to) own.push({ kind: 'set', text: `${at} ${k} ${from} → ${to}` })
  })
  const removed = before.filter((x) => !kept.has(x)).length
  if (added) out.push({ kind: 'set', text: `添加 ${name}${added > 1 ? ` ×${added}` : ''}` })
  if (removed) out.push({ kind: 'set', text: `移除 ${name}${removed > 1 ? ` ×${removed}` : ''}` })
  out.push(...own)
}

export function versionChanges(prev: Doc, next: Doc): ChangeGroup[] {
  const groups: ChangeGroup[] = []
  const add = (scope: string | null, parts: ChangePart[]) => parts.length && groups.push({ scope, parts })
  add(null, boxParts(prev.base.prompt, next.base.prompt))
  add('负面', boxParts(prev.base.uc, next.base.uc))
  const was = new Map(prev.characters.map((c) => [c.id, c]))
  const now = new Set(next.characters.map((c) => c.id))
  const roster: ChangePart[] = []
  for (const c of prev.characters) if (!now.has(c.id)) roster.push({ kind: 'set', text: `删除角色「${characterLabel(prev, c)}」` })
  for (const c of next.characters) {
    const b = was.get(c.id)
    const name = characterLabel(next, c)
    if (!b) {
      roster.push({ kind: 'set', text: `添加角色「${name}」` })
      continue
    }
    const own: ChangePart[] = []
    if (b.enabled !== c.enabled) own.push({ kind: 'set', text: c.enabled ? '启用' : '停用' })
    if (genderLabel(b) !== genderLabel(c)) own.push({ kind: 'set', text: `性别 ${genderLabel(b)} → ${genderLabel(c)}` })
    if (b.center.x !== c.center.x || b.center.y !== c.center.y) own.push({ kind: 'set', text: `位置 ${fmtCenter(b.center)} → ${fmtCenter(c.center)}` })
    add(name, [...own, ...boxParts(b.prompt, c.prompt)])
    add(`${name} 负面`, boxParts(b.uc, c.uc))
  }
  const order = next.characters.filter((c) => was.has(c.id)).map((c) => c.id)
  if (prev.characters.filter((c) => now.has(c.id)).some((c, i) => c.id !== order[i])) roster.push({ kind: 'set', text: '调整角色顺序' })
  add(null, roster)
  add(null, settingParts(prev.settings, next.settings))
  return groups
}

export const changesText = (groups: ChangeGroup[]) =>
  groups.map((g) => `${g.scope ? `${g.scope}：` : ''}${g.parts.map((p) => (p.kind === 'add' ? `+${p.text}` : p.kind === 'del' ? `-${p.text}` : p.text)).join(' ')}`).join(' · ')
