function plain(s: string): string {
  return s
    .replace(/\[\[([^\]|]+)\|([^\]]*)\]\]/g, (_, a: string, b: string) => b || a)
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\{\{([^}]+)\}\}/g, '$1')
    .replace(/"([^"]+)":\[?[^\s\]]+\]?/g, '$1')
    .replace(/\[\/?(?:b|i|u|s|tn|spoiler|nodtext|code)\]/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function wikiLead(body: string, max = 3): string[] {
  const head = body.split(/\r?\n(?=\s*(?:h[1-6]\.|\[expand|\[section|\* !post|!post))/i)[0]
  return head
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p && !/^[*#]\s/.test(p) && !/^h[1-6]\./i.test(p))
    .map(plain)
    .filter(Boolean)
    .slice(0, max)
}

export interface Compound {
  kind: 'color' | 'pattern' | 'state' | 'holding' | 'cosplay'
  mod: string
  base: string
}

const C = 'red|blue|green|yellow|orange|purple|pink|brown|black|white|grey|gray|aqua|silver|gold|golden|beige|multicolored|two-tone|rainbow'
const COLOR = new RegExp(`^((?:(?:light|dark) )?(?:${C})(?:-(?:${C}))?) (.+)$`)
const PATTERN = /^(striped|vertical-striped|horizontal-striped|diagonal-striped|plaid|polka dot|checkered|argyle|houndstooth|camouflage|leopard print|animal print|floral print|print|frilled|lace-trimmed) (.+)$/
const STATE = /^(open|torn|wet|unbuttoned|partially unbuttoned|unzipped|partially unzipped|untied|loose|undone) (.+)$/
const ITEM = new Set(['服装', '物品'])
const HELD = new Set(['服装', '物品', '生物'])

export function compoundOf(name: string, domainOf: (n: string) => string | undefined): Compound | null {
  let m = name.match(/^(.+) \(cosplay\)$/)
  if (m) return { kind: 'cosplay', mod: 'cosplay', base: m[1] }
  m = name.match(/^(holding) (.+)$/)
  if (m && HELD.has(domainOf(m[2]) ?? '')) return { kind: 'holding', mod: m[1], base: m[2] }
  for (const [kind, re] of [
    ['color', COLOR],
    ['pattern', PATTERN],
    ['state', STATE],
  ] as const) {
    m = name.match(re)
    if (m && ITEM.has(domainOf(m[2]) ?? '')) return { kind, mod: m[1], base: m[2] }
  }
  return null
}

export const hasDisambig = (text: string) => /confus|\binstead\b(?! of)|rather than|as opposed to|not the same as|different from|distinguish/i.test(text)

export function glossLen(s: string): number {
  return s.replace(/[A-Za-z0-9_'()\-:.!?/^]+/g, 'w').replace(/\s+/g, '').length
}

export const MAX_GLOSS = 80
const BANNED = /该标签|此标签|这个标签|本标签|该 ?tag|这个 ?tag|此 ?tag|本 ?tag|打标|标注|弃用/i
export function englishIn(s: string): string[] {
  return (s.match(/(?:[A-Za-z0-9^]|[:;](?=[A-Za-z0-9()]))[A-Za-z0-9_'()\-:;.!?/^ ]*/g) ?? []).map((x) => x.trim().replace(/[.:!?]+$/, '')).filter(Boolean)
}
const NOT_TAG = /^[A-Z0-9]{1,3}$|^\d+(?:\.\d+)?$/

export function checkGloss(zh: string, known: (en: string) => boolean): string[] {
  const out: string[] = []
  if (!zh) return out
  if (/\t/.test(zh)) out.push('多了 TAB')
  const n = glossLen(zh)
  if (n > MAX_GLOSS) out.push(`${n} 字，超过 ${MAX_GLOSS}`)
  const bad = zh.match(BANNED)
  if (bad) out.push(`有「${bad[0]}」`)
  for (const en of englishIn(zh)) if (!NOT_TAG.test(en) && !known(en.toLowerCase())) out.push(`「${en}」不在 tag 库里`)
  return out
}

export function checkBlock(want: string[], got: string[][]): string[] {
  const out: string[] = []
  if (got.length !== want.length) out.push(`行数 ${got.length} ≠ ${want.length}`)
  for (let i = 0; i < Math.min(got.length, want.length) && out.length < 5; i++) {
    if (got[i][0] !== want[i]) out.push(`第 ${i + 1} 行英文「${got[i][0]}」≠「${want[i]}」`)
    else if (got[i].length < 2) out.push(`第 ${i + 1} 行没有 TAB`)
  }
  return out
}

/** wiki.json.gz rows are [tag, gloss]; parts are [compound tag, modifier, base tag]. */
export interface WikiZhFile {
  v: 1
  rows: [string, string][]
  parts: [string, string, string][]
}

export type Gloss = { text: string } | { mod: string; base: string; text?: string }

export interface WikiZh {
  gloss(name: string): Gloss | undefined
}

export function parseWikiZh(f: WikiZhFile): WikiZh {
  const rows = new Map(f.rows)
  const parts = new Map(f.parts.map(([n, mod, base]) => [n, { mod, base }]))
  return {
    gloss(name) {
      const t = rows.get(name)
      if (t) return { text: t }
      const p = parts.get(name)
      if (!p) return undefined
      const b = rows.get(p.base)
      return b ? { ...p, text: b } : p
    },
  }
}
