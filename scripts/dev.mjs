// Unset storage paths select the real library; use --test or temporary PE_APP_DIR and PE_LIBRARY_DIR values for isolated development.
import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const test = args.includes('--test')
const desktop = args.includes('--app')
const viteArgs = args.filter((a) => a !== '--test' && a !== '--app')
const portAt = viteArgs.indexOf('--port')
const vitePort = Number(portAt >= 0 ? viteArgs[portAt + 1] : 5173)

const env = { ...process.env }
if (test) {
  env.PE_TEST = '1'
  env.PE_PORT ??= String(vitePort + 20000)
  if (!env.PE_APP_DIR || !env.PE_LIBRARY_DIR) {
    const root = path.join(os.tmpdir(), `pe-e2e-${vitePort}`)
    await rm(root, { recursive: true, force: true })
    env.PE_APP_DIR ??= path.join(root, 'app')
    env.PE_LIBRARY_DIR ??= path.join(root, 'library')
  }
}
env.PE_PORT ??= '4520'

const kids = []
let exiting = false
function quit(code) {
  if (exiting) return
  exiting = true
  for (const k of kids) if (k.exitCode === null) k.kill()
  process.exit(code)
}
function run(cmd, argv, extra = {}) {
  const k = spawn(cmd, argv, { env: { ...env, ...extra }, stdio: 'inherit' })
  k.on('exit', (code) => quit(code ?? 1))
  kids.push(k)
  return k
}

run(process.execPath, [...(test ? [] : ['--watch-path=server']), 'server/main.ts'])
const deadline = Date.now() + 20_000
for (;;) {
  try {
    if ((await fetch(`http://127.0.0.1:${env.PE_PORT}/api/library`)).ok) break
  } catch {
  }
  if (Date.now() > deadline) {
    console.error('后端 20 秒内没有起来')
    quit(1)
  }
  await new Promise((r) => setTimeout(r, 150))
}
run(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), ...viteArgs])

if (desktop) {
  const url = `http://localhost:${vitePort}/`
  for (;;) {
    try {
      if ((await fetch(url)).ok) break
    } catch {
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  const { default: electron } = await import('electron')
  run(electron, ['electron/main.ts'], { PE_DEV_URL: url })
}

process.on('SIGINT', () => quit(0))
process.on('SIGTERM', () => quit(0))
