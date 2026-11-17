import { describe, expect, it } from 'vitest'
import { decodeAliases, decodeLookup, type LookupFile } from './tag-data'
import { glossTarget } from './tag-gloss'
import { parseWikiZh, type WikiZhFile } from './wiki-zh'
import type { Chip, TagEntry } from '@/types'

const { readFileSync } = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { readFileSync(p: URL): Uint8Array }
const { gunzipSync } = (await import(/* @vite-ignore */ `node:${'zlib'}`)) as { gunzipSync(b: Uint8Array): Uint8Array }
const gz = <T>(file: string) => JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(new URL(`../assets/tags/${file}.json.gz`, import.meta.url))))) as T

const LK = gz<LookupFile>('lookup')
const ROWS = decodeLookup(LK)
const byName = new Map(ROWS.map((t) => [t.name, t]))
const lookup = (n: string) => byName.get(n.toLowerCase())
const alias = decodeAliases(LK)
const zh = parseWikiZh(gz<WikiZhFile>('wiki'))
const tree = gz<{ renamed: [number, number][] }>('tree')
const renamedTo = new Map(tree.renamed.map(([a, b]) => [LK.rows[a][0], LK.rows[b][0]]))

const chip = (text: string, type: Chip['type'] = 'tag') => ({ text, type })
const baseOf = (c: Pick<Chip, 'type' | 'text'>) => (lookup(c.text) ? c.text : (alias.get(c.text.toLowerCase()) ?? null))
const target = (text: string, type: Chip['type'] = 'tag') => glossTarget(chip(text, type), baseOf(chip(text, type)), lookup)

describe('tag 面板的释义按哪个 tag 取', () => {
  it('官方 tag 是它自己（大小写跟库里的），interaction（source#hug）按 tag 本身', () => {
    expect(target('Cherry Blossoms')).toEqual({ name: 'cherry blossoms', nai: false, renamed: false })
    expect(target('hug', 'interaction')?.name).toBe('hug')
    expect(zh.gloss('cherry blossoms')).toHaveProperty('text')
  })
  it('Danbooru 别名用正式写法的释义（smiling → smile）', () => {
    expect(target('smiling')).toEqual({ name: 'smile', nai: false, renamed: false })
    expect(zh.gloss('smile')).toHaveProperty('text')
  })
  it('改了名的旧写法要换成新名字：释义包里只有新名字（twintail → twintails）', () => {
    expect(target('twintail')).toEqual({ name: 'twintail', nai: false, renamed: true })
    expect(renamedTo.get('twintail')).toBe('twintails')
    expect(zh.gloss('twintail')).toBeUndefined()
    expect(zh.gloss('twintails')).toHaveProperty('text')
  })
  it('组合词照发现页：修饰词 + base 的释义（white capelet）', () => {
    expect(target('white capelet')?.name).toBe('white capelet')
    expect(zh.gloss('white capelet')).toMatchObject({ mod: 'white', base: 'capelet' })
  })
  it('NAI 自己的词标出来：有中文释义的照常显示（masterpiece），没有的空着（very aesthetic）', () => {
    expect(target('masterpiece')?.nai).toBe(true)
    expect(zh.gloss('masterpiece')).toHaveProperty('text')
    expect(target('very aesthetic')?.nai).toBe(true)
    expect(zh.gloss('very aesthetic')).toBeUndefined()
  })
  it('没有中文释义的 Danbooru tag 照样有（面板只留「英文原文」一行）：角色、作品数少的通用 tag', () => {
    expect(target('frieren')).toEqual({ name: 'frieren', nai: false, renamed: false })
    expect(zh.gloss('frieren')).toBeUndefined()
  })
  it('空着的：未识别、年份（Danbooru 的 2024 是「画面里写着 2024」，不是 NAI 的 year 2024）、meta:、自然语言、Text:、画师', () => {
    expect(target('missing fingerz')).toBeNull()
    expect(target('2024', 'year')).toBeNull()
    expect(zh.gloss('2024')).toBeDefined()
    expect(target('novel era', 'meta')).toBeNull()
    expect(target('a girl reading under a tree', 'text')).toBeNull()
    expect(target('Hello', 'textrender')).toBeNull()
    expect(target('mika pikazo', 'artist')).toBeNull()
    const artist: TagEntry = { name: 'someone', zh: '', category: 'artist', count: 100 }
    expect(glossTarget(chip('someone'), 'someone', () => artist)).toBeNull()
  })
})
