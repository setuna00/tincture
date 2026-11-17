import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { resolveLicenseTexts } from '../scripts/lib/license-texts.mjs'

const directory = mkdtempSync(path.join(os.tmpdir(), 'tincture-licenses-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))
afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(directory)
})

describe('release license texts', () => {
  it('preserves bundled license and NOTICE text', () => {
    const dep = { name: 'example', version: '1', licenseText: 'Permission is hereby granted.', noticeText: 'Copyright Example' }
    expect(resolveLicenseTexts([dep], directory)).toEqual([dep])
  })

  it('uses only the supplement matching the package name and version', () => {
    mkdirSync(path.join(directory, '@example'))
    const text = 'Source: https://example.com/LICENSE\n\nPermission is hereby granted.'
    writeFileSync(path.join(directory, '@example/pkg@1.txt'), text)
    expect(resolveLicenseTexts([{ name: '@example/pkg', version: '1', licenseText: 'Apache License 2.0\n\nSee the LICENSE file in the root of this repository.' }], directory)[0].licenseText).toBe(text)
    expect(() => resolveLicenseTexts([{ name: '@example/pkg', version: '2' }], directory)).toThrow('@example/pkg@2')
  })

  it('lists every unresolved package, including empty text and placeholders', () => {
    const deps = [null, '', '  ', '(the package has no license file)', 'See the LICENSE file in the root of this repository.'].map((licenseText, i) => ({ name: `pkg-${i}`, version: '1', licenseText }))
    expect(() => resolveLicenseTexts(deps, directory)).toThrow(/pkg-0@1[\s\S]*pkg-1@1[\s\S]*pkg-2@1[\s\S]*pkg-3@1[\s\S]*pkg-4@1/)
  })

  it('rejects supplements without a source or without actual text', () => {
    for (const text of ['Permission is hereby granted.', 'Source: https://example.com/LICENSE\n\n', 'Source: https://example.com/LICENSE\n\nSee the LICENSE file.']) {
      writeFileSync(path.join(directory, 'example@1.txt'), text)
      expect(() => resolveLicenseTexts([{ name: 'example', version: '1' }], directory)).toThrow('example@1')
    }
  })
})
