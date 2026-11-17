import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { DragFiles, safeName } from './drag-out.ts'

let root: string
let files: DragFiles
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'pe-drag-'))
  files = new DragFiles(path.join(root, '程序目录', 'drag'))
})
afterEach(() => rm(root, { recursive: true, force: true }))

it('写进去：文件名照给的、内容原样；同一个 key 找得到，别的 key 找不到', () => {
  const p = files.write('a|png|1girl s-123', '1girl s-123', 'png', new Uint8Array([1, 2, 3]))
  expect(path.basename(p)).toBe('1girl s-123.png')
  expect(path.dirname(path.dirname(p))).toBe(files.root)
  expect([...readFileSync(p)]).toEqual([1, 2, 3])
  expect(files.find('a|png|1girl s-123')).toBe(p)
  expect(files.find('a|webp|1girl s-123')).toBeNull()
})

it('同名的两张不同图各在自己的子文件夹，互不覆盖', () => {
  const a = files.write('a|png|x', 'x', 'png', new Uint8Array([1]))
  const b = files.write('b|png|x', 'x', 'png', new Uint8Array([2]))
  expect(a).not.toBe(b)
  expect([...readFileSync(a)]).toEqual([1])
  expect([...readFileSync(b)]).toEqual([2])
})

it('被别的程序挪走了（资源管理器移动）：当没有', () => {
  const p = files.write('a|png|x', 'x', 'png', new Uint8Array([1]))
  // Node 24 rmSync can silently leave paths containing Chinese characters; unlink the file directly.
  unlinkSync(p)
  expect(files.find('a|png|x')).toBeNull()
})

it('只认自己写的、还在的文件', () => {
  const p = files.write('a|png|x', 'x', 'png', new Uint8Array([1]))
  expect(files.owns(p)).toBe(true)
  const outside = path.join(root, 'secret.txt')
  writeFileSync(outside, 'x')
  expect(files.owns(outside)).toBe(false)
  expect(files.owns(path.join(files.root, '..', 'secret.txt'))).toBe(false)
  expect(files.owns(files.root)).toBe(false)
  expect(files.owns(path.join(files.root, 'nope', 'y.png'))).toBe(false)
})

it('不认的格式报错', () => {
  expect(() => files.write('a', 'x', 'exe', new Uint8Array([1]))).toThrow()
})

it('清空：文件夹没了，找不到；没有文件夹时清也不报错', () => {
  const p = files.write('a|png|x', 'x', 'png', new Uint8Array([1]))
  files.clear()
  expect(existsSync(p)).toBe(false)
  expect(existsSync(files.root)).toBe(false)
  expect(files.find('a|png|x')).toBeNull()
  expect(() => files.clear()).not.toThrow()
})

it('文件名兜底：非法字符换 _、末尾点和空格去掉、空的叫 image、保留名加 _', () => {
  expect(safeName('a/b\\c:d*e?"f<g>h|i')).toBe('a_b_c_d_e__f_g_h_i')
  expect(safeName('name. . ')).toBe('name')
  expect(safeName('  ')).toBe('image')
  expect(safeName('CON')).toBe('_CON')
  expect(safeName('x'.repeat(300))).toHaveLength(180)
})
