import { parsePrompt, toChip } from '@/lib/nai'
import type { Character, Doc, Gender, Section, SectionColor } from '@/types'
import type { CharacterTemplate, SectionTemplate } from './library'
import { defaultSettings, makeSection } from './doc'
import { newDocSettings } from './prefs'
import { newId } from '@/lib/nai'
import { newRandomSection } from '@/lib/random-block'

const sec = (name: string, color: SectionColor, prompt: string) => makeSection(name, parsePrompt(prompt).map(toChip), color)

export const EXAMPLE_WORK = '葬送的芙莉莲'

const character = (name: string, gender: Gender, color: SectionColor, look: string, note: string, work = EXAMPLE_WORK): Character => ({
  id: newId('ch'),
  name,
  gender,
  color,
  note,
  ...(work ? { work } : {}),
  prompt: [sec('外观', color, look)],
  uc: [],
  enabled: true,
  center: { x: 0.5, y: 0.5 },
})

export function exampleCharacters(): Record<'芙莉莲' | '菲伦' | '修塔尔克' | '辛美尔', Character> {
  return {
    芙莉莲: character(
      '芙莉莲',
      'female',
      'lime',
      'frieren, elf, pointy ears, white hair, bangs, twintails, 1.15::green eyes::, earrings, white capelet, hair blowing, mutual#hug',
      '千年的精灵魔法使。和菲伦同框时两边都留着 mutual#hug；单人图把它关掉。',
    ),
    菲伦: character(
      '菲伦',
      'female',
      'violet',
      'fern (sousou no frieren), purple hair, long hair, princess cut, purple eyes, black coat, smiling, mutual#hug',
      '芙莉莲的徒弟。和芙莉莲同框时在负面加一块「防串色」（white hair、pointy ears），免得白发、尖耳朵串过来。',
    ),
    修塔尔克: character(
      '修塔尔克',
      'male',
      'orange',
      'stark (sousou no frieren), red hair, short hair, red eyes, muscular male, black shirt, holding axe',
      '战士，红色短发。和女角色同框时主体里要有 1boy，不然容易画成女孩。',
    ),
    辛美尔: character('辛美尔', 'male', 'sky', 'himmel (sousou no frieren), blue hair, short hair, blue eyes, white cape, sword', '勇者，蓝色短发、白斗篷。回忆场景用。'),
  }
}

export function libraryOnlyCharacters(): Character[] {
  return [
    character('后藤一里', 'female', 'pink', 'gotoh hitori, pink hair, long hair, cube hair ornament, blue eyes, pink jacket, track jacket', '内向的吉他手，粉色运动夹克 + 方块发饰。', '孤独摇滚！'),
    character(
      '伊地知虹夏',
      'female',
      'amber',
      'ijichi nijika, blonde hair, side ponytail, red eyes, star hair ornament',
      '示例：作品名打成了「孤独摇滚」（少了「！」）。在「模板管理」里把作品「孤独摇滚」改名成「孤独摇滚！」，就和后藤一里合并到一个作品里了。',
      '孤独摇滚',
    ),
    character('狐耳巫女', 'female', 'rose', 'fox ears, fox tail, white hair, long hair, yellow eyes, miko, red hakama, hair ribbon', '原创角色，没有作品（在模板库里归到「无所属作品」）。', ''),
  ]
}

export interface ExampleLinks {
  section: (name: string) => SectionTemplate | undefined
  character: (name: string) => CharacterTemplate | undefined
}

export function sampleDoc(link?: ExampleLinks): Doc {
  const ex = exampleCharacters()
  ex.菲伦.uc.push(sec('防串色', 'violet', 'white hair, pointy ears'))
  const doc: Doc = {
    base: {
      prompt: [
        sec('主体', 'sky', '2girls, 1boy, multiple girls, looking at viewer, smile, cowboy shot'),
        sec('场景', 'teal', 'outdoors, 1.2::cherry blossoms, petals::, blue sky, cloud, day, depth of field, 0.8::light particles::'),
        sec('画师', 'rose', '1.1::artist:mika pikazo::, artist:ciloranko, 0.7::artist:kantoku::, year 2024'),
        sec('质量', 'amber', 'very aesthetic, masterpiece, high complexity, absurdres'),
      ],
      uc: [
        sec('通用负面', 'slate', 'lowres, bad anatomy, bad hands, missing fingers, extra digits, jpeg artifacts, signature, watermark, username, blurry'),
        sec('风格排除', 'violet', '-1::monochrome::, sketch, 3d'),
      ],
    },
    characters: [ex.芙莉莲, ex.菲伦, ex.修塔尔克],
    settings: newDocSettings(),
    meta: { title: '樱花下的师徒', createdAt: Date.now() },
  }
  const scene = doc.base.prompt[1]
  scene.chips.find((c) => c.text === 'cloud')!.disabled = true
  if (link) {
    const tie = (s: Section, name: string, edited = false) => {
      const t = link.section(name)
      if (!t) return
      s.templateId = t.id
      if (t.note) s.note = t.note
      if (edited) s.templateEdited = true
    }
    tie(scene, '樱花晴天')
    tie(doc.base.uc[0], '通用负面', true)
    const tieChar = (c: Character, edited = false) => {
      const t = link.character(c.name)
      if (!t) return
      c.templateId = t.id
      if (edited) c.templateEdited = true
    }
    tieChar(ex.芙莉莲)
    tieChar(ex.菲伦, true)
    tieChar(ex.修塔尔克)
  }
  return doc
}

export function blankDoc(title = '未命名'): Doc {
  return {
    base: {
      prompt: [makeSection('主体', [], 'sky'), makeSection('画风', [], 'rose'), makeSection('质量', [], 'amber')],
      uc: [makeSection('负面', [], 'slate')],
    },
    characters: [],
    settings: newDocSettings(),
    meta: { title, createdAt: Date.now() },
  }
}

export function introDoc(): Doc {
  const doc = sampleDoc()
  doc.settings = defaultSettings()
  doc.characters = doc.characters.filter((c) => c.name !== '修塔尔克')
  const [subject, scene, artist, quality] = doc.base.prompt
  subject.chips = subject.chips.filter((c) => c.text !== '1boy')
  subject.note = '单击 tag 选中，滚轮调整权重，双击编辑；末尾的「+ tag」输入中文、拼音或英文搜索添加。'
  scene.note = 'tag 前的数字是权重（1.2 加强、0.8 减弱），导出为 NAI 的 1.2::tag:: 写法；右键 tag 可禁用，cloud 已禁用，留在原位、不导出。'
  const random = newRandomSection('artist')
  artist.name = '画师随机'
  artist.random = random.random
  artist.chips = artist.chips.filter((c) => c.type === 'artist')
  artist.note = '点击区块头的重抽按钮换一组画师；选中画师后按 L（或左栏「锁定」）保留，重抽时不换。'
  quality.chips = sec('质量', 'amber', 'best quality, high complexity, absurdres').chips
  doc.base.uc[0].chips = sec('通用负面', 'slate', 'bad anatomy, bad hands, extra digits, signature, watermark, username, blurry').chips
  const official: Record<string, string> = { 'princess cut': 'hime cut', smiling: 'smile' }
  for (const c of doc.characters[1].prompt[0].chips) c.text = official[c.text] ?? c.text
  quality.note = '右栏「图片生成」点击「生成」出图；未设置 NAI 令牌时，在「提示词复制」页复制文本或复制为 NAI 图。'
  const light = sec('光照', 'amber', 'sunlight, dappled sunlight')
  light.muted = true
  light.note = '区块头右侧的开关关闭后整块不导出；此区块已停用。'
  doc.base.prompt.push(light)
  for (const s of doc.base.uc) s.note = '负面 Prompt 与正面写法相同，写不想出现的内容。'
  doc.characters[0].note = '角色框对应 NAI 的角色 Prompt，导出时最前面自动加 girl / boy；点击卡片头部的 ♀ / ♂ 切换性别。'
  doc.characters[1].note = '每个角色可以单独写负面 Prompt：「防串色」排除芙莉莲的白发和尖耳朵。'
  for (const c of doc.characters) {
    for (const s of c.prompt) s.note = '外观 tag 只作用于当前角色。'
    for (const s of c.uc) s.note = '只作用于当前角色的负面 Prompt。'
  }
  return doc
}

export function exampleDocTemplates(): { title: string; doc: Doc }[] {
  const doc = (title: string, prompt: Section[], uc: Section[], characters: Doc['characters'] = []) => ({
    title,
    doc: { base: { prompt, uc }, characters, settings: defaultSettings(), meta: { title, createdAt: 0 } } as Doc,
  })
  const muted = (s: Section) => ((s.muted = true), s)
  return [
    { title: '樱花下的师徒', doc: { ...sampleDoc(), settings: defaultSettings(), meta: { title: '樱花下的师徒', createdAt: 0 } } },
    doc(
      '单人立绘 · 白底',
      [
        sec('主体', 'sky', '1girl, solo, standing, full body, looking at viewer, white background, simple background'),
        sec('画风', 'rose', 'artist:ciloranko, year 2024'),
        sec('质量', 'amber', 'very aesthetic, masterpiece'),
      ],
      [sec('负面', 'slate', 'lowres, bad anatomy, bad hands')],
    ),
    doc(
      '雨夜街头',
      [
        sec('主体', 'sky', '1girl, walking, hood up, hands in pockets, from side'),
        sec('场景', 'indigo', 'night, city, rain, neon lights, reflection, wet ground'),
        muted(sec('光照', 'amber', 'rim lighting, backlighting')),
        sec('画风', 'rose', '0.8::artist:mika pikazo::, artist:wlop'),
      ],
      [sec('负面', 'slate', 'lowres, blurry, jpeg artifacts')],
    ),
    doc(
      '猫耳女仆咖啡店',
      [sec('场景', 'orange', 'indoors, cafe, table, cup, window, day'), sec('质量', 'amber', 'very aesthetic, masterpiece')],
      [sec('负面', 'slate', 'lowres, bad hands')],
      [{ id: newId('ch'), name: '女仆', gender: 'female', color: 'pink', prompt: [sec('外观', 'pink', 'cat ears, maid, apron, frills, black hair, smile, holding tray')], uc: [], enabled: true, center: { x: 0.5, y: 0.5 } }],
    ),
  ]
}
