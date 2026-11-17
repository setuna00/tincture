import { describe, expect, it } from 'vitest'
import { BY_NAME, COOC, ENTRIES } from './tag-fixture'
import { buildEngine, decodeAliases, type LookupFile } from './tag-data'
import { countLabel } from './tagdb'

const { readFileSync } = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { readFileSync(p: URL): Uint8Array }
const { gunzipSync } = (await import(/* @vite-ignore */ `node:${'zlib'}`)) as { gunzipSync(b: Uint8Array): Uint8Array }

const T = (n: string) => BY_NAME.get(n)!
const { search, match, recommend: rec } = buildEngine(ENTRIES, COOC)
const names = (hits: { tag: { name: string } }[]) => hits.map((h) => h.tag.name)

describe('构建产物：主位原子、域、NSFW 档', () => {
  it('颜色 + 衣物挂在衣物的原子上，域是服装', () => {
    expect(T('white shirt').group).toBe('上衣')
    expect(T('white shirt').domain).toBe('服装')
    expect(T('twintails').group).toBe('扎发')
    expect(T('cherry blossoms').group).toBe('花')
  })
  it('露骨的身体部位主位留在原维度，档是 R18；擦边的只标记', () => {
    expect(T('nipples').group).toBe('胸')
    expect(T('nipples').level).toBe(2)
    expect(T('cleavage').level).toBe(1)
    expect(T('swimsuit').level).toBe(1)
  })
  it('猎奇 / 排泄是 R18G；手调表把中性词拉回全年龄', () => {
    expect(T('guro').level).toBe(3)
    expect(T('scat').level).toBe(3)
    for (const n of ['sweat', 'pov', 'lying', 'bed', 'solo focus']) expect(T(n).level ?? 0).toBe(0)
    expect(T('spanking').level).toBe(2)
  })
  it('角色、作品不分档', () => {
    expect(T('hatsune miku').level ?? 0).toBe(0)
  })
})

describe('NAI 特殊词', () => {
  it('NAI 自己的词标出来，作品数显示「NAI」', () => {
    for (const n of ['very aesthetic', 'best quality', 'masterpiece', 'rating:general', 'year 2024', 'no text']) {
      expect(T(n).nai).toBe(true)
      expect(countLabel(T(n))).toBe('NAI')
    }
  })
  it('Danbooru 改了名的旧词用新名字的作品数，不当 NAI 词', () => {
    expect(T('hand on hip').nai).toBeFalsy()
    expect(T('hand on hip').count).toBe(T('hand on own hip').count)
    expect(countLabel(T('hand on hip'))).not.toBe('NAI')
  })
  it('补全：masterpiece 打前缀就第一，rating / year 都搜得到，新年份在前', () => {
    expect(names(search('maste'))[0]).toBe('masterpiece')
    expect(names(search('rating')).slice(0, 4).sort()).toEqual(['rating:explicit', 'rating:general', 'rating:questionable', 'rating:sensitive'])
    expect(names(search('year 20'))[0]).toBe('year 2026')
  })
})

describe('NSFW 过滤（全局设置：1 = 关，2 = R18，3 = R18 + R18G）', () => {
  it('补全：关着时露骨的不出，完全打对的照样出', () => {
    expect(names(search('nipp', 12, 1))).not.toContain('nipples')
    expect(names(search('nipples', 12, 1))[0]).toBe('nipples')
    expect(names(search('nipp', 12, 2))).toContain('nipples')
    expect(names(search('cleav', 12, 1))).toContain('cleavage')
  })
  it('补全：R18G 只在第三档出', () => {
    expect(names(search('gur', 12, 2))).not.toContain('guro')
    expect(names(search('gur', 12, 3))).toContain('guro')
  })
  it('可能是：关着时不出露骨的', () => {
    expect(match('粉色乳头', 24, 1).map((t) => t.name)).not.toContain('nipples')
    expect(match('粉色乳头', 24, 2).map((t) => t.name)).toContain('pink nipple')
  })
  it('推荐：关着时不推 R18 / R18G', () => {
    const r = rec([{ name: 'bikini', weight: 1 }, { name: 'beach', weight: 1 }], ['bikini', 'beach'], 24, { maxLevel: 1 })
    expect(r.length).toBeGreaterThan(5)
    expect(r.filter((x) => (T(x.name).level ?? 0) > 1)).toEqual([])
  })
})

describe('细分类：分组页说明文字里的链接不再挂上', () => {
  it('tag 按含义归入对应分组', () => {
    expect(T('paper').group).toBe('书本文具')
    expect(T('doll').group).toBe('玩具游戏')
    expect(T('weapon').group).toBe('武器通用')
    expect(T('emblem').group).toBe('符号图形')
    expect(T('perspective').group).toBe('透视景深')
    expect(T('baseball bat').group).toBe('运动用品')
    expect(T('torii').group).toBe('建筑名胜')
    expect(T('nose').group).toBe('头面')
    expect(T('eyebrows').group).toBe('头面')
    expect(T('knight').group).toBe('身份职业')
  })
  it('名字规则收窄：capelet 是披肩，lab coat 是职业装', () => {
    expect(T('capelet').group).toBe('围巾披肩')
    expect(T('white capelet').group).toBe('围巾披肩')
    expect(T('lab coat').group).toBe('职业装')
    expect(T('cape').group).toBe('外套')
  })
})

describe('R18G 和原子说明对得上', () => {
  it('吞食一族都是 R18G', () => {
    for (const n of ['vore', 'imminent vore']) {
      expect(T(n).group).toBe('吞食')
      expect(T(n).level).toBe(3)
    }
  })
  it('torture 挂酷刑（R18G）；amputee 留全年龄的伤与包扎', () => {
    expect(T('torture').group).toBe('酷刑')
    expect(T('torture').level).toBe(3)
    for (const n of ['amputee', 'armless amputee', 'legless amputee']) {
      expect(T(n).group).toBe('伤与包扎')
      expect(T(n).level ?? 0).toBe(0)
    }
    expect(T('quadruple amputee').level).toBe(3)
  })
})

describe('NAI 认的 Danbooru 旧词', () => {
  it('改了名的旧写法 NAI 认的认得：作品数、中文、分组、档跟新名字', () => {
    const t = T('see-through')
    const now = T('see-through clothes')
    expect(t.old).toBe(2)
    expect(t.count).toBe(now.count)
    expect(t.zh).toBe(now.zh)
    expect(t.group).toBe(now.group)
    expect(t.level ?? 0).toBe(now.level ?? 0)
    for (const n of ['smiling', 'blond', '1girls']) expect(BY_NAME.has(n)).toBe(false)
  })
  it('补全：打英文搜得到，中文只出新名字；打全了它第一', () => {
    expect(names(search('see-through'))[0]).toBe('see-through')
    expect(names(search(T('see-through clothes').zh))).not.toContain('see-through')
  })
  it('已弃用的补上旧作品数：bang → bangs 前 3，silver → silver hair 前 5', () => {
    expect(T('bangs').old).toBe(1)
    expect(T('bangs').count).toBeGreaterThan(1_000_000)
    expect(names(search('bang')).slice(0, 3)).toContain('bangs')
    expect(names(search('silver')).slice(0, 5)).toContain('silver hair')
    expect(names(search('刘海'))).toContain('bangs')
  })
  it('已弃用、NAI 查不到的：全年龄的不算认得，R18 的判不了、照旧留着', () => {
    for (const n of ['wavy', 'silver', 'orange handwear']) expect(BY_NAME.has(n)).toBe(false)
    expect(T('indoor nudity').level).toBe(2)
  })
  it('旧词不进推荐、可能是给新名字', () => {
    const r = rec([{ name: 'long hair', weight: 1 }, { name: 'blunt bangs', weight: 1 }], ['long hair', 'blunt bangs'], 24)
    expect(r.filter((x) => T(x.name).old)).toEqual([])
    expect(match('see-throug', 24).map((t) => t.name)).not.toContain('see-through')
  })
  it('girl / boy / text 是 NAI 词，显示「NAI」', () => {
    for (const n of ['girl', 'boy', 'text', 'other']) {
      expect(T(n).nai).toBe(true)
      expect(countLabel(T(n))).toBe('NAI')
    }
  })
})

describe('Danbooru 别名：不标未识别，提示正式写法', () => {
  const lookup = JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(new URL('../assets/tags/lookup.json.gz', import.meta.url))))) as LookupFile
  const aliases = decodeAliases(lookup)
  it('库里没有的旧写法 → 库里的正式写法', () => {
    expect(aliases.get('smiling')).toBe('smile')
    expect(aliases.get('blond')).toBe('blonde hair')
    expect(aliases.get('naked')).toBe('nude')
    expect(aliases.get('genshin')).toBe('genshin impact')
  })
  it('库里有的（NAI 认的旧写法、正式 tag）不算别名', () => {
    for (const n of ['see-through', 'megane', 'smile', 'long hair']) expect(aliases.has(n)).toBe(false)
    for (const b of aliases.values()) expect(BY_NAME.has(b)).toBe(true)
  })
})

describe('NSFW 档重查：看词义，不看常出现在什么图里', () => {
  it('中性词不再是 R18（分级说的是整张图）', () => {
    for (const n of ['washing hair', 'soap bubbles', 'showering', 'shower (place)', 'shampoo', 'tape', "grabbing another's arm", 'reflection focus', 'leg grab'])
      expect(T(n).level ?? 0).toBe(0)
    for (const n of ['micro panties', 'covering privates', 'thigh grab', 'shared bathing']) expect(T(n).level).toBe(1)
  })
  it('讲裸露、性器官、性行为的照旧 R18', () => {
    for (const n of ['naked apron', 'naked sweater', 'no bra', 'no panties', 'spread legs', 'cameltoe', 'trefoil', 'sukebe isu']) expect(T(n).level).toBe(2)
  })
  it('涉及未成年的照旧藏着，NAI 不藏的也升上来', () => {
    for (const n of ['loli', 'shota', 'mesugaki', 'onee-loli', 'oppai loli', 'school swimsuit flap', 'osugaki', 'pedophile']) expect(T(n).level).toBeGreaterThanOrEqual(2)
  })
  it('补全：NSFW 关着时 soap bub 补得出 soap bubbles，naked ap 补不出 naked apron', () => {
    expect(names(search('soap bub', 12, 1))).toContain('soap bubbles')
    expect(names(search('naked ap', 12, 1))).not.toContain('naked apron')
  })
})

describe('主位在 R18 原子上的按词义降档', () => {
  it('降了的主位挪到词义所在的维度，不再在 R18 域里（发现页关着 NSFW 时找得到）', () => {
    const moved: [string, number, string][] = [
      ['pregnant', 0, '腰腹'],
      ['bound', 0, '身份职业'],
      ['bound wrists', 0, '手臂姿势'],
      ['gagged', 0, '面具眼罩'],
      ['leash', 0, '颈饰'],
      ['tentacles', 0, '幻想生物'],
      ['lotion', 0, '日用杂物'],
      ['hypnosis', 0, '日常动作'],
      ['choking on object', 0, '日常动作'],
      ['shirt lift', 1, '穿着状态'],
      ['pants pull', 1, '穿着状态'],
      ['underwear only', 1, '内衣（下）'],
      ['convenient leg', 1, '腿部姿势'],
      ['viewer on leash', 1, '视角'],
      ['naked sheet', 1, '睡衣家居'],
    ]
    for (const [n, level, group] of moved) {
      expect(T(n).level ?? 0, n).toBe(level)
      expect(T(n).group, n).toBe(group)
      expect(['R18', 'R18G']).not.toContain(T(n).domain)
    }
  })
  it('专门的 BDSM 器具、乳贴、露骨的照旧 R18，主位不动', () => {
    for (const n of ['ball gag', 'karada', 'pillory', 'pasties', 'maebari', 'open towel', 'torogao', 'take your pick']) {
      expect(T(n).level, n).toBe(2)
      expect(T(n).domain, n).toBe('R18')
    }
  })
  it('涉及未成年的照旧藏着', () => {
    expect(T('buruma pull').level).toBe(2)
  })
  it('补全：NSFW 关着时 pregn 补得出 pregnant，ball ga 补不出 ball gag', () => {
    expect(names(search('pregn', 12, 1))).toContain('pregnant')
    expect(names(search('ball ga', 12, 1))).not.toContain('ball gag')
  })
})

describe('已弃用的旧词按词义判档，和新写法一致', () => {
  it('hand on thigh 跟新写法：own 全年龄、another\'s 擦边，统称取高的 = 擦边', () => {
    expect(T('hand on thigh').old).toBe(1)
    expect(T('hand on own thigh').level ?? 0).toBe(0)
    expect(T("hand on another's thigh").level).toBe(1)
    expect(T('hand on thigh').level).toBe(1)
    expect(T("hands on another's ass").level).toBe(2)
    expect(T('hands on ass').level).toBe(2)
  })
  it('中性的不再是 R18；disembodied limb 不是猎奇，主位挪出 R18G', () => {
    for (const n of ['male hand', 'toe-point', 'disembodied limb', 'disembodied foot']) expect(T(n).level ?? 0, n).toBe(0)
    expect(T('oil').level).toBe(1)
    expect(T('disembodied limb').group).toBe('光环与异形部位')
    expect(T('disembodied limb').domain).not.toBe('R18G')
  })
  it('同族新写法是擦边的泳装 / 内衣旧词跟着擦边（已弃用的词新图少，按数据判不出擦边）', () => {
    for (const n of ['frilled swimsuit', 'side-tie bikini', 'blue swimsuit', 'ribbon bra', 'innerboob']) expect(T(n).level, n).toBe(1)
  })
})

describe('R18 / R18G 的主位挂在词义所在的原子上', () => {
  it('trefoil 同 cameltoe 是 R18，主位不在符号图形', () => {
    expect(T('trefoil').level).toBe(2)
    expect(T('trefoil').group).toBe('臀胯')
    expect(T('cameltoe').level).toBe(2)
  })
  it('分类表挂错的挪回来', () => {
    const moved: [string, string][] = [
      ['yellow nipples', '胸'],
      ['excessive lactation', '胸'],
      ['strip poker', '玩具游戏'],
      ['tail in ass', '性行为'],
      ['cum on wall', '体液'],
    ]
    for (const [n, group] of moved) expect(T(n).group, n).toBe(group)
  })
  it('名字不露骨、只因为挂错原子成了 R18 的回到全年龄', () => {
    expect(T('escrima sticks').group).toBe('冷兵器')
    expect(T('lemon tree').group).toBe('植物')
    for (const n of ['escrima sticks', 'lemon tree']) expect(T(n).level ?? 0, n).toBe(0)
  })
})

describe('组合词的中文名跟基础词的意思和叫法', () => {
  it('意思按 Danbooru：collar 是项圈不是衣领，wrist cuffs 是腕饰不是袖口', () => {
    expect(T('collar').zh).toBe('项圈')
    expect(T('white collar').zh).toBe('白色项圈')
    expect(T('frilled collar').zh).toBe('荷叶边项圈')
    expect(T('wrist cuffs').zh).toBe('腕饰')
    expect(T('white wrist cuffs').zh).toBe('白色腕饰')
    expect(T('open collar').zh).toBe('敞领')
  })
  it('同一族统一成基础词的叫法：capelet 都是短披肩', () => {
    expect(T('capelet').zh).toBe('短披肩')
    for (const n of ['blue capelet', 'frilled capelet', 'brown capelet']) expect(T(n).zh, n).toContain('短披肩')
  })
  it('不和别的东西同名：ascot 不叫领巾（neckerchief），sash 不叫腰带（belt）', () => {
    expect(T('purple ascot').zh).not.toBe(T('purple neckerchief').zh)
    expect(T('green sash').zh).not.toBe(T('green belt').zh)
  })
  it('正常的简写不动：black skirt 黑裙子', () => {
    expect(T('black skirt').zh).toBe('黑裙子')
  })
  it('意思错 / 两样东西同名的改了，用社区叫法；社区也这么叫的旧名不动', () => {
    const fixed: [string, string][] = [
      ['lily (flower)', '百合花'],
      ['upside-down', '上下颠倒'],
      ['helm', '全盔'],
      ['galaxy', '星系'],
      ['tuxedo', '无尾礼服'],
      ['male on futa', '男攻扶她'],
      ['hair bobbles', '头绳'],
      ['enpera', '鱿鱼头'],
      ['furry', '福瑞'],
    ]
    for (const [n, zh] of fixed) expect(T(n).zh, n).toBe(zh)
    for (const [n, zh] of [['can', '罐子'], ['kettle', '水壶'], ['wooden bucket', '木桶'], ['arm garter', '臂环']] as const) expect(T(n).zh, n).toBe(zh)
  })
  it('基础词用中文圈常用的叫法，不用生僻的直译 / 音译，整族跟着', () => {
    const common: [string, string][] = [
      ['buruma', '体操短裤'],
      ['slingshot swimsuit', 'V字泳衣'],
      ['bodystocking', '连体袜'],
      ['bridal gauntlets', '新娘手套'],
      ['circlet', '头环'],
    ]
    for (const [n, zh] of common) expect(T(n).zh, n).toBe(zh)
    expect(T('red buruma').zh).toBe('红色体操短裤')
    expect(T('buruma pull').zh).toBe('拉体操短裤')
    expect(T('red slingshot swimsuit').zh).toBe('红色V字泳衣')
  })
  it('颜文字的中文名是「颜文字（表情）」，意思名也搜得到；符号照旧写意思', () => {
    const kaomoji: [string, string][] = [
      ['x3', 'x3（表情）'],
      [':d', ':d（表情）'],
      ['^_^', '^_^（表情）'],
      ['=_=', '=_=（表情）'],
      ['6_9', '6_9（表情）'],
      ['\\o/', '\\o/（表情）'],
      ['double \\m/', '双手\\m/（表情）'],
      ['uu~', 'uu~（表情）'],
      ['open \\m/', '\\||/（表情）'],
    ]
    for (const [n, zh] of kaomoji) expect(T(n).zh, n).toBe(zh)
    expect(names(search('眯眼笑'))[0]).toBe('^_^')
    expect(names(search('开口笑'))[0]).toBe(':d')
    expect(T('\\m/').zhAlt).not.toContain('摇滚手势')
    for (const [n, zh] of [['^^^', '惊吓线'], ['!?', '感叹问号'], ['...', '省略号']] as const) expect(T(n).zh, n).toBe(zh)
  })
})
