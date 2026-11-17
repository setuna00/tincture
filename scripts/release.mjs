// better-sqlite3 13 ships N-API binaries usable by Electron without an ABI rebuild.
// Ship our LICENSE and THIRD_PARTY_NOTICES.md alongside LICENSE.electron.txt and LICENSES.chromium.html to retain redistribution notices.
// LICENSES.npm.txt covers renderer, Worker and main bundles, plus copied SQLite and inlined CSS packages.
// Keep the packager's directory name: antivirus scanning the new executable can make renaming fail with EPERM.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
import { packager } from '@electron/packager'
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses'
import license from 'rollup-plugin-license'
import { build } from 'vite'
import { resolveLicenseTexts } from './lib/license-texts.mjs'

const root = process.cwd()
const APP_NAME = readFileSync('server/config.ts', 'utf8').match(/export const APP_NAME = '([^']+)'/)[1]
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const electronVersion = JSON.parse(readFileSync('node_modules/electron/package.json', 'utf8')).version
const dirOnly = process.argv.includes('--dir')

const out = path.resolve('release')
const stage = path.join(out, '.stage')
const appDir = path.join(stage, 'app')
const final = path.join(out, `${APP_NAME}-win32-x64`)
const zip = path.join(out, `${APP_NAME}-${version}.zip`)

// Node 24 rmSync crashes on Chinese paths (0xC0000409); asynchronous rm avoids it.
await rm(stage, { recursive: true, force: true })
await rm(final, { recursive: true, force: true })
await rm(zip, { force: true })
mkdirSync(appDir, { recursive: true })

const bundled = new Map()
const licenses = () => license({ thirdParty: { multipleVersions: true, output: (deps) => deps.forEach((d) => bundled.set(`${d.name}@${d.version}`, d)) } })

await build({ root, mode: 'release', logLevel: 'warn', plugins: [licenses()], worker: { plugins: () => [licenses()] }, build: { outDir: path.join(appDir, 'www'), emptyOutDir: true } })

await build({
  root,
  configFile: false,
  logLevel: 'warn',
  build: {
    ssr: 'electron/main.ts',
    outDir: appDir,
    emptyOutDir: false,
    target: 'node24',
    minify: false,
    rolldownOptions: { external: ['electron', 'better-sqlite3'], output: { entryFileNames: 'main.mjs', format: 'esm', codeSplitting: false } },
  },
  ssr: { noExternal: true, external: ['electron', 'better-sqlite3'] },
  plugins: [licenses()],
})
cpSync('electron/preload.cjs', path.join(appDir, 'preload.cjs'))
cpSync('electron/icon.ico', path.join(appDir, 'icon.ico'))
writeFileSync(path.join(appDir, 'package.json'), `${JSON.stringify({ name: 'prompt-editor', productName: APP_NAME, version, main: 'main.mjs', type: 'module' }, null, 2)}\n`)

const sqlite = path.join(appDir, 'node_modules', 'better-sqlite3')
for (const f of ['package.json', 'LICENSE', 'lib', path.join('prebuilds', 'win32-x64.node')]) cpSync(path.join('node_modules', 'better-sqlite3', f), path.join(sqlite, f), { recursive: true })

const npmLicenseText = npmLicenses()
const [made] = await packager({
  dir: appDir,
  out,
  name: APP_NAME,
  executableName: APP_NAME,
  icon: path.resolve('electron/icon.ico'),
  platform: 'win32',
  arch: 'x64',
  electronVersion,
  appVersion: version,
  buildVersion: version,
  asar: { unpack: '**/*.node' },
  prune: false,
  overwrite: true,
  quiet: true,
  win32metadata: { CompanyName: APP_NAME, ProductName: APP_NAME, FileDescription: APP_NAME, InternalName: APP_NAME, OriginalFilename: `${APP_NAME}.exe` },
})
const locales = path.join(made, 'locales')
await flipFuses(path.join(made, `${APP_NAME}.exe`), {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
})
for (const f of readdirSync(locales)) if (!['zh-CN.pak', 'en-US.pak'].includes(f)) await rm(path.join(locales, f))
renameSync(path.join(made, 'LICENSE'), path.join(made, 'LICENSE.electron.txt'))
cpSync('LICENSE', path.join(made, 'LICENSE'))
cpSync('THIRD_PARTY_NOTICES.md', path.join(made, 'THIRD_PARTY_NOTICES.md'))
writeFileSync(path.join(made, 'LICENSES.npm.txt'), npmLicenseText)
console.log(`LICENSES.npm.txt  ${bundled.size} bundled packages + the copied / CSS ones`)
await rm(stage, { recursive: true, force: true })
console.log(`${final}  ${(dirSize(final) / 1024 / 1024).toFixed(0)} MB`)

if (!dirOnly) {
  writeZip(zip, final, APP_NAME)
  console.log(`${zip}  ${(readFileSync(zip).length / 1024 / 1024).toFixed(0)} MB`)
}

/** Read license text directly for copied packages that the bundle license plugin cannot see. */
function packageInfo(name) {
  const dir = path.join('node_modules', name)
  const file = readdirSync(dir).find((f) => /^licen[cs]e/i.test(f))
  return { ...JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')), licenseText: file ? readFileSync(path.join(dir, file), 'utf8') : null }
}

/** Inlined CSS imports are absent from bundle modules, so their packages need explicit license collection. */
function cssPackages() {
  return [...readFileSync('src/index.css', 'utf8').matchAll(/^@import\s+["']([^"'./][^"']*)["']/gm)].map(([, spec]) => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/'))
}

/** Preserve each package's license, NOTICE text and source URL in the release's attribution file. */
function npmLicenses() {
  const extra = new Set(['better-sqlite3', ...cssPackages()])
  const deps = resolveLicenseTexts([...bundled.values(), ...[...extra].map(packageInfo).filter((p) => !bundled.has(`${p.name}@${p.version}`))], path.join(root, 'scripts', 'license-texts'))
  const url = (r) => (typeof r === 'string' ? r : r?.url)
  const blocks = deps
    .sort((a, b) => a.name.localeCompare(b.name, 'en') || String(a.version).localeCompare(String(b.version), 'en'))
    .map((d) =>
      [
        `${d.name} ${d.version}`,
        `License: ${d.license ?? 'not specified'}`,
        url(d.repository) || d.homepage ? `Source: ${url(d.repository) || d.homepage}` : null,
        '',
        d.licenseText.trim(),
        ...(d.noticeText ? ['', d.noticeText.trim()] : []),
      ]
        .filter((l) => l !== null)
        .join('\n'),
    )
  const rule = `\n\n${'-'.repeat(80)}\n\n`
  return `${APP_NAME} ${version} includes the following npm packages (${deps.length}), bundled into the app.${rule}${blocks.join(rule)}\n`
}

function dirSize(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .reduce((n, e) => n + readFileSync(path.join(e.parentPath, e.name)).length, 0)
}

function writeZip(file, dir, prefix) {
  if (!existsSync(dir)) throw new Error(`没有 ${dir}`)
  const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
  const now = new Date()
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const day = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  const body = []
  const central = []
  let offset = 0
  for (const e of files) {
    const full = path.join(e.parentPath, e.name)
    const name = Buffer.from(`${prefix}/${path.relative(dir, full).split(path.sep).join('/')}`)
    const data = readFileSync(full)
    const packed = deflateRawSync(data, { level: 9 })
    // ZIP local and central headers share these 26 bytes; flag 0x0800 marks UTF-8 filenames to prevent garbled extraction.
    const common = Buffer.alloc(26)
    common.writeUInt16LE(20, 0)
    common.writeUInt16LE(0x0800, 2)
    common.writeUInt16LE(8, 4)
    common.writeUInt16LE(time, 6)
    common.writeUInt16LE(day, 8)
    common.writeUInt32LE(crc32(data), 10)
    common.writeUInt32LE(packed.length, 14)
    common.writeUInt32LE(data.length, 18)
    common.writeUInt16LE(name.length, 22)
    const local = Buffer.alloc(4)
    local.writeUInt32LE(0x04034b50)
    body.push(local, common, name, packed)
    const head = Buffer.alloc(6)
    head.writeUInt32LE(0x02014b50)
    head.writeUInt16LE(20, 4)
    // ZIP central-directory tail: comment length, disk, internal/external attributes, then local-header offset at byte 10.
    const tail = Buffer.alloc(14)
    tail.writeUInt32LE(offset, 10)
    central.push(head, common, tail, name)
    offset += 30 + name.length + packed.length
  }
  const size = central.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(size, 12)
  end.writeUInt32LE(offset, 16)
  writeFileSync(file, Buffer.concat([...body, ...central, end]))
}
