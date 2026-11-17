import { describe, expect, it } from 'vitest'
import { buildFilename, defaultFilename, parseTemplate, renderFilename, TemplateError, type FilenameMeta } from './filename-template'

const meta: FilenameMeta = {
  prompt: '1girl, cherry blossoms, outdoors, smile',
  name: '樱花下的少女',
  seed: 1431428736,
  date: new Date(2026, 9, 29, 14, 5, 9),
  model: 'nai-diffusion-5-full',
  width: 832,
  height: 1216,
  index: 0,
  id: 'img_x',
  type: '',
  characters: [{ prompt: 'girl, frieren, elf' }, { name: '菲伦', prompt: 'girl, fern' }],
}

describe('文件名模板（照 NAI）', () => {
  it('默认模板 = 没开模板时的名字', () => {
    expect(renderFilename('{prompt} s-{seed}', meta)).toBe('1girl, cherry blossoms, outdoors, smile s-1431428736')
    expect(defaultFilename(meta.prompt!, meta.seed)).toBe('1girl, cherry blossoms, outdoors, smile s-1431428736')
  })
  it('各个 token', () => {
    expect(renderFilename('{date}_{time}_{modelname}_{model}_{resolution}_{width}x{height}_{index}', meta)).toBe('2026-10-29_14-05-09_V5 Full_nai-diffusion-5-full_832x1216_832x1216_1')
  })
  it('{name}（NAI 没有）= 图库里的名字', () => {
    expect(renderFilename('{name} s-{seed}', meta)).toBe('樱花下的少女 s-1431428736')
    expect(renderFilename('{name|pre:_}', { ...meta, name: '' })).toBe('')
  })
  it('过滤器', () => {
    expect(renderFilename('{prompt|tags:2}', meta)).toBe('1girl, cherry blossoms')
    expect(renderFilename('{prompt|tags:-1}', meta)).toBe('smile')
    expect(renderFilename('{prompt|words:2|upper}', meta)).toBe('1GIRL, CHERRY')
    expect(renderFilename('{prompt|first:5}', meta)).toBe('1girl')
    expect(renderFilename('{seed|last:4}', meta)).toBe('8736')
    expect(renderFilename('{index|pad:3}{type|pre:_}', meta)).toBe('001')
    expect(renderFilename('{seed|pre:s-|suf:!}', meta)).toBe('s-1431428736!')
  })
  it('{characters}：起了名用名字，没起名用第一个不是性别词的 tag', () => {
    expect(renderFilename('{characters}', meta)).toBe('frieren+菲伦')
    expect(renderFilename('{characters|join:, |at:2}', meta)).toBe('菲伦')
    expect(renderFilename('{characters|each:3|upper}', meta)).toBe('FRI+菲伦')
    expect(renderFilename('{characters|full|max:1}', meta)).toBe('girl, frieren, elf')
  })
  it('{{ 是字面的 {；换掉不能进文件名的字；prompt 默认只取前 80 个字', () => {
    expect(renderFilename('{{x}} {seed}', meta)).toBe('{x}} 1431428736')
    expect(renderFilename('a/b:c|d?{seed}', meta)).toBe('a_b_c_d_1431428736')
    expect(renderFilename('{prompt}', { prompt: 'x'.repeat(100) })).toBe('x'.repeat(80))
  })
  it('写错了报错', () => {
    expect(() => parseTemplate('{prompt')).toThrow(TemplateError)
    expect(() => parseTemplate('{nope}')).toThrow('未知的 token')
    expect(() => parseTemplate('{seed|max:2}')).toThrow('仅用于 {characters}')
    expect(() => parseTemplate('{characters|upper|max:2}')).toThrow('前面')
    expect(() => parseTemplate('{seed|first:0}')).toThrow('正整数')
    expect(() => parseTemplate('{seed|pre}')).toThrow('需要一个值')
    expect(() => parseTemplate('{seed|lower:1}')).toThrow('不接受值')
  })
  it('开了模板但写错 / 拼出来是空的：退回默认名字', () => {
    expect(buildFilename(meta, { on: true, text: '{nope}' })).toBe(defaultFilename(meta.prompt!, meta.seed))
    expect(buildFilename(meta, { on: true, text: '{type}' })).toBe(defaultFilename(meta.prompt!, meta.seed))
    expect(buildFilename(meta, { on: false, text: '{seed}' })).toBe(defaultFilename(meta.prompt!, meta.seed))
    expect(buildFilename(meta, { on: true, text: '{seed}' })).toBe('1431428736')
  })
})
