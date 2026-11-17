import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { TokenStore, type Cipher } from './token.ts'

let root: string
let file: string
let ok: boolean
const cipher: Cipher = {
  available: () => ok,
  encrypt: (s) => Buffer.from(`enc:${[...s].reverse().join('')}`),
  decrypt: (b) => {
    const s = b.toString()
    if (!s.startsWith('enc:')) throw new Error('解不开')
    return [...s.slice(4)].reverse().join('')
  },
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'pe-token-'))
  file = path.join(root, '程序目录', 'nai-token.bin')
  ok = true
})
afterEach(() => rm(root, { recursive: true, force: true }))

it('存进去再读出来；文件里只有密文；空 = 删掉', () => {
  const t = new TokenStore(file, cipher)
  expect(t.get()).toBe('')
  t.set('pst-abc123')
  expect(t.get()).toBe('pst-abc123')
  expect(readFileSync(file, 'utf8')).not.toContain('pst-abc123')
  expect(new TokenStore(file, cipher).get()).toBe('pst-abc123')
  t.set('')
  expect(existsSync(file)).toBe(false)
  expect(t.get()).toBe('')
})

it('解不开（换了 Windows 用户 / 文件坏了）= 空', () => {
  const t = new TokenStore(file, cipher)
  t.set('pst-abc123')
  writeFileSync(file, 'garbage')
  expect(t.get()).toBe('')
})

it('系统加密不可用：报错，不写明文', () => {
  ok = false
  const t = new TokenStore(file, cipher)
  expect(() => t.set('pst-abc123')).toThrow('系统加密不可用')
  expect(existsSync(file)).toBe(false)
})
