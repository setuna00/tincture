import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { adoptLegacyDir, APP_NAME, defaultLibraryDir, isSynced } from './config.ts'

const home = 'C:\\Users\\test-user'

describe('默认的图库文件夹', () => {
  it('「文档」没被同步：文档\\<软件名>', () => {
    expect(defaultLibraryDir(`${home}\\Documents`, home, {})).toBe(path.join(home, 'Documents', APP_NAME))
  })

  it('「文档」被 OneDrive 挪走（按环境变量认，个人版 / 商业版）：用户文件夹\\<软件名>', () => {
    const env = { OneDrive: `${home}\\OneDrive` }
    expect(defaultLibraryDir(`${home}\\OneDrive\\文档`, home, env)).toBe(path.join(home, APP_NAME))
    expect(isSynced(`${home}\\onedrive\\文档`, env)).toBe(true)
    expect(isSynced(`D:\\Work\\Docs`, { OneDriveCommercial: 'D:\\Work' })).toBe(true)
  })

  it('没有环境变量也认得出 OneDrive 的文件夹名；名字只是像的不算', () => {
    expect(isSynced(`${home}\\OneDrive - Contoso\\Documents`, {})).toBe(true)
    expect(isSynced(`${home}\\OneDrive\\文档`, {})).toBe(true)
    expect(isSynced(`${home}\\OneDriveBackup\\文档`, {})).toBe(false)
    expect(isSynced(`${home}\\Documents`, { OneDrive: `${home}\\OneDrive` })).toBe(false)
  })
})

describe('旧名字的文件夹', () => {
  let tmp = ''
  afterEach(() => tmp && rmSync(tmp, { recursive: true, force: true }))
  const setup = () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'pe-legacy-'))
    return { dir: path.join(tmp, 'Tincture'), old: path.join(tmp, 'Prompt台') }
  }

  it('只有旧的：改名成新的，里面的东西原样带过去', () => {
    const { dir, old } = setup()
    mkdirSync(path.join(old, 'images'), { recursive: true })
    writeFileSync(path.join(old, 'library.db'), 'db')
    expect(adoptLegacyDir(dir, [old])).toBe(dir)
    expect(existsSync(old)).toBe(false)
    expect(readFileSync(path.join(dir, 'library.db'), 'utf8')).toBe('db')
    expect(existsSync(path.join(dir, 'images'))).toBe(true)
  })

  it('新的已经在：不动旧的', () => {
    const { dir, old } = setup()
    mkdirSync(dir)
    mkdirSync(old)
    expect(adoptLegacyDir(dir, [old])).toBe(dir)
    expect(existsSync(old)).toBe(true)
  })

  it('都不在：用新的（第一次装）', () => {
    const { dir, old } = setup()
    expect(adoptLegacyDir(dir, [old])).toBe(dir)
    expect(existsSync(dir)).toBe(false)
  })

  it('改名失败（被占用）：接着用旧的', () => {
    const fs = { exists: (p: string) => p === 'old', rename: () => { throw new Error('EBUSY') } }
    expect(adoptLegacyDir('new', ['old'], fs)).toBe('old')
  })

  it('OneDrive 时旧的默认图库在用户文件夹下，按同一套规则找', () => {
    const env = { OneDrive: `${home}\\OneDrive` }
    expect(defaultLibraryDir(`${home}\\OneDrive\\文档`, home, env, 'Prompt台')).toBe(path.join(home, 'Prompt台'))
  })
})
