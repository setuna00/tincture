// Match NovelAI filename syntax: {token|filter:value}, '{{' for a literal '{', and an 80-character default prompt prefix.

export const DEFAULT_FILENAME_TEMPLATE = '{prompt} s-{seed}'

export const FILENAME_TOKENS = ['prompt', 'name', 'seed', 'date', 'time', 'model', 'modelname', 'resolution', 'width', 'height', 'index', 'id', 'type', 'characters'] as const
type TokenName = (typeof FILENAME_TOKENS)[number]

const TEXT_FILTERS = { first: 'positiveInt', last: 'positiveInt', words: 'nonzeroInt', tags: 'nonzeroInt', pre: 'text', suf: 'text', pad: 'positiveInt', lower: 'none', upper: 'none' } as const
/** NovelAI requires character filters before text filters for {characters}. */
const CHAR_FILTERS = { max: 'positiveInt', at: 'positiveInt', each: 'positiveInt', join: 'text', full: 'none' } as const
type ArgKind = 'positiveInt' | 'nonzeroInt' | 'text' | 'none'

export class TemplateError extends Error {}

interface Filter {
  name: string
  arg?: string
}
type Part = { kind: 'text'; text: string } | { kind: 'token'; name: TokenName; filters: Filter[] }

const int = (s: string | undefined) => (s !== undefined && /^-?\d+$/.test(s.trim()) ? Number.parseInt(s.trim(), 10) : undefined)

function checkArg(name: string, kind: ArgKind, arg: string | undefined) {
  if (kind === 'none' && arg !== undefined) throw new TemplateError(`过滤器「${name}」不接受值`)
  if (kind === 'text' && arg === undefined) throw new TemplateError(`过滤器「${name}」需要一个值，如「${name}:-」`)
  if (kind === 'positiveInt' && !((int(arg) ?? 0) > 0)) throw new TemplateError(`过滤器「${name}」需要正整数`)
  if (kind === 'nonzeroInt' && !int(arg)) throw new TemplateError(`过滤器「${name}」需要非零整数`)
}

function parseToken(body: string): Part {
  const [head, ...rest] = body.split('|')
  const name = head.trim()
  if (!(FILENAME_TOKENS as readonly string[]).includes(name)) throw new TemplateError(`未知的 token「{${name}}」`)
  const chars = name === 'characters'
  let textStarted = !chars
  const filters: Filter[] = []
  for (const f of rest) {
    const at = f.indexOf(':')
    const fname = (at < 0 ? f : f.slice(0, at)).trim()
    const arg = at < 0 ? undefined : f.slice(at + 1)
    const tk = TEXT_FILTERS[fname as keyof typeof TEXT_FILTERS] as ArgKind | undefined
    const ck = CHAR_FILTERS[fname as keyof typeof CHAR_FILTERS] as ArgKind | undefined
    if (!tk && !ck) throw new TemplateError(`未知的过滤器「${fname}」`)
    if (!tk) {
      if (!chars) throw new TemplateError(`过滤器「${fname}」仅用于 {characters}`)
      if (textStarted) throw new TemplateError(`过滤器「${fname}」需写在 first、pre 等文字过滤器前面`)
    } else textStarted = true
    checkArg(fname, (tk ?? ck)!, arg)
    filters.push({ name: fname, arg })
  }
  return { kind: 'token', name: name as TokenName, filters }
}

export function parseTemplate(t: string): Part[] {
  const out: Part[] = []
  let text = ''
  let i = 0
  while (i < t.length) {
    const c = t[i]
    if (c === '{') {
      if (t[i + 1] === '{') {
        text += '{'
        i += 2
        continue
      }
      const end = t.indexOf('}', i)
      if (end < 0) throw new TemplateError(`第 ${i + 1} 个字符处的「{」未闭合`)
      if (text) {
        out.push({ kind: 'text', text })
        text = ''
      }
      out.push(parseToken(t.slice(i + 1, end)))
      i = end + 1
      continue
    }
    text += c
    i++
  }
  if (text) out.push({ kind: 'text', text })
  return out
}

function textFilter(v: string, f: Filter): string {
  const n = int(f.arg) ?? 0
  switch (f.name) {
    case 'first':
      return [...v].slice(0, n).join('')
    case 'last':
      return [...v].slice(-n).join('')
    case 'words': {
      const w = v.split(/\s+/).filter(Boolean)
      return (n > 0 ? w.slice(0, n) : w.slice(n)).join(' ')
    }
    case 'tags': {
      const t = v
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
      return (n > 0 ? t.slice(0, n) : t.slice(n)).join(', ')
    }
    case 'pre':
      return v === '' ? '' : (f.arg ?? '') + v
    case 'suf':
      return v === '' ? '' : v + (f.arg ?? '')
    case 'pad':
      return /^\d+$/.test(v) ? v.padStart(n, '0') : v
    case 'lower':
      return v.toLowerCase()
    case 'upper':
      return v.toUpperCase()
  }
  return v
}

export interface FilenameMeta {
  prompt?: string
  name?: string
  seed?: number
  date?: Date
  model?: string
  width?: number
  height?: number
  index?: number
  id?: string
  type?: string
  characters?: { name?: string; prompt: string }[]
}

const MODEL_SHORT: Record<string, string> = {
  'nai-diffusion-5-curated': 'V5 Curated',
  'nai-diffusion-5-full': 'V5 Full',
  'nai-diffusion-5-full-medium': 'V5 Full Medium',
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const hms = (d: Date) => `${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`

function tokenValue(name: TokenName, m: FilenameMeta): string {
  switch (name) {
    case 'prompt':
      return m.prompt ?? ''
    case 'name':
      return m.name ?? ''
    case 'seed':
      return m.seed === undefined ? '' : String(m.seed)
    case 'date':
      return m.date ? ymd(m.date) : ''
    case 'time':
      return m.date ? hms(m.date) : ''
    case 'model':
      return m.model ?? ''
    case 'modelname':
      return m.model ? (MODEL_SHORT[m.model] ?? m.model) : ''
    case 'resolution':
      return m.width && m.height ? `${m.width}x${m.height}` : ''
    case 'width':
      return m.width ? String(m.width) : ''
    case 'height':
      return m.height ? String(m.height) : ''
    case 'index':
      return m.index === undefined ? '' : String(m.index + 1)
    case 'id':
      return m.id ?? ''
    case 'type':
      return m.type ?? ''
  }
  return ''
}

const GENDER_WORDS = new Set(['girl', 'female', 'boy', 'male', '1girl', '1boy'])
function charactersValue(filters: Filter[], list: NonNullable<FilenameMeta['characters']>): string {
  let max: number | undefined
  let at: number | undefined
  let each: number | undefined
  let full = false
  let join = '+'
  let v: string | undefined
  const names = () => {
    const picked = at === undefined ? list.slice(0, max ?? 3) : list[at - 1] ? [list[at - 1]] : []
    let out = picked.map((c) => {
      if (full) return c.prompt.trim()
      if (c.name) return c.name
      const tags = c.prompt
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
      return tags.length === 0 ? '' : GENDER_WORDS.has(tags[0].toLowerCase()) ? (tags[1] ?? tags[0]) : tags[0]
    })
    if (each !== undefined) out = out.map((x) => [...x].slice(0, each).join(''))
    return out.filter((x) => x.length > 0).join(join)
  }
  for (const f of filters) {
    if (v === undefined && !(f.name in TEXT_FILTERS)) {
      if (f.name === 'full') full = true
      else if (f.name === 'max') max = int(f.arg)
      else if (f.name === 'at') at = int(f.arg)
      else if (f.name === 'each') each = int(f.arg)
      else if (f.name === 'join') join = f.arg ?? ''
      continue
    }
    if (v === undefined) v = names()
    v = textFilter(v, f)
  }
  return v ?? names()
}

const clean = (s: string) => {
  const t = s.replace(/[\n\r"%*/:<>?\\|]/g, '_').trim()
  return [...t].length > 180 ? [...t].slice(0, 180).join('').trim() : t
}

export function renderFilename(template: string, m: FilenameMeta): string {
  let out = ''
  for (const p of parseTemplate(template)) {
    if (p.kind === 'text') {
      out += p.text
      continue
    }
    if (p.name === 'characters') {
      out += charactersValue(p.filters, m.characters ?? [])
      continue
    }
    let v = tokenValue(p.name, m)
    // NovelAI truncates {prompt} to 80 characters unless a slice filter is specified.
    if (p.name === 'prompt' && !p.filters.some((f) => ['first', 'last', 'words', 'tags'].includes(f.name))) v = [...v].slice(0, 80).join('')
    for (const f of p.filters) v = textFilter(v, f)
    out += v
  }
  return clean(out)
}

export const defaultFilename = (prompt: string, seed: number | undefined) => `${[...prompt].slice(0, 80).join('')} s-${seed ?? ''}`.replace(/["%*/:<>?\\|]/g, '_')

export function buildFilename(m: FilenameMeta, template: { on: boolean; text: string }): string {
  if (template.on) {
    try {
      const name = renderFilename(template.text || DEFAULT_FILENAME_TEMPLATE, m)
      if (name !== '') return name
    } catch {
    }
  }
  return defaultFilename(m.prompt ?? '', m.seed)
}
