import { describe, expect, it } from 'vitest'
import { allSections, createDocStore, normalizeDoc } from '@/store/doc'
import { sampleDoc } from '@/store/sample'
import type { Doc, Section } from '@/types'
import {
  AI_ANALYSIS_ASK,
  AI_DOC_SCHEMA,
  AI_DOC_SCHEMA_ID,
  aiAgentText,
  aiAskMessages,
  aiFileName,
  aiPromptFile,
  aiPromptText,
  aiRetryAsk,
  aiRules,
  applyPlan,
  autoTagsRule,
  diagnoseReply,
  findAiJson,
  markedChips,
  pickedSummary,
  planReply,
  planTitle,
  randomSectionsText,
  toAiDoc,
  type AiChange,
} from './ai-doc'
import { parseTagItem, toChip } from './nai'
import { defaultRule, newRandomSection } from './random-block'
import { sectionText } from './section-text'

const doc = () => sampleDoc()
const sec = (d: Doc, name: string, nth = 0): Section => {
  const all = [...d.base.prompt, ...d.base.uc, ...d.characters.flatMap((c) => [...c.prompt, ...c.uc])].filter((s) => s.name === name)
  return all[nth]
}
const texts = (s: Section) => s.chips.map((c) => `${c.disabled ? '!' : ''}${c.weight === 1 ? '' : `${c.weight}:`}${c.text}`)
const reply = (o: object) => ({ $schema: AI_DOC_SCHEMA_ID, ...o })
const allOn = (p: ReturnType<typeof planReply>) => new Set(p.changes.filter((c) => c.defaultOn).map((c) => c.key))
const only = <K extends AiChange['kind']>(p: ReturnType<typeof planReply>, kind: K) => p.changes.filter((c): c is Extract<AiChange, { kind: K }> => c.kind === kind)

describe('发出去', () => {
  it('整份文档：区块是 tags 数组（一项一个 chip，权重写在项里），禁用的单独列，停用 / 备注 / 角色 / 设置 / 区块颜色都在；模板关联不发', () => {
    const d = doc()
    const a = toAiDoc(d)
    expect(a.$schema).toBe('pe-doc-ai/2')
    const scene = sec(d, '场景')
    const s = a.prompt!.find((x) => x.id === scene.id)!
    expect(s.tags).toEqual(['outdoors', '1.2::cherry blossoms::', '1.2::petals::', 'blue sky', 'day', 'depth of field', '0.8::light particles::'])
    expect(s).not.toHaveProperty('text')
    expect(s.disabled).toEqual(['cloud'])
    expect(s.enabled).toBe(true)
    expect(s.color).toBe('teal')
    expect(JSON.stringify(a)).not.toMatch(/ownColor|templateId|templateEdited|"work"/)
    expect(a.characters!.map((c) => c.name)).toEqual(d.characters.map((c) => c.name))
    expect(a.characters![0]).toMatchObject({ gender: 'female', center: { x: 0.5, y: 0.5 } })
    expect(a.settings).toMatchObject({ width: 832, height: 1216, sampler: 'k_euler_ancestral', seed: null, model: 'v5-full' })
  })
  it('复制的文字 = 规则 + Schema + 文档；下载的 .json 同一份内容', () => {
    const d = doc()
    const t = aiPromptText(d)
    expect(t).toContain('Partial edit (the default): write only the sections, characters and settings you change')
    expect(t).toContain('tags and disabled, when written, are the full list after the edit')
    expect(t).toContain("New ones get no id (don't make one up)")
    expect(t).toContain('- Example of the format')
    expect(t).toContain(`## JSON Schema\n\`\`\`json\n${JSON.stringify(AI_DOC_SCHEMA)}\n\`\`\``)
    expect(t).toContain(`"$id":"${AI_DOC_SCHEMA_ID}"`)
    expect(t.trimEnd().endsWith('## Request')).toBe(true)
    const f = JSON.parse(aiPromptFile(d))
    expect(Object.keys(f)).toEqual(['instructions', 'schema', 'document'])
    expect(f.document).toEqual(toAiDoc(d))
    expect(f.schema).toEqual(JSON.parse(JSON.stringify(AI_DOC_SCHEMA)))
    expect(aiFileName('樱花 / 下的:师徒')).toBe('樱花 下的 师徒.json')
    expect(aiFileName('  ')).toBe('未命名.json')
  })
  it('规则 Structure：一个角色的进角色框、全图的放正面；NovelAI 自动加的按这份文档的设置写', () => {
    const d = doc()
    const t = aiPromptText(d)
    expect(t).toContain('Tags for one character (identity, looks, clothing, expression, actions) go in that character')
    expect(t).toContain('prompt end: very aesthetic, masterpiece, no text (qualityTags standard); uc start: lowres, artistic error,')
    expect(t).toContain('blank page (ucPreset heavy).\n\nReply\n')
    expect(JSON.parse(aiPromptFile(d)).instructions).toContain('Added automatically at generation')
    const s = d.settings
    const none = { ...d, settings: { ...s, qualityTags: 'none', ucPreset: 'none', mode: 'anime', transparent: false } } as Doc
    expect(autoTagsRule(none)).toBe('')
    expect(aiPromptText(none)).toContain("don't write them.\n\nReply\n")
    const furry = { ...d, settings: { ...s, qualityTags: 'light', ucPreset: 'none', mode: 'furry', transparent: true } } as Doc
    expect(autoTagsRule(furry)).toContain('prompt start: fur dataset (mode furry); prompt end: transparent background, very aesthetic, amazing quality, no text (transparent true, qualityTags light).')
    const medium = { ...d, settings: { ...s, model: 'v5-full', effort: 'medium', ucPreset: 'none' } } as Doc
    expect(autoTagsRule(medium)).toContain('(ucPreset heavy)')
  })
  it('complete: true = 完整文档：写了的框里没提到的区块 / 角色列成删除（默认勾）；整个框没写的不动；不写 complete 照旧只加不删', () => {
    const d = doc()
    const full = JSON.parse(JSON.stringify(toAiDoc(d)))
    expect(planReply(d, { ...full, complete: true }).changes).toEqual([])
    const others = full.characters.filter((c: { name: string }) => c.name !== '菲伦')
    const r = reply({ complete: true, prompt: [full.prompt[0], { name: '背景', text: 'rooftop, ' }], characters: others })
    const p = planReply(d, r)
    expect(only(p, 'deleteSection').map((c) => c.section.name)).toEqual(['场景', '画师', '质量'])
    expect(only(p, 'deleteChar').map((c) => c.character.name)).toEqual(['菲伦'])
    expect(only(p, 'newSection').map((c) => c.section.name)).toEqual(['背景'])
    expect(p.changes.every((c) => c.defaultOn)).toBe(true)
    const after = applyPlan(d, p, allOn(p))
    expect(after.base.prompt.map((s) => s.name)).toEqual(['主体', '背景'])
    expect(after.characters.map((c) => c.name)).toEqual(['芙莉莲', '修塔尔克'])
    expect(after.base.uc.map((s) => s.name)).toEqual(d.base.uc.map((s) => s.name))
    const q = planReply(d, { ...r, complete: undefined })
    expect(only(q, 'deleteSection')).toEqual([])
    expect(only(q, 'deleteChar')).toEqual([])
    const fern = full.characters.find((c: { name: string }) => c.name === '菲伦')
    expect(only(planReply(d, reply({ complete: true, characters: [...others, { ...fern, uc: [] }] })), 'deleteSection').map((c) => c.title)).toEqual(['菲伦 › 防串色'])
    const { uc: _uc, ...fernNoUc } = fern
    expect(only(planReply(d, reply({ complete: true, characters: [...others, fernNoUc] })), 'deleteSection')).toEqual([])
  })
  it('原样导回 = 0 处改动（复制的那一整段粘回来也是）', () => {
    const d = doc()
    expect(planReply(d, toAiDoc(d) as never).changes).toEqual([])
    const back = findAiJson(aiPromptText(d))!
    expect(back.title).toBe(d.meta.title)
    const p = planReply(d, back)
    expect(p.changes).toEqual([])
    expect(planTitle(p)).toBe('AI 未修改任何内容')
  })
})

describe('认 AI 的回答', () => {
  it('前后有说明文字、包着 ```json 都认；只认 pe-doc-ai/2（和 /1）', () => {
    const body = JSON.stringify(reply({ settings: { steps: 28 } }), null, 2)
    expect(findAiJson(`好的，我改了步数：\n\n\`\`\`json\n${body}\n\`\`\`\n\n希望有帮助。`)).toMatchObject({ settings: { steps: 28 } })
    expect(findAiJson(`改好了 ${body} 就这样`)).toMatchObject({ settings: { steps: 28 } })
    expect(findAiJson('{"$schema": "pe-gacha/1", "name": "x", "pools": []}')).toBeNull()
    expect(findAiJson('1girl, smile, {blue sky}')).toBeNull()
    expect(findAiJson(`{"a": 1} 然后 ${body}`)).toMatchObject({ settings: { steps: 28 } })
    expect(findAiJson(`{"$schema": "${AI_DOC_SCHEMA_ID}", "prompt": [{"name": "a}b{", "text": "x, "}]}`)).toMatchObject({ prompt: [{ name: 'a}b{' }] })
  })
  it('带 // 注释、尾逗号的也读得回来（字符串里的 // 不动）；diagnoseReply 也照这样读', () => {
    const loose = `改好了：
\`\`\`json
{
  "$schema": "${AI_DOC_SCHEMA_ID}", // 格式
  "prompt": [
    {"id": "s_aaaaaaaaaa", "tags": ["outdoors", "http://x.y",]}, /* 改了这个 */
  ],
}
\`\`\``
    expect(findAiJson(loose)).toEqual({ $schema: AI_DOC_SCHEMA_ID, prompt: [{ id: 's_aaaaaaaaaa', tags: ['outdoors', 'http://x.y'] }] })
    expect(findAiJson(`前面 {"$schema": "${AI_DOC_SCHEMA_ID}", "settings": {"steps": 28,},} 后面`)).toMatchObject({ settings: { steps: 28 } })
    expect(diagnoseReply('```json\n{"prompt": [], // 漏了 schema\n}\n```')).toMatchObject({ kind: 'format', zh: '缺少 "$schema": "pe-doc-ai/2"' })
  })
})

describe('改动清单', () => {
  it('改区块：加 / 去掉 / 改权重，没写的区块不动；总结和行头的数', () => {
    const d = doc()
    const scene = sec(d, '场景')
    const p = planReply(d, reply({ prompt: [{ id: scene.id, text: 'outdoors, 1.3::cherry blossoms::, 1.2::petals::, depth of field, 0.8::light particles::, sunset, orange sky, ' }] }))
    expect(p.changes).toHaveLength(1)
    const [c] = only(p, 'section')
    expect(c.group).toBe('prompt')
    expect(c.title).toBe('场景')
    expect(c.diff.added.map((x) => x.text)).toEqual(['sunset', 'orange sky'])
    expect(c.diff.removed.map((x) => x.text)).toEqual(['blue sky', 'day'])
    expect(c.diff.reweighted.map((r) => [r.chip.text, r.from, r.chip.weight])).toEqual([['cherry blossoms', 1.2, 1.3]])
    expect(c.counts).toBe('添加 2 · 移除 2 · 调整权重 1')
    expect(c.line).toBe('场景：添加 sunset、orange sky，移除 blue sky、day，cherry blossoms 1.2 → 1.3')
    expect(texts(c.after)).toContain('!cloud')
    expect(c.after.chips.find((x) => x.text === 'outdoors')!.id).toBe(scene.chips.find((x) => x.text === 'outdoors')!.id)
    expect([...markedChips(c.diff)].map((id) => c.after.chips.find((x) => x.id === id)!.text)).toEqual(['sunset', 'orange sky', 'cherry blossoms'])
  })
  it('关掉 / 打开 tag：在 text 和 disabled 之间挪', () => {
    const d = doc()
    const scene = sec(d, '场景')
    const t = sectionText(scene.chips).replace('blue sky, ', '')
    const p = planReply(d, reply({ prompt: [{ id: scene.id, text: `${t}cloud, `, disabled: ['blue sky'] }] }))
    const [c] = only(p, 'section')
    expect(c.diff.disabled.map((x) => x.text)).toEqual(['blue sky'])
    expect(c.diff.enabled.map((x) => x.text)).toEqual(['cloud'])
    expect(c.diff.added).toEqual([])
    expect(c.diff.removed).toEqual([])
    expect(c.counts).toBe('禁用 1 · 启用 1')
    expect(texts(c.after)).toEqual(['outdoors', '1.2:cherry blossoms', '1.2:petals', '!blue sky', 'day', 'depth of field', '0.8:light particles', 'cloud'])
    expect(c.after.chips[3].id).toBe(scene.chips.find((x) => x.text === 'blue sky')!.id)
  })
  it('改名、停用、只换顺序也算；和原来一样的不列', () => {
    const d = doc()
    const scene = sec(d, '场景')
    const quality = sec(d, '质量')
    const p = planReply(d, reply({
      prompt: [
        { id: scene.id, name: '背景和天气', enabled: false },
        { id: quality.id, text: [...quality.chips].reverse().map((c) => c.text).join(', ') },
        { id: sec(d, '主体').id, text: sectionText(sec(d, '主体').chips) },
      ],
    }))
    const cs = only(p, 'section')
    expect(cs).toHaveLength(2)
    expect(cs[0].line).toBe('场景：重命名「场景」→「背景和天气」，停用此区块')
    expect(cs[0].after.chips).toBe(scene.chips)
    expect(cs[1].counts).toBe('调整顺序')
  })
  it('新区块放在 after 后面；没有 id 的默认勾，回答里的 id 一个都没对上（像贴错 tab）默认不勾', () => {
    const d = doc()
    const scene = sec(d, '场景')
    const p = planReply(d, reply({
      prompt: [
        { name: '背景', after: scene.id, text: 'rooftop, cityscape, railing' },
        { name: '空的', text: '' },
      ],
    }))
    const ns = only(p, 'newSection')
    expect(ns.map((c) => [c.title, c.defaultOn, c.afterName])).toEqual([['背景', true, '场景']])
    expect(ns[0].line).toBe('新区块「背景」：rooftop、cityscape、railing')
    const next = applyPlan(d, p, allOn(p))
    const names = next.base.prompt.map((s) => s.name)
    expect(names.indexOf('背景')).toBe(names.indexOf('场景') + 1)
    expect(names).not.toContain('空的')
    expect(next.base.prompt.find((s) => s.name === '背景')!.color).toBe('slate')
  })
  it('像是贴错了 tab（写了的 id 一个都没对上）：新区块、新角色、删除、设置全都默认不勾，应用后什么都没改', () => {
    const d = doc()
    const all = toAiDoc(d)
    let i = 0
    const other = <T extends object>(s: T) => ({ ...s, id: `s_wrongtab${String(i++).padStart(2, '0')}` })
    const p = planReply(d, reply({
      ...all,
      complete: true,
      prompt: [...all.prompt!.map(other), { name: '背景', text: 'rooftop' }],
      uc: all.uc!.map(other),
      characters: all.characters!.map((c, k) => ({ ...c, id: `ch_wrongtab0${k}` })),
      settings: { ...all.settings, width: 1216, height: 832 },
    }))
    expect(new Set(p.changes.map((c) => c.kind))).toEqual(new Set(['newSection', 'newChar', 'deleteSection', 'deleteChar', 'setting']))
    expect(allOn(p).size).toBe(0)
    expect(applyPlan(d, p, allOn(p))).toEqual(d)
  })
  it('新区块 / 新角色编的 id（s_background、ch_alice，不像我们的）不算写了 id：照样默认勾', () => {
    const d = doc()
    const p = planReply(d, reply({
      prompt: [{ id: 's_background', name: '背景', tags: ['rooftop'] }],
      characters: [{ id: 'ch_alice', name: '爱丽丝', gender: 'female', prompt: [{ id: 's_alice_look', name: '外观', tags: ['blonde hair'] }] }],
    }))
    expect(p.changes.map((c) => [c.kind, c.defaultOn])).toEqual([['newSection', true], ['newChar', true]])
    expect(allOn(planReply(d, reply({ prompt: [{ id: 's_Xk3pQ9zLm2', name: '背景', tags: ['rooftop'] }] }))).size).toBe(0)
  })
  it('删区块；角色的区块写到正面里也按 id 对上', () => {
    const d = doc()
    const style = sec(d, '风格排除')
    const look = d.characters[0].prompt[0]
    const p = planReply(d, reply({ uc: [{ id: style.id, delete: true }], prompt: [{ id: look.id, text: `${sectionText(look.chips)}blush, ` }] }))
    expect(only(p, 'deleteSection').map((c) => [c.group, c.line])).toEqual([['uc', '删除区块「风格排除」']])
    const [c] = only(p, 'section')
    expect(c.group).toBe('char')
    expect(c.title).toBe('芙莉莲 › 外观')
    const next = applyPlan(d, p, allOn(p))
    expect(next.base.uc.map((s) => s.name)).not.toContain('风格排除')
    expect(next.characters[0].prompt[0].chips.map((x) => x.text)).toContain('blush')
  })
  it('角色：改性别 / 位置 / 停用；新角色；删角色（它下面的区块改动不再列）', () => {
    const d = doc()
    const [a, b] = d.characters
    const p = planReply(d, reply({
      characters: [
        { id: a.id, gender: 'male', center: { x: 0.3, y: 0.5 }, enabled: false },
        { id: b.id, delete: true, prompt: [{ id: b.prompt[0].id, text: 'x' }] },
        { name: '辛美尔', gender: 'male', prompt: [{ name: '外观', text: 'himmel, blue hair' }] },
        { id: 'ch_nope', name: '幽灵', prompt: [{ name: '外观', text: 'ghost' }] },
      ],
    }))
    expect(only(p, 'char').map((c) => c.line)).toEqual(['芙莉莲：性别 女 → 男，停用，位置 (0.50, 0.50) → (0.30, 0.50)'])
    expect(only(p, 'deleteChar').map((c) => c.line)).toEqual(['删除角色「菲伦」'])
    expect(only(p, 'section')).toEqual([])
    const nc = only(p, 'newChar')
    expect(nc.map((c) => [c.line, c.defaultOn])).toEqual([['新角色「辛美尔」（男）：1 个区块', true], ['新角色「幽灵」（其他）：1 个区块', true]])
    const next = applyPlan(d, p, allOn(p))
    expect(next.characters.map((c) => c.name)).toEqual(['芙莉莲', '修塔尔克', '辛美尔', '幽灵'])
    expect(next.characters[0]).toMatchObject({ gender: 'male', enabled: false, center: { x: 0.3, y: 0.5 } })
    expect(next.characters[2].prompt[0].chips.map((x) => x.text)).toEqual(['himmel', 'blue hair'])
    expect(pickedSummary(p, allOn(p))).toBe('4 个角色')
  })
  it('AI 抄错 id：同一个框里差 1–2 个字符的认成原区块（complete 也不再列删除）；after 抄错也认', () => {
    const d = doc()
    const [p0, p1] = d.base.prompt
    const [u0] = d.base.uc
    const look = d.characters[0].prompt[0]
    const typo = (id: string) => id.slice(0, -1) + (id.endsWith('x') ? 'y' : 'x')
    const all = toAiDoc(d)
    const p = planReply(d, reply({
      ...all,
      complete: true,
      prompt: [
        { ...all.prompt![0], id: typo(p0.id), name: '人数构图', tags: [...all.prompt![0].tags!, 'upper body'] },
        { name: '光照', after: p1.id.slice(0, 4) + p1.id.slice(5), tags: ['rim lighting'] },
        ...all.prompt!.slice(1),
      ],
      uc: [{ ...all.uc![0], id: u0.id.slice(0, 3) + 'zz' + u0.id.slice(3), tags: [...all.uc![0].tags!, '3d'] }, ...all.uc!.slice(1)],
      characters: all.characters!.map((c, i) => (i ? c : { ...c, prompt: [{ ...c.prompt![0], id: typo(look.id), tags: [...c.prompt![0].tags!, 'blush'] }, ...c.prompt!.slice(1)] })),
    }))
    expect(only(p, 'deleteSection')).toEqual([])
    expect(only(p, 'section').map((c) => [c.title, c.defaultOn])).toEqual([[p0.name, true], [u0.name, true], [`芙莉莲 › ${look.name}`, true]])
    expect(only(p, 'section')[0].line).toContain(`重命名「${p0.name}」→「人数构图」`)
    expect(only(p, 'newSection').map((c) => [c.title, c.afterName])).toEqual([['光照', p1.name]])
    const next = applyPlan(d, p, allOn(p))
    expect(next.base.prompt[0]).toMatchObject({ id: p0.id, name: '人数构图' })
    expect(next.base.uc[0].chips.map((x) => x.text)).toContain('3d')
  })
  it('AI 抄错 id：差 3 个字符、或和两个区块一样近的不认，当新区块', () => {
    const d = doc()
    const [a, b] = d.base.prompt
    a.id = 's_aaaaaaaaaa'
    b.id = 's_aaaaaaaabb'
    const p = planReply(d, reply({
      prompt: [
        { id: a.id, text: `${sectionText(a.chips)}smile, ` },
        { id: 's_aaaaaaaaab', name: '一样近', text: 'x' },
        { id: 's_aaaaaaazzz', name: '差三个', text: 'y' },
      ],
    }))
    expect(only(p, 'section').map((c) => c.title)).toEqual([a.name])
    expect(only(p, 'newSection').map((c) => [c.title, c.defaultOn])).toEqual([['一样近', true], ['差三个', true]])
  })
  it('设置：合法的列出来，不在选项里的进「没改」', () => {
    const d = doc()
    const p = planReply(d, reply({ settings: { width: 1216, height: 832, scale: 12, sampler: 'k_lms', steps: 28.5, ucPreset: 'light', model: 'v5-full', seed: 42 } }))
    expect(only(p, 'setting').map((c) => c.line)).toEqual(['UC 预设：Heavy → Light', '尺寸：832 × 1216 → 1216 × 832', 'Seed：随机 → 42'])
    expect(p.skipped).toEqual(['步数 28.5 超出 NAI 的范围（1–50），未修改', '引导 12 超出 NAI 的范围（0–10），未修改', '采样「k_lms」不是 NAI V5 的可选值，未修改'])
    expect(planReply(d, reply({ settings: { width: 1000, height: 1500 } })).skipped[0]).toMatch(/^尺寸 1000 × 1500 不符合 NAI 要求/)
    const next = applyPlan(d, p, allOn(p))
    expect(next.settings).toMatchObject({ ucPreset: 'light', gen: { width: 1216, height: 832, seed: 42, scale: 7, steps: 23 } })
  })
  it('NSFW 开关：「显示 NSFW 内容」开着时发给 AI、AI 能改；关着时不发，AI 改了进「没改」', () => {
    const d = doc()
    const on = { nsfw: true }
    expect(toAiDoc(d).settings).not.toHaveProperty('nsfw')
    expect(toAiDoc(d, on).settings).toMatchObject({ nsfw: false })
    expect(toAiDoc({ ...d, settings: { ...d.settings, nsfw: true } }, on).settings).toMatchObject({ nsfw: true })
    expect(Object.keys(AI_DOC_SCHEMA.properties.settings.properties)).toContain('nsfw')
    expect(planReply(d, toAiDoc(d, on) as never, on).changes).toEqual([])
    const p = planReply(d, reply({ settings: { nsfw: true } }), on)
    expect(only(p, 'setting').map((c) => c.line)).toEqual(['NSFW：关 → 开'])
    expect(applyPlan(d, p, allOn(p)).settings.nsfw).toBe(true)
    const old = { ...d, settings: { ...d.settings, nsfw: undefined } }
    expect(planReply(old, reply({ settings: { nsfw: false } }), on).changes).toEqual([])
    const off = planReply(d, reply({ settings: { nsfw: true } }))
    expect(off.changes).toEqual([])
    expect(off.skipped).toEqual(['NSFW 关 → 开：设置中未开启「显示 NSFW 内容」，未修改'])
    expect(planReply(d, reply({ settings: { nsfw: 'yes' } }), on).skipped).toEqual(['NSFW「yes」不是可选值，未修改'])
  })
  it('NSFW 开关写进「自动加的 tag」：开着 = 正面开头 nsfw；能改又没开 = 负面开头写上 NAI 会加的 nsfw', () => {
    const d = doc()
    expect(autoTagsRule(d)).toContain('uc start: lowres, artistic error,')
    expect(autoTagsRule(d)).not.toContain('nsfw')
    expect(autoTagsRule(d, { nsfw: true })).toContain('uc start: nsfw, lowres, artistic error,')
    expect(autoTagsRule(d, { nsfw: true })).toContain('; NovelAI adds nsfw while the prompt has none, not when settings.nsfw is true)')
    const nsfwOn = { ...d, settings: { ...d.settings, nsfw: true } } as Doc
    expect(autoTagsRule(nsfwOn, { nsfw: true })).toContain('prompt start: nsfw (nsfw true)')
    expect(autoTagsRule(nsfwOn, { nsfw: true })).toContain('uc start: lowres, artistic error,')
    const furry = { ...nsfwOn, settings: { ...nsfwOn.settings, mode: 'furry' } } as Doc
    expect(autoTagsRule(furry, { nsfw: true })).toContain('prompt start: fur dataset, nsfw (mode furry, nsfw true)')
    const curated = { ...d, settings: { ...d.settings, model: 'v5-curated' } } as Doc
    expect(autoTagsRule(curated, { nsfw: true })).not.toContain('nsfw')
  })
  it('只应用勾了的；一步撤销；从模板来的区块记下「改过」', () => {
    const d = doc()
    const scene = sec(d, '场景')
    const store = createDocStore(structuredClone({ ...d, base: { ...d.base, prompt: d.base.prompt.map((s) => (s.id === scene.id ? { ...s, templateId: 'tpl' } : s)) } }))
    const cur = store.getState().doc
    const p = planReply(cur, reply({ prompt: [{ id: scene.id, text: 'outdoors, ' }], settings: { steps: 28 } }))
    const keys = p.changes.map((c) => c.key)
    expect(pickedSummary(p, new Set([keys[0]]))).toBe('正面 1 个区块')
    store.getState().applyDoc(applyPlan(cur, p, new Set([keys[0]])))
    const now = store.getState().doc
    expect(sec(now, '场景').chips.map((c) => c.text)).toEqual(['outdoors', 'cloud'])
    expect(sec(now, '场景').templateEdited).toBe(true)
    expect(now.settings.gen.steps).toBe(23)
    store.temporal.getState().undo()
    expect(store.getState().doc).toBe(cur)
  })
})

describe('区块颜色', () => {
  it('Schema 列出 12 种颜色（区块的 Schema 只写一份，四个框引用它）；规则里写了 color', () => {
    expect(AI_DOC_SCHEMA.$defs.section.properties.color.enum).toHaveLength(12)
    const ref = { type: 'array', items: { $ref: '#/$defs/section' } }
    expect([AI_DOC_SCHEMA.properties.prompt, AI_DOC_SCHEMA.properties.uc, AI_DOC_SCHEMA.properties.characters.items.properties.prompt]).toEqual([ref, ref, ref])
    expect(aiPromptText(doc())).toContain('a new section takes name, color, tags, after')
  })
  it('新区块照 AI 写的颜色；没写 / 写错的是灰色', () => {
    const d = doc()
    const p = planReply(d, reply({ prompt: [{ name: '背景', color: 'sky', text: 'rooftop' }, { name: '光', color: 'blue', text: 'rim lighting' }, { name: '天气', text: 'rain' }] }))
    expect(only(p, 'newSection').map((c) => c.section.color)).toEqual(['sky', 'slate', 'slate'])
    const next = applyPlan(d, p, allOn(p))
    expect(next.base.prompt.find((s) => s.name === '背景')!.color).toBe('sky')
  })
  it('改已有区块的颜色：列成「颜色 青 → 红」，应用后换掉；只写了 color 也算', () => {
    const d = doc()
    const scene = sec(d, '场景')
    const p = planReply(d, reply({ prompt: [{ id: scene.id, color: 'rose' }] }))
    const [c] = only(p, 'section')
    expect(c.line).toBe('场景：颜色 青 → 红')
    expect(c.counts).toBe('颜色 青 → 红')
    expect(markedChips(c.diff).size).toBe(0)
    expect(sec(applyPlan(d, p, allOn(p)), '场景').color).toBe('rose')
    expect(planReply(d, reply({ prompt: [{ id: scene.id, color: 'teal' }] })).changes).toEqual([])
  })
  it('角色里的区块：换成别的颜色 = 自己选的；换回角色的颜色 = 跟着角色走；新区块没写颜色跟角色', () => {
    const store = createDocStore(doc())
    const ch = store.getState().doc.characters[0]
    const look = ch.prompt[0]
    expect(look.color).toBe(ch.color)
    const step = (o: object) => {
      const d = store.getState().doc
      const p = planReply(d, reply(o))
      store.getState().applyDoc(applyPlan(d, p, allOn(p)))
      return store.getState().doc.characters[0]
    }
    let now = step({ characters: [{ id: ch.id, prompt: [{ id: look.id, color: 'pink' }, { name: '表情', text: 'smile' }, { name: '衣服', color: 'sky', text: 'dress' }] }] })
    expect(now.prompt.map((s) => [s.name, s.color, !!s.ownColor])).toEqual([['外观', 'pink', true], ['表情', ch.color, false], ['衣服', 'sky', true]])
    now = step({ characters: [{ id: ch.id, prompt: [{ id: look.id, color: ch.color }] }] })
    expect([now.prompt[0].color, now.prompt[0].ownColor]).toEqual([ch.color, undefined])
  })
})

describe('同一份清单应用两次：不重复创建同 id 的区块', () => {
  it('applyPlan 第二次不再加新区块、新角色', () => {
    const d = doc()
    const p = planReply(d, reply({ prompt: [{ name: '背景', text: 'rooftop' }], characters: [{ name: '辛美尔', gender: 'male', prompt: [{ name: '外观', text: 'himmel' }] }] }))
    const once = applyPlan(d, p, allOn(p))
    const twice = applyPlan(once, p, allOn(p))
    expect(twice.base.prompt.map((s) => s.name)).toEqual(once.base.prompt.map((s) => s.name))
    expect(twice.characters.map((c) => c.name)).toEqual(once.characters.map((c) => c.name))
  })
  it('已经重复了的文档：打开时后出现的那份换新 id（区块、chip、角色），两份都留着', () => {
    const d = doc()
    const dup = structuredClone(d.base.prompt[1])
    const dupChar = structuredClone(d.characters[0])
    const bad: Doc = { ...d, base: { ...d.base, prompt: [...d.base.prompt, dup] }, characters: [...d.characters, dupChar] }
    const fixed = normalizeDoc(bad)
    const secs = allSections(fixed)
    expect(new Set(secs.map((s) => s.id)).size).toBe(secs.length)
    const chips = secs.flatMap((s) => s.chips.map((c) => c.id))
    expect(new Set(chips).size).toBe(chips.length)
    expect(new Set(fixed.characters.map((c) => c.id)).size).toBe(fixed.characters.length)
    expect(fixed.base.prompt[1].id).toBe(d.base.prompt[1].id)
    expect(fixed.base.prompt.at(-1)!.name).toBe(dup.name)
    expect(fixed.base.prompt.at(-1)!.id).not.toBe(dup.id)
    expect(normalizeDoc(d).base.prompt[0]).toBe(d.base.prompt[0])
  })
})

describe('格式 v2：tags 数组 + comment', () => {
  it('parseTagItem：一项一个 chip，逗号不拆；权重、前缀、括号照认；几组权重照组拆；空项跳过', () => {
    expect(parseTagItem('a girl sitting by the window, looking at the rain')).toEqual([{ text: 'a girl sitting by the window, looking at the rain', type: 'text', weight: 1 }])
    expect(parseTagItem('1.2::looking at viewer, smile::')).toEqual([{ text: 'looking at viewer, smile', type: 'tag', weight: 1.2 }])
    expect(parseTagItem('0.8::artist:wlop::')).toEqual([{ text: 'wlop', type: 'artist', weight: 0.8 }])
    expect(parseTagItem('{blue_sky}')).toEqual([{ text: 'blue sky', type: 'tag', weight: 1.05 }])
    expect(parseTagItem('Text: Hello, world')).toEqual([{ text: 'Hello, world', type: 'textrender', weight: 1 }])
    expect(parseTagItem('mutual#hug')).toEqual([{ text: 'hug', type: 'interaction', interaction: 'mutual', weight: 1 }])
    expect(parseTagItem('1.2::a::, 0.8::b::').map((c) => [c.text, c.weight])).toEqual([['a', 1.2], ['b', 0.8]])
    expect(parseTagItem('  ')).toEqual([])
  })
  it('改已有区块：一项一个 chip，没变的保留原 chip，禁用的照旧；空项跳过', () => {
    const d = doc()
    const scene = sec(d, '场景')
    const p = planReply(d, reply({ prompt: [{ id: scene.id, tags: ['outdoors', '1.3::cherry blossoms::', 'a girl sitting by the window, looking at the rain', '0.8::artist:wlop::', '', 'Text: Hello, world'], disabled: ['cloud'] }] }))
    const [c] = only(p, 'section')
    expect(texts(c.after)).toEqual(['outdoors', '1.3:cherry blossoms', '!cloud', 'a girl sitting by the window, looking at the rain', '0.8:wlop', 'Hello, world'])
    expect(c.after.chips.map((x) => x.type)).toEqual(['tag', 'tag', 'tag', 'text', 'artist', 'textrender'])
    expect(c.after.chips[0].id).toBe(scene.chips[0].id)
    expect(c.diff.added.map((x) => x.text)).toEqual(['a girl sitting by the window, looking at the rain', 'wlop', 'Hello, world'])
    expect(c.diff.reweighted.map((r) => [r.chip.text, r.from, r.chip.weight])).toEqual([['cherry blossoms', 1.2, 1.3]])
    const q = planReply(d, reply({ prompt: [{ id: scene.id, disabled: ['cloud', 'day'] }] }))
    expect(texts(only(q, 'section')[0].after)).toEqual(['outdoors', '1.2:cherry blossoms', '1.2:petals', 'blue sky', '!cloud', '!day', 'depth of field', '0.8:light particles'])
  })
  it('新区块、新角色的 tags；带逗号的 chip 原样导回 = 0 处改动', () => {
    const d = doc()
    const p = planReply(d, reply({ prompt: [{ name: '背景', tags: ['night sky, full of stars', 'moon'] }], characters: [{ name: '辛美尔', gender: 'male', prompt: [{ name: '外观', tags: ['himmel', 'blue hair, short hair'] }] }] }))
    expect(only(p, 'newSection')[0].section.chips.map((x) => x.text)).toEqual(['night sky, full of stars', 'moon'])
    expect(only(p, 'newChar')[0].character.prompt[0].chips.map((x) => x.text)).toEqual(['himmel', 'blue hair, short hair'])
    const next = applyPlan(d, p, allOn(p))
    expect(planReply(next, toAiDoc(next) as never).changes).toEqual([])
  })
  it('v1 照旧能读：text 按逗号拆', () => {
    const d = doc()
    const scene = sec(d, '场景')
    const raw = findAiJson(`\`\`\`json\n${JSON.stringify({ $schema: 'pe-doc-ai/1', prompt: [{ id: scene.id, text: 'outdoors, sunset, orange sky, ' }] })}\n\`\`\``)!
    expect(raw).not.toBeNull()
    const [c] = only(planReply(d, raw), 'section')
    expect(c.after.chips.filter((x) => !x.disabled).map((x) => x.text)).toEqual(['outdoors', 'sunset', 'orange sky'])
  })
  it('comment 读得出（去掉首尾空白、保留换行）；没写 / 不是字符串 = 没有', () => {
    const d = doc()
    const p = planReply(d, reply({ comment: '  背景换成太空。\n表情改成害羞，没找到更贴切的词。 ' }))
    expect(p.comment).toBe('背景换成太空。\n表情改成害羞，没找到更贴切的词。')
    expect(p.changes).toEqual([])
    expect(planReply(d, reply({})).comment).toBeUndefined()
    expect(planReply(d, reply({ comment: 3 })).comment).toBeUndefined()
    expect(planReply(d, reply({ comment: '  ' })).comment).toBeUndefined()
  })
  it('规则：要求里要分析时才写 comment；只回一个代码块；只改要求涉及的、不反问', () => {
    const t = aiRules(doc())
    expect(t).toContain("\n- If the request asks for analysis, add a top-level comment: why you made these changes, and what you couldn't do or weren't sure about; don't list the tag changes;")
    expect(t).toContain(`\n- Exactly one \`\`\`json code block with "$schema": "${AI_DOC_SCHEMA_ID}", nothing outside it.\n`)
    expect(t).toContain('\n- Change only what the request touches:')
    expect(t).toContain("\n- If unsure, go with the most reasonable reading and make the edit; don't ask questions.\n")
    expect(t).toContain('Sections just group tags; the user decides how (by content, by priority, …)')
    expect(AI_DOC_SCHEMA.properties.comment.type).toBe('string')
  })
  it('AI 代理读到的规则：传对象给 edit_document，没有「只回一个代码块」「不要反问」；其余一样', () => {
    const d = doc()
    const t = aiAgentText(d)
    expect(t).toContain('\n- Pass the JSON object, with "$schema": "' + AI_DOC_SCHEMA_ID + '", as `reply` to edit_document (an object, not a code block).\n')
    expect(t).toContain('\n- If unsure, go with the most reasonable reading and make the edit.\n')
    expect(t).not.toContain("don't ask questions")
    expect(t).not.toContain('code block with')
    expect(t).toContain('Write tag names exactly as search_tags / lookup_tags return them.')
    const strip = (s: string) => s.split('\n').filter((l) => !/^- (Pass the JSON|Exactly one|If unsure)/.test(l)).join('\n')
    expect(strip(aiRules(d, {}, 'agent'))).toBe(strip(aiRules(d)))
  })
  it('the agent reads which sections are random (after the document); the JSON and 复制给 AI / 问 AI stay the same', () => {
    const d = doc()
    for (const s of allSections(d)) delete s.random
    expect(randomSectionsText(d)).toBe('')
    expect(aiAgentText(d)).not.toContain('## Random sections')
    const before = { json: JSON.stringify(toAiDoc(d)), copy: aiPromptText(d) }
    const art = d.base.prompt[0]
    art.chips = [toChip({ type: 'artist', text: 'ciloranko', weight: 1 }), toChip({ type: 'artist', text: 'wlop', weight: 1.2 })]
    art.random = { ...defaultRule('artist'), locked: ['wlop'] }
    const empty = newRandomSection('tag')
    d.base.uc.push(empty)
    const ch = d.characters[0]
    const role = newRandomSection('char', ch.color)
    ch.prompt.unshift(role)
    role.random = { ...role.random!, lockAll: true }
    const t = randomSectionsText(d)
    expect(t.split('\n')).toEqual([
      '## Random sections',
      "Tincture draws these sections' tags from a range the user chose; reroll_random draws a section again (locked tags stay).",
      `- ${art.id} "${art.name}" in prompt: draws 3 artists; locked: artist:wlop`,
      `- ${empty.id} "随机区块" in uc: draws 1 tag; no range chosen yet (the user chooses it in Tincture; reroll_random cannot draw)`,
      `- ${role.id} "角色" in character ${ch.id} prompt: draws 1 character (with its work tag); the whole section is locked (reroll_random changes nothing)`,
    ])
    expect(aiAgentText(d).endsWith(`\n\n${t}`)).toBe(true)
    for (const s of [JSON.stringify(toAiDoc(d)), aiPromptText(d), aiAskMessages(d, {}, { rules: [], request: 'x', analysis: false }).user]) {
      expect(s).not.toMatch(/Random sections|reroll_random|"random"/)
    }
    expect(Object.keys(toAiDoc(d).prompt![0]).sort()).toEqual(Object.keys(JSON.parse(before.json).prompt[0]).sort())
    expect(before.copy).not.toContain('Random sections')
  })
})

describe('问 AI：发出去的内容、回答认不出时为什么', () => {
  it('system = 勾了的规则块（按顺序、空的不发）+ 规则说明 + Schema；user = 文档 + 要求（勾了附带分析再接一句）', () => {
    const d = doc()
    const { system, user } = aiAskMessages(d, {}, { rules: ['不修改「画师」区块', '  ', '只用英文'], request: ' 背景改成太空 ', analysis: true })
    expect(system.startsWith('不修改「画师」区块\n\n只用英文\n\nTask: edit a NovelAI image prompt')).toBe(true)
    expect(system).toContain('\n\n## JSON Schema\n```json\n')
    expect(system).not.toContain('## Current document')
    expect(user.startsWith('## Current document\n```json\n')).toBe(true)
    expect(user.endsWith(`\n\n## Request\n背景改成太空\n\n${AI_ANALYSIS_ASK}`)).toBe(true)
    expect(findAiJson(user)?.title).toBe(d.meta.title)
    const plain = aiAskMessages(d, {}, { rules: [], request: '更害羞', analysis: false })
    expect(plain.system.startsWith('Task:')).toBe(true)
    expect(plain.user.endsWith('\n\n## Request\n更害羞')).toBe(true)
  })
  it('和「复制给 AI」是同一份内容（没有规则块、要求空着时一字不差）', () => {
    const d = doc()
    const { system, user } = aiAskMessages(d, { nsfw: true }, { rules: [], request: '', analysis: false })
    expect(`${system}\n\n${user}`).toBe(aiPromptText(d, { nsfw: true }))
  })
  it('认不出时：没有 JSON = nojson（AI 用文字拒绝）；解析不了 / 没写 $schema = format，能重试', () => {
    expect(diagnoseReply('抱歉，我无法处理这个请求。')).toEqual({ kind: 'nojson' })
    expect(diagnoseReply('')).toEqual({ kind: 'nojson' })
    const broken = diagnoseReply('改好了：\n```json\n{"$schema": "pe-doc-ai/2", "prompt": [}\n```')
    expect(broken).toMatchObject({ kind: 'format', zh: 'JSON 无法解析' })
    expect(broken.kind === 'format' && broken.en).toMatch(/^the JSON is invalid \(.+\)$/)
    expect(diagnoseReply('```json\n{"$schema": "pe-doc-ai/2", "prompt": [{"id": "a"')).toMatchObject({ kind: 'format', zh: 'JSON 无法解析' })
    expect(diagnoseReply('```json\n{"prompt": []}\n```')).toEqual({ kind: 'format', zh: '缺少 "$schema": "pe-doc-ai/2"', en: 'the JSON has no "$schema": "pe-doc-ai/2"' })
    expect(aiRetryAsk('the JSON is invalid (x)')).toBe('Your reply could not be used: the JSON is invalid (x). Reply again with exactly one ```json code block with "$schema": "pe-doc-ai/2", nothing outside it.')
  })
})
