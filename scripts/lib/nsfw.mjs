import { existsSync, readFileSync } from 'node:fs'

export const LEVELS = ['全年龄', '擦边', 'R18', 'R18G']
const MIN_N = 30
const R18_QE = 0.5
const EDGE_S = 0.6
const R18_WORDS = /\b(nipples?|areolae?|penis(es)?|pussy|vagina|vaginal|anal|anus|cum|semen|sex|nude|naked|erection|testicles?|fellatio|paizuri|cunnilingus|masturbat\w*|orgasm|ejaculat\w*|genitals?|pubic|crotchless|bottomless|topless|dildo|vibrator)\b/

const rows = (file) =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => l.split('\t'))
    : []

/** s measures sensitive share only since June 2022; earlier 's' means safe, while qe and n use all posts. */
export function loadRatings(file = 'data/tags/ratings.tsv') {
  const out = new Map()
  for (const [t, ...c] of rows(file)) {
    const v = c.map(Number)
    const n = v[0] + v[1] + v[2] + v[3]
    const n2 = v[4] + v[5] + v[6] + v[7]
    out.set(t, { n, qe: n ? (v[2] + v[3]) / n : 0, s: n2 >= MIN_N ? v[5] / n2 : undefined })
  }
  return out
}

export const loadNsfwOverrides = (file = 'data/tags/nsfw.tsv') => new Map(rows(file).slice(1).filter((r) => LEVELS.includes(r[1])))

export function keepAdultSecondary(name, ratings, overrides) {
  const o = overrides.get(name)
  if (o) return o === 'R18' || o === 'R18G'
  const r = ratings.get(name)
  return !r || r.n < MIN_N || r.qe >= R18_QE
}

/** atomsOf returns the primary atom first; changing that order changes classification precedence. */
export function computeLevels({ names, atomsOf, domainOf, up, ratings = loadRatings(), overrides = loadNsfwOverrides() }) {
  const out = new Map()
  const direct = (t) => {
    const o = overrides.get(t)
    if (o) return o
    const atoms = atomsOf(t)
    if (atoms.some((a) => domainOf(a) === 'R18G')) return 'R18G'
    if (atoms.length && domainOf(atoms[0]) === 'R18') return 'R18'
    const r = ratings.get(t)
    if (r && r.n >= MIN_N) return r.qe >= R18_QE ? 'R18' : r.s !== undefined && r.s >= EDGE_S ? '擦边' : '全年龄'
    return undefined
  }
  const memo = new Map()
  const viaUp = (t, seen = new Set()) => {
    if (memo.has(t)) return memo.get(t)
    const d = direct(t)
    if (d) return memo.set(t, d).get(t)
    if (seen.has(t)) return undefined
    seen.add(t)
    let best
    for (const p of up.get(t) ?? []) {
      const l = viaUp(p, seen)
      if (l && (!best || LEVELS.indexOf(l) > LEVELS.indexOf(best))) best = l
    }
    if (!best && (atomsOf(t).some((a) => domainOf(a) === 'R18') || R18_WORDS.test(t))) best = 'R18'
    memo.set(t, best)
    return best
  }
  for (const t of names) out.set(t, viaUp(t) ?? '全年龄')
  return out
}
