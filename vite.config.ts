/// <reference types="vitest/config" />
import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/** dev 专用：设计台 POST /__tokens，把调好的 token 按变量名写回 src/styles/tokens.css。只认本站页面发的，别的网页不能借 dev 服务器改文件 */
function tokensWriter(): Plugin {
  return {
    name: 'pe-tokens-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__tokens', (req, res) => {
        if (req.headers['sec-fetch-site'] !== 'same-origin') {
          res.statusCode = 403
          return res.end()
        }
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end()
        }
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          try {
            const patch = JSON.parse(body) as Record<string, string>
            const file = path.resolve(server.config.root, 'src/styles/tokens.css')
            let css = fs.readFileSync(file, 'utf8')
            const changed: string[] = []
            for (const [k, v] of Object.entries(patch)) {
              // 只接受合法变量名，值里不允许出现能跳出声明的字符
              if (!/^--[a-z0-9-]+$/.test(k) || /[;{}]/.test(v)) continue
              const re = new RegExp(`(\\n\\s*${k}:\\s*)([^;]+);`)
              if (re.test(css)) {
                css = css.replace(re, `$1${v};`)
                changed.push(k)
              }
            }
            fs.writeFileSync(file, css)
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ changed }))
          } catch (e) {
            res.statusCode = 400
            res.end(String(e))
          }
        })
      })
    },
  }
}

// 版本号只在 package.json 的 version；页面上显示「v1.0.0 · 构建日期」（状态栏、设置「关于」），发布包的 exe 版本也读 package.json（scripts/release.mjs）
const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(`v${pkg.version} · ${new Date().toLocaleDateString('sv-SE')}`) },
  plugins: [react(), tailwindcss(), tokensWriter()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  // The development launcher starts the backend before Vite, using PE_PORT for its proxy target.
  server: { port: 5173, strictPort: true, proxy: { '/api': `http://127.0.0.1:${process.env.PE_PORT ?? 4520}`, '/mcp': `http://127.0.0.1:${process.env.PE_PORT ?? 4520}` } },
  test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'electron/**/*.test.ts'] },
})
