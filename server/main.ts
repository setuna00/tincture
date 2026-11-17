import { buildApp } from './app.ts'
import { loadConfig } from './config.ts'

const config = loadConfig()
const app = await buildApp(config)
try {
  await app.listen({ host: '127.0.0.1', port: config.port })
} catch (e) {
  console.error(`后端无法启动（端口 ${config.port}）：${(e as Error).message}`)
  process.exit(1)
}
console.log(`后端 http://127.0.0.1:${config.port}${config.test ? '（测试模式）' : ''} · 图库文件夹 ${config.test ? `${config.defaultLibraryDir}\\<cookie>` : '见设置页'} · 程序目录 ${config.appDir}`)

const stop = () => void app.close().finally(() => process.exit(0))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
