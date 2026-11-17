import { existsSync, readFileSync } from 'node:fs'
import { computeLevels, keepAdultSecondary, loadNsfwOverrides, loadRatings } from './nsfw.mjs'
import { norm } from './universe.mjs'

export const DIR = 'data/tags/tree'
const tsv = (file) =>
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .slice(1)
    .map((l) => l.split('\t'))

export const atoms = new Map(tsv(`${DIR}/atoms.tsv`).map(([a, d, note]) => [a, { domain: d, note }]))
const isAdult = (a) => ['R18', 'R18G'].includes(atoms.get(a)?.domain)
export const lists = {}
for (const k of ['a', 'b', 'c']) {
  const used = new Set()
  for (const line of readFileSync(`${DIR}/${k}.txt`, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || line.startsWith('//')) continue
    for (const tok of line.split(',').map((s) => s.trim()))
      if (tok.startsWith('@')) {
        if (!atoms.has(tok.slice(1))) throw new Error(`${k}.txt 里的 ${tok} 不在 atoms.tsv`)
        used.add(tok.slice(1))
      }
  }
  const missing = [...atoms.keys()].filter((a) => !used.has(a))
  if (missing.length) throw new Error(`${k}.txt 少了原子：${missing.join('、')}`)
  lists[k] = used
}

export function assignTree(tags) {
  const assigned = new Map()
  const unsure = new Set()
  const put = (name, list, via) => {
    if (!tags.has(name) || assigned.has(name) || unsure.has(name) || !list.length) return
    assigned.set(name, { atoms: [...new Set(list)], via })
  }
  for (const [t, a] of tsv(`${DIR}/overrides.tsv`)) {
    if (a.trim() === '?') {
      unsure.add(t)
      continue
    }
    const list = a.split(',').map((s) => s.trim())
    for (const x of list) if (!atoms.has(x)) throw new Error(`overrides.tsv：${t} 的 ${x} 不在 atoms.tsv`)
    if (!tags.has(t)) console.warn(`overrides.tsv：${t} 不在 tag 库`)
    put(t, list, '手写')
  }
  const naiRows = readFileSync('data/tags/nai.tsv', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('\t'))
  for (const [name, , , group] of naiRows) {
    if (/^(year \d{4}|rating:\w+)$/.test(name)) put(name, ['年份分级'], 'NAI')
    else if (group === '质量') put(name, ['质量美学'], 'NAI')
  }

  const COLOR = 'aqua|black|blonde|blue|brown|green|grey|gray|orange|pink|purple|red|silver|white|yellow|light blue|light brown|light purple|light green|dark blue|dark green|dark red|platinum blonde|lavender|beige|gold|golden|teal|magenta|violet'
  const w = (s) => new RegExp(`(^| )(${s})$`)
  const STRONG = [
    [/^holding( |$)/, '拿着'],
    [new RegExp(`^(${COLOR}) hair$`), '发色'],
    [/^(multicolored|gradient|streaked|two-tone|split-color|colored inner|colored tips|rainbow) hair$/, '挑染渐变'],
    [new RegExp(`^(${COLOR}) (eyes|pupils)$`), '眼睛颜色'],
    [/ background$/, '背景处理'],
    [/ focus$/, '焦点'],
    [/^looking (at|away|back|down|up|to|ahead|afar|outside|over|through|in)( |$)/, '视线'],
    [/^from (above|below|side|behind|outside)$/, '视角'],
    [w('skirt|miniskirt|microskirt'), '裙'],
    [w('dress|sundress|gown'), '连衣裙'],
    [/^wet (clothes|shirt|t-shirt|dress|skirt|swimsuit|one-piece swimsuit|school swimsuit|panties|pants|shorts|socks|thighhighs|pantyhose|legwear|kimono|bra|leotard|bikini|school uniform|serafuku|apron|jacket|coat|hoodie|sweater|towel|uniform|underwear)$/, '穿着状态'],
    [w('lab coat|nurse cap'), '职业装'],
    [w('shirt|blouse|sweater|hoodie|t-shirt|tank top|crop top|camisole|turtleneck|tube top|sweatshirt|tunic'), '上衣'],
    [w('jacket|coat|vest|cardigan|blazer|parka|raincoat|cloak|cape'), '外套'],
    [w('pants|shorts|jeans|trousers|bloomers|buruma'), '裤'],
    [w('thighhighs|pantyhose|socks|kneehighs|stockings|legwear|leggings'), '袜'],
    [w('boots|shoes|sandals|high heels|heels|slippers|sneakers|loafers|footwear|geta|zouri'), '鞋'],
    [w('gloves|mittens'), '手套'],
    [w('hat|beret|beanie|headwear|cap'), '帽子'],
    [w('hairband|hairclip|hair ornament|hair ribbon|hair bow|hair flower|headband|headdress|scrunchie|hairpin|kanzashi|hair tie|hair bobbles|hair beads'), '头饰发饰'],
    [w('helmet|crown|tiara|circlet'), '头盔冠冕'],
    [w('glasses|sunglasses|goggles|eyewear|monocle'), '眼镜'],
    [w('mask|eyepatch|blindfold'), '面具眼罩'],
    [w('earrings|earring|ear piercing|earmuffs'), '耳饰'],
    [w('necktie|bowtie|neckerchief|ascot|neck ribbon'), '领饰'],
    [w('choker|necklace|pendant'), '颈饰'],
    [w('scarf|shawl|stole|capelet'), '围巾披肩'],
    [w('bracelet|wristband|armband|wrist cuffs|bangle|wristwatch'), '手饰'],
    [/^(watch|digital watch|smartwatch)$/, '手饰'],
    [w('belt|sash|obi|waist bow'), '腰饰'],
    [w('anklet|anklets'), '腿饰'],
    [/^(buttons|large buttons|zipper|zipper pull tab|pocket|pockets|buckle|o-ring)$/, '款式细节'],
    [w('bikini|swimsuit|swim briefs'), '泳装'],
    [w('leotard|bodysuit|jumpsuit|unitard|bodystocking|plugsuit'), '连体紧身'],
    [w('bra'), '内衣（上）'],
    [w('panties|thong|boxers|briefs|fundoshi'), '内衣（下）'],
    [w('kimono|yukata|hakama|hanfu|qipao|haori|dirndl|hanbok|ao dai|sari'), '传统民族'],
    [w('uniform|serafuku|gakuran'), '制服'],
    [w('apron'), '职业装'],
    [w('pajamas|nightgown|bathrobe'), '睡衣家居'],
    [w('armor'), '戏服铠甲'],
    [w('sleeves'), '袖子'],
    [w('bag|backpack|handbag|satchel|randoseru'), '包与随身'],
    [/(^| )(animal|cat|dog|fox|wolf|rabbit|bear|horse|cow|mouse|tiger|lion|raccoon|squirrel|goat|sheep|deer|monkey|bat|pig|leopard|hamster|ferret|otter|jaguar|cheetah|panda|lop rabbit|fake animal|extra) ears$/, '兽耳'],
    [/ tail$/, '尾巴'],
    [/ horns?$/, '角'],
    [/ wings$/, '翅膀'],
    [w('sword|katana|dagger|knife|spear|polearm|axe|scythe|halberd|lance|rapier|saber|sabre|naginata|mace'), '冷兵器'],
    [w('gun|rifle|handgun|pistol|shotgun|revolver|submachine gun|machine gun|cannon|rocket launcher|grenade'), '枪械火器'],
    [/^\d{4}s \(style\)$/, '年代画风'],
    [/ commentary$/, '站务'],
    [/^(official )?alternate /, '变装改动'],
    [/ nails$/, '妆容'],
    [/ halo$|^extra (arms|eyes|ears|mouths?|faces?|heads?|hands|legs|tails|digits|fingers|toes)$/, '光环与异形部位'],
    [/(^| )vore$|^unbirthing$/, '吞食'],
    [/^[!?]+$|^\.\.\.[!?]?$/, '漫画符号'],
    [/^(spring|summer|autumn|winter)( \(season\))?$/, '季节节日'],
    [/(^| )parody$/, '仿作'],
    [/^(sunlight|moonlight|candlelight|starlight|firelight|lamplight|torchlight|spotlight)$/, '光源'],
    [/(^| )(cafe|restaurant|shop|store|hospital|library|office|bar \(place\)|izakaya|tavern|arcade|casino|nightclub|museum|art gallery|bakery|bookstore|supermarket)$/, '公共室内'],
    [/^(mole|scar|tattoo)( |$)| tattoo$/, '痣疤纹身'],
    [/ cutout$| trim$/, '款式细节'],
    [/^(muscular|toned)( |$)/, '体型'],
    [/ teeth( only)?$/, '嘴型'],
    [/^stuffed /, '玩具游戏'],
    [/^spoken /, '漫画符号'],
    [/ blush$|^nosebleed$/, '脸红泪水'],
    [/^(demon|monster|dragon|fox|cat|horse|rabbit|wolf|dog|bear|cow|mouse|tiger|lion|raccoon|squirrel|sheep|goat|deer|bat|snake|lamia|harpy|slime|plant|bird|fish|shark|frog|bee|spider|insect|robot|ghost|zombie|skeleton|angel|fairy|elf|dark elf|vampire|mermaid|oni|kitsune|tanuki|centaur|alien|cyborg|doll|pig|monkey|lizard|owl|jiangshi|succubus|kemonomimi) (girl|boy|man|woman|musume)$/, '种族'],
  ]
  for (const t of tags.values()) {
    const hit = STRONG.find(([re]) => re.test(t.name))
    if (hit) put(t.name, [hit[1]], '名字')
  }

  const LINK = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\][a-z]*/i
  const subjectLinks = (line) => {
    const m = line.trim().match(/^[*#]+\s*(.*)$/)
    if (!m) return []
    let rest = m[1].replace(/^(!(post|asset) #\d+:\s*|†|\[\/?[bi]\]|<\/?b>|\s)+/, '')
    const at = rest.indexOf('[[')
    if (at < 0) return []
    if (at > 0) {
      const pre = rest.slice(0, at)
      if (/\.\s*$/.test(rest) || pre.trim().split(/\s+/).length >= 3 || /[([]/.test(pre)) return []
      rest = rest.slice(at)
    }
    const out = []
    for (;;) {
      const l = rest.match(LINK)
      if (!l) break
      out.push(l[1])
      rest = rest.slice(l[0].length).replace(/^(\[\/?[bi]\]|<\/?b>|†|\s)*/i, '')
      const sep = rest.match(/^(\/|,|and |or |&)\s*/)
      if (!sep) break
      rest = rest.slice(sep[0].length)
    }
    return out
  }
  const secKey = (s) =>
    s
      .replace(/\[\/?[bi]\]/g, '')
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, (_, a, b) => b || a)
      .replace(/\[\[|\]\]/g, '')
      .replace(/^.*\|/, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  const map = tsv(`${DIR}/danbooru-map.tsv`).map(([page, sec, atom], rank) => ({ page, sec: sec === '*' ? '*' : secKey(sec), atom, rank }))
  for (const m of map) if (m.atom !== '-' && !atoms.has(m.atom)) throw new Error(`danbooru-map.tsv：${m.atom} 不在 atoms.tsv`)
  const pages = [...JSON.parse(readFileSync('data/raw/danbooru/tag-groups.json', 'utf8')), ...JSON.parse(readFileSync('data/raw/danbooru/lists.json', 'utf8'))]
  const cands = new Map()
  const unmapped = new Map()
  for (const p of pages) {
    const page = p.title.replace('tag_group:', '')
    let sec = '(top)'
    const rule = () => map.find((m) => m.page === page && m.sec === secKey(sec)) ?? map.find((m) => m.page === page && m.sec === '*')
    let cur = rule()
    const add = (links) => {
      for (const link of links) {
        const t = norm(link)
        if (t.includes(':') || t.startsWith('list of') || !tags.has(t)) continue
        ;(cands.get(t) ?? cands.set(t, []).get(t)).push(cur)
      }
    }
    for (const line of p.body.split('\n')) {
      const h = line.match(/^h[1-6](?:#[^.\s]+)?\.\s*(.+)/)
      if (h) {
        sec = h[1].trim()
        cur = rule()
        if (cur && cur.atom !== '-' && sec.startsWith('[[')) add(subjectLinks(`* ${sec}`))
        continue
      }
      if (!cur) {
        if (/\[\[/.test(line)) unmapped.set(page, (unmapped.get(page) ?? 0) + 1)
        continue
      }
      if (cur.atom !== '-') add(subjectLinks(line))
    }
  }
  const adultExtra = new Map()
  for (const [t, list] of cands) {
    list.sort((a, b) => a.rank - b.rank)
    const safe = list.filter((c) => !isAdult(c.atom))
    const adult = [...new Set(list.filter((c) => isAdult(c.atom)).map((c) => c.atom))]
    adultExtra.set(t, adult)
    put(t, safe.length ? [safe[0].atom, ...adult] : adult, 'Danbooru')
  }
  for (const [t, extra] of adultExtra) {
    const a = assigned.get(t)
    if (a && a.via !== 'Danbooru' && a.via !== '手写') for (const x of extra) if (!a.atoms.includes(x)) a.atoms.push(x)
  }

  // The '?' assignment sentinel means deliberately unclassifiable; later inference must not overwrite it.
  if (existsSync(`${DIR}/assign.tsv`))
    for (const [t, a] of tsv(`${DIR}/assign.tsv`)) {
      if (a === '?') unsure.add(t)
      else put(t, a.split(',').map((s) => s.trim()), '分类表')
    }

  const up = new Map()
  const down = new Map()
  for (const r of JSON.parse(readFileSync('data/raw/danbooru/implications.json', 'utf8'))) {
    const a = norm(r.antecedent_name)
    const c = norm(r.consequent_name)
    ;(up.get(a) ?? up.set(a, []).get(a)).push(c)
    ;(down.get(c) ?? down.set(c, []).get(c)).push(a)
  }
  for (let round = 0; round < 6; round++) {
    let n = 0
    for (const t of tags.values()) {
      if (assigned.has(t.name) || unsure.has(t.name)) continue
      const parents = (up.get(t.name) ?? []).filter((p) => assigned.has(p)).sort((a, b) => (tags.get(b)?.count ?? 0) - (tags.get(a)?.count ?? 0))
      if (!parents.length) continue
      const list = [...new Set(parents.map((p) => assigned.get(p).atoms[0]))].slice(0, 2)
      put(t.name, list, '蕴含')
      n++
    }
    if (!n) break
  }

  const WEAK = [
    [/ \(medium\)$/, '媒介'],
    [/ \(style\)$/, '仿作'],
    [/ theme$/, '单色限色'],
    [/ text$/, '文字对白'],
    [/ print$/, '图案'],
    [/^(striped|plaid|polka dot|checkered|argyle|houndstooth|camouflage|floral|frilled|lace-trimmed|fur-trimmed) /, '图案'],
    [/(^| )(ring)$/, '手饰'],
    [/(^| )(cup|mug|bottle|plate|bowl|teapot|teacup|chopsticks|spoon|fork|tray)$/, '餐具容器'],
    [/(^| )(flower|flowers|rose|lily|tulip|sunflower|lotus|hibiscus|daisy|carnation|hydrangea|camellia|petals)$/, '花'],
    [/(^| )(tree|leaf|leaves|grass|plant|bamboo|vines|branch|moss|bush)$/, '植物'],
    [/(^| )(cat|kitten)$/, '猫'],
    [/(^| )(dog|puppy)$/, '狗'],
    [/(^| )bird$/, '鸟'],
    [/(^| )fish$/, '水生动物'],
    [/(^| )sky$/, '天空宇宙'],
    [/ (lighting|light)$/, '光效'],
    [/(^| )food$/, '食物'],
    [/(^| )(chair|bed|table|desk|couch|sofa|pillow|cushion|blanket|futon|curtains|window|bench|shelf|bookshelf|lamp|stool|throne|bedroom furniture|wardrobe|carpet|rug|tatami|kotatsu)$/, '家具家居'],
    [/(^| )(book|books|open book|notebook|pen|pencil|paper|letter|envelope|scroll|newspaper|diary|sketchbook|stationery|eraser|ruler)$/, '书本文具'],
    [/(^| )(staff|wand|magic circle|magic|crystal ball|orb|grimoire|spell book|tarot|talisman|ofuda)$/, '魔法道具'],
    [/(^| )(latex|leather|denim|fur|silk|satin|velvet|knit|mesh|plastic|metal)$/, '材质'],
    [/ hair$/, '发质造型'],
    [/ eyes$/, '眼型瞳孔'],
  ]
  for (const t of tags.values()) {
    if (assigned.has(t.name) || unsure.has(t.name)) continue
    const hit = WEAK.find(([re]) => re.test(t.name))
    if (hit) put(t.name, [hit[1]], '名字（弱）')
  }

  for (const t of tags.values()) {
    if (assigned.has(t.name) || unsure.has(t.name)) continue
    const votes = {}
    let total = 0
    for (const c of down.get(t.name) ?? []) {
      const a = assigned.get(c)
      if (!a) continue
      const wt = tags.get(c)?.count ?? 1
      votes[a.atoms[0]] = (votes[a.atoms[0]] ?? 0) + wt
      total += wt
    }
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]
    if (best && best[1] / total >= 0.6) put(t.name, [best[0]], '子 tag')
  }

  const ratings = loadRatings()
  const nsfwOverrides = loadNsfwOverrides()
  let dropped = 0
  for (const [name, a] of assigned) {
    const keep = a.atoms.filter((x, i) => i === 0 || !isAdult(x) || keepAdultSecondary(name, ratings, nsfwOverrides))
    dropped += a.atoms.length - keep.length
    a.atoms = keep
  }
  const levels = computeLevels({ names: tags.keys(), atomsOf: (t) => assigned.get(t)?.atoms ?? [], domainOf: (x) => atoms.get(x)?.domain, up, ratings, overrides: nsfwOverrides })

  return { assigned, unsure, levels, unmapped, dropped, cands }
}
