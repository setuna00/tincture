import { describe, expect, it } from 'vitest'
import { sampleDoc } from '@/store/sample'
import type { Doc } from '@/types'
import {
  CHAT_ACTIONS,
  CHAT_RULE,
  DOC_UNCHANGED,
  MODE_LINE,
  actionNote,
  altText,
  chatMessages,
  chatSystem,
  chatTokens,
  docKey,
  editorNote,
  formatTokens,
  placeOf,
  proseOf,
  unknownWords,
  userTurn,
  type CardStatus,
  type ChatAiMsg,
  type ChatConv,
  type ChatMsg,
  type ChatUserMsg,
} from './ai-chat'
import { AI_DOC_SCHEMA_ID, aiAskMessages, applyPlan, docText, findAiJson, planReply } from './ai-doc'
import type { CheckChip, DocCheck } from './doc-check'

const OPTS = {}
let n = 0
const id = () => `m${++n}`
const user = (msgs: ChatMsg[], doc: Doc, text: string, edit = true): ChatUserMsg => ({ id: id(), role: 'user', text, edit, sent: userTurn(msgs, doc, text, edit, OPTS), doc, at: 0 })
const ai = (raw: string, card?: CardStatus, afterKey?: string): ChatAiMsg => ({ id: id(), role: 'ai', alt: 0, alts: [{ raw, label: 'DeepSeek · deepseek-chat', preset: 'deepseek', at: 0, ...(card ? { card: { status: card, afterKey } } : {}) }] })
const sceneId = (d: Doc) => d.base.prompt.find((s) => s.name === '场景')!.id
const editReply = (d: Doc, tags: string[]) => `换成夜景：\n\n\`\`\`json\n${JSON.stringify({ $schema: AI_DOC_SCHEMA_ID, prompt: [{ id: sceneId(d), tags }] })}\n\`\`\``
const apply = (base: Doc, raw: string) => {
  const plan = planReply(base, findAiJson(raw)!, OPTS)
  return applyPlan(base, plan, new Set(plan.changes.filter((c) => c.defaultOn).map((c) => c.key)))
}
const isPrefix = <T,>(a: T[], b: T[]) => a.length <= b.length && a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]))

describe('发出去的（追加式）', () => {
  it('三轮：前一轮发的 messages 原样是后一轮的前缀；设置没变时 system 每轮一样', () => {
    const d0 = sampleDoc()
    const msgs: ChatMsg[] = []
    const u1 = user(msgs, d0, '背景改成夜景')
    msgs.push(u1)
    const req1 = { system: chatSystem(u1.doc, OPTS, ['不修改画师']), messages: chatMessages(msgs, u1.id) }
    expect(req1.messages).toEqual([{ role: 'user', content: u1.sent }])
    expect(u1.sent).toBe([docText(d0, OPTS), `## Request\n背景改成夜景\n\n${MODE_LINE.edit}`].join('\n\n'))
    expect(req1.system).toBe(aiAskMessages(d0, OPTS, { rules: ['不修改画师'], request: '', analysis: false }).system + CHAT_RULE)
    const raw1 = editReply(d0, ['outdoors', 'night', 'starry sky'])
    const d1 = apply(d0, raw1)
    msgs.push(ai(raw1, 'applied', docKey(d1, OPTS)))
    const u2 = user(msgs, d1, '这几个 tag 有没有冲突', false)
    msgs.push(u2)
    const req2 = { system: chatSystem(u2.doc, OPTS, ['不修改画师']), messages: chatMessages(msgs, u2.id) }
    expect(isPrefix(req1.messages, req2.messages)).toBe(true)
    expect(req2.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(req2.messages[1].content).toBe(raw1)
    expect(req2.system).toBe(req1.system)
    expect(u2.sent.split('\n\n')[0]).toBe('[Editor] The user applied your last edit.')
    expect(u2.sent).toContain(docText(d1, OPTS))
    expect(u2.sent.endsWith(MODE_LINE.chat)).toBe(true)
    msgs.push(ai('没有冲突。'))
    const u3 = user(msgs, d1, '那再加点雨')
    msgs.push(u3)
    const req3 = { system: chatSystem(u3.doc, OPTS, ['不修改画师']), messages: chatMessages(msgs, u3.id) }
    expect(isPrefix(req2.messages, req3.messages)).toBe(true)
    expect(req3.system).toBe(req2.system)
    expect(u3.sent).toBe([DOC_UNCHANGED, `## Request\n那再加点雨\n\n${MODE_LINE.edit}`].join('\n\n'))
    expect(u3.sent).not.toContain('## Current document')
  })

  it('改了质量标签 / 勾的规则：那一轮的 system 跟着变（之后又稳定）；messages 照样只追加', () => {
    const d0 = sampleDoc()
    const msgs: ChatMsg[] = []
    const u1 = user(msgs, d0, '加点雨')
    msgs.push(u1, ai(editReply(d0, ['rain'])))
    const d1: Doc = { ...d0, settings: { ...d0.settings, qualityTags: 'none' } }
    const u2 = user(msgs, d1, '再加点雾')
    msgs.push(u2)
    expect(chatSystem(d1, OPTS, [])).not.toBe(chatSystem(d0, OPTS, []))
    expect(chatSystem(d0, OPTS, ['保留画师'])).not.toBe(chatSystem(d0, OPTS, []))
    expect(isPrefix(chatMessages(msgs, u1.id), chatMessages(msgs, u2.id))).toBe(true)
  })

  it('没成的要求不进前文；重试 = 带上那一条；重新生成 = 到那条要求为止、不带原来的回答；没等到回答的要求不带', () => {
    const d0 = sampleDoc()
    const msgs: ChatMsg[] = []
    const u1 = user(msgs, d0, '第一条')
    const a1 = ai('回答一')
    msgs.push(u1, a1)
    const u2 = { ...user(msgs, d0, '第二条'), failed: '已停止' }
    msgs.push(u2)
    const u3 = user(msgs, d0, '第三条')
    msgs.push(u3)
    expect(chatMessages(msgs, u3.id).map((m) => m.content)).toEqual([u1.sent, '回答一', u3.sent])
    expect(chatMessages(msgs, u2.id).map((m) => m.content)).toEqual([u1.sent, '回答一', u2.sent])
    expect(chatMessages(msgs, u1.id)).toEqual([{ role: 'user', content: u1.sent }])
    const msgs2: ChatMsg[] = [u1, a1]
    const u4 = user(msgs2, d0, '第四条')
    msgs2.push(u4)
    const u5 = user(msgs2, d0, '第五条')
    msgs2.push(u5)
    expect(chatMessages(msgs2, u5.id).map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
  })

  it('翻页选中哪个回答，下一轮带哪个', () => {
    const d0 = sampleDoc()
    const msgs: ChatMsg[] = []
    const u1 = user(msgs, d0, '第一条')
    const a1 = ai('回答一')
    a1.alts.push({ ...a1.alts[0], raw: '回答一（重新生成）' })
    a1.alt = 1
    msgs.push(u1, a1)
    const u2 = user(msgs, d0, '第二条')
    msgs.push(u2)
    expect(chatMessages(msgs, u2.id)[1].content).toBe('回答一（重新生成）')
  })
})

describe('[Editor] 说明', () => {
  const d0 = sampleDoc()
  const raw = editReply(d0, ['outdoors', 'night'])
  const d1 = apply(d0, raw)
  const hand: Doc = { ...d1, meta: d1.meta, base: { ...d1.base, prompt: d1.base.prompt.map((s) => (s.name === '主体' ? { ...s, name: '主体（手改）' } : s)) } }
  const handOn0: Doc = { ...d0, base: { ...d0.base, prompt: d0.base.prompt.map((s) => (s.name === '主体' ? { ...s, name: '主体（手改）' } : s)) } }
  const after = (status: CardStatus) => {
    const msgs: ChatMsg[] = []
    msgs.push(user(msgs, d0, '换成夜景'))
    msgs.push(ai(raw, status, docKey(d1, OPTS)))
    return msgs
  }
  it.each([
    ['应用', 'applied', d1, '[Editor] The user applied your last edit.'],
    ['应用后手改', 'applied', hand, '[Editor] The user applied your last edit, then edited the document by hand.'],
    ['部分应用', 'reviewed', d1, '[Editor] The user reviewed your last edit and applied part of it.'],
    ['在新 tab 中打开', 'branch', d0, '[Editor] The user opened your last edit in a new tab; this document did not get it.'],
    ['在新 tab 中打开后手改这份', 'branch', handOn0, '[Editor] The user opened your last edit in a new tab; this document did not get it. The user then edited this document by hand.'],
    ['分出来的那一段', 'here', d1, '[Editor] This chat continues in a new tab, where the user applied your last edit.'],
    ['没用（含撤销）', 'none', d0, "[Editor] The user didn't apply your last edit."],
    ['没用、手改了', 'none', handOn0, "[Editor] The user didn't apply your last edit and edited the document by hand."],
  ] as const)('%s', (_n, status, doc, note) => {
    expect(editorNote(after(status), doc, OPTS)).toBe(note)
  })
  it('上一条是问答：文档变了说一句，没变不说；还没有 AI 的回答不说', () => {
    const msgs: ChatMsg[] = []
    msgs.push(user(msgs, d0, '有没有冲突', false), ai('没有。'))
    expect(editorNote(msgs, d0, OPTS)).toBe('')
    expect(editorNote(msgs, handOn0, OPTS)).toBe('[Editor] The document changed since your last reply.')
    expect(editorNote([], d0, OPTS)).toBe('')
  })
})

describe('显示', () => {
  it('代码块不显示成字（流式时没收完的也去掉）；问答模式全是代码块时原样显示，隐藏了修改时不显示', () => {
    const raw = '改好了：\n\n```json\n{"$schema": "pe-doc-ai/2"}\n```'
    expect(proseOf(raw)).toBe('改好了：')
    expect(proseOf('先说一句\n```json\n{"$schema": "pe-')).toBe('先说一句')
    const alt = { raw: '```json\n{}\n```', label: '', preset: 'deepseek', at: 0 }
    expect(altText(alt, true)).toBe('')
    expect(altText(alt, false)).toBe('```json\n{}\n```')
    expect(altText({ ...alt, hidden: true }, false)).toBe('')
  })
  it('token 数：服务回了用量 = 最后一次的输入 + 输出；没回按字数估', () => {
    const d0 = sampleDoc()
    const msgs: ChatMsg[] = []
    msgs.push(user(msgs, d0, '加点雨'))
    const a = ai('好的')
    msgs.push(a)
    const c: ChatConv = { id: 'c1', docId: 'd1', title: '', createdAt: 0, updatedAt: 0, msgs }
    expect(chatTokens(c)).toBeGreaterThan(3000)
    a.alts[0].usage = { input: 12345, cacheRead: 10240, output: 456 }
    expect(chatTokens(c)).toBe(12801)
    expect(formatTokens(12801)).toBe('约 1.3 万 token')
    expect(formatTokens(3200)).toBe('约 3.2 千 token')
  })
})

const place = (o: Partial<CheckChip> = {}): CheckChip => ({ chipId: 'c', tag: 'x', text: 'x', weight: 1, disabled: false, sectionId: 's1', sectionName: '场景', field: 'prompt', ...o })
const emptyCheck = (o: Partial<DocCheck> = {}): DocCheck => ({ unknown: [], alias: [], oldName: [], duplicate: [], naiDuplicate: [], ...o })

describe('一键动作', () => {
  it('[Editor] 行接在这条要求后面：system 和前面的 messages 一个字不变（缓存照常命中）', () => {
    const d0 = sampleDoc()
    const msgs: ChatMsg[] = []
    const u1 = user(msgs, d0, '背景改成夜景')
    msgs.push(u1)
    const req1 = { system: chatSystem(u1.doc, OPTS, ['不修改画师']), messages: chatMessages(msgs, u1.id) }
    const raw1 = editReply(d0, ['outdoors', 'night', 'starry sky'])
    const d1 = apply(d0, raw1)
    msgs.push(ai(raw1, 'applied', docKey(d1, OPTS)))
    const sent1 = u1.sent
    const { note } = actionNote('spelling', emptyCheck({ unknown: [{ ...place({ tag: 'hair ornamant', text: 'hair ornamant' }), similar: ['hair ornament'] }] }))
    const u2: ChatUserMsg = { id: id(), role: 'user', text: '核对写法', edit: true, sent: userTurn(msgs, d1, '核对写法', true, OPTS, note), doc: d1, at: 0, action: { id: 'spelling', found: ['hair ornamant'] } }
    msgs.push(u2)
    const req2 = { system: chatSystem(u2.doc, OPTS, ['不修改画师']), messages: chatMessages(msgs, u2.id) }
    expect(req2.system).toBe(req1.system)
    expect(isPrefix(req1.messages, req2.messages)).toBe(true)
    expect(req2.messages[0].content).toBe(sent1)
    expect(u2.sent.endsWith(`## Request\n核对写法\n\n${note}\n\n${MODE_LINE.edit}`)).toBe(true)
    expect(u2.sent.startsWith('[Editor] The user applied your last edit.\n\n')).toBe(true)
    msgs.push(ai('好的'))
    const u3 = user(msgs, d1, '还有别的吗', false)
    msgs.push(u3)
    const req3 = chatMessages(msgs, u3.id)
    expect(isPrefix(req2.messages, req3)).toBe(true)
    expect(req3[2].content).toBe(u2.sent)
  })

  it('没有 [Editor] 行时和普通要求一样', () => {
    const d = sampleDoc()
    expect(userTurn([], d, '去重', true, OPTS, '')).toBe(userTurn([], d, '去重', true, OPTS))
    expect(userTurn([], d, '去重', true, OPTS)).toBe([docText(d, OPTS), `## Request\n去重\n\n${MODE_LINE.edit}`].join('\n\n'))
  })

  it('核对写法：一个词一行，列出每个位置和像的写法；回复方式 = 修改文档', () => {
    const check = emptyCheck({
      unknown: [
        { ...place({ tag: 'cheery blossoms', text: 'cheery blossoms' }), similar: ['cherry blossoms', 'cherry tree'] },
        { ...place({ tag: 'hair ornamant', text: 'hair ornamant', sectionName: '外观', character: { id: 'ch1', name: '菲伦' } }), similar: ['hair ornament'] },
        { ...place({ tag: 'Cheery Blossoms', text: 'Cheery Blossoms', sectionName: '负面', field: 'uc', disabled: true }), similar: ['cherry blossoms'] },
        { ...place({ tag: 'mutual#hgu', text: 'hgu', sectionName: '互动', character: { id: 'ch1', name: '菲伦' }, field: 'uc' }), similar: [] },
      ],
    })
    const { note, found } = actionNote('spelling', check)
    expect(found).toEqual(['cheery blossoms', 'hair ornamant', 'mutual#hgu'])
    expect(unknownWords(check)).toEqual(found)
    const lines = note.split('\n')
    expect(lines[0]).toMatch(/^\[Editor\] One-click action\. The words below are not in Tincture's tag library/)
    expect(lines.slice(1)).toEqual([
      'Not in the library → close library tags:',
      '- "cheery blossoms" (prompt / 场景; uc / 负面, disabled) → cherry blossoms, cherry tree',
      '- "hair ornamant" (菲伦 / 外观) → hair ornament',
      '- "mutual#hgu" (菲伦 uc / 互动) → (no close library tag)',
    ])
    expect(CHAT_ACTIONS.find((a) => a.id === 'spelling')).toEqual({ id: 'spelling', name: '核对写法', edit: true })
  })

  it('去重：同一个框里写了不止一次的各在哪；没有时说一句；查冲突不附清单、回复方式 = 问答', () => {
    const dup = emptyCheck({ duplicate: [{ tag: 'smile', copies: [place({ tag: 'smile', text: 'smile', sectionName: '表情' }), place({ tag: 'smile', text: 'smile', sectionName: '外观' })] }] })
    const d = actionNote('dedupe', dup)
    expect(d.found).toEqual(['smile'])
    expect(d.note.split('\n').slice(1)).toEqual(['Written more than once in one box:', '- "smile" (prompt / 表情; prompt / 外观)'])
    const none = actionNote('dedupe', emptyCheck())
    expect(none.found).toEqual([])
    expect(none.note.split('\n')[1]).toBe('No tag is written twice in one box.')
    const c = actionNote('conflicts')
    expect(c.found).toEqual([])
    expect(c.note).toMatch(/^\[Editor\] One-click action\. Only report, don't edit/)
    expect(CHAT_ACTIONS.map((a) => [a.name, a.edit])).toEqual([['核对写法', true], ['去重', true], ['查冲突', false]])
  })

  it('位置的写法', () => {
    expect(placeOf(place())).toBe('prompt / 场景')
    expect(placeOf(place({ field: 'uc', sectionName: '' }))).toBe('uc / untitled')
    expect(placeOf(place({ character: { id: 'c', name: '芙莉莲' }, sectionName: '外观' }))).toBe('芙莉莲 / 外观')
    expect(placeOf(place({ character: { id: 'c', name: '芙莉莲' }, field: 'uc', sectionName: '负面' }))).toBe('芙莉莲 uc / 负面')
  })
})
