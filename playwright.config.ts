import { defineConfig } from '@playwright/test'

// E2E_PORT isolates test servers across worktrees.
// Test mode uses temporary libraries isolated by cookie, keeping tests away from the user's library.
const port = Number(process.env.E2E_PORT ?? 5190)

/**
 * 滚轮计时两条（feel.spec.ts）：等别的全跑完再单独跑。和重型用例（发现页、9,000 个 tag 的 list）并行时抢 CPU，
 * 串行 18–24ms 的代码并行能到 53ms（2026-10-16），超线却不是变慢。
 * 单独跑也会超：机器整体慢的时候（开着几个 dev server、Chrome、Notion……）同一份代码 18ms → 90ms（2026-10-16 拿 6c30663
 * 和 HEAD 交替跑，两边一样）。所以超线时先拿改动前的版本在另一个端口交替跑（E2E_PORT），两边差得多才算回归。
 * 前面有用例挂了时这两条会被跳过（dependencies 的规矩），先修前面的。
 * 只跑这两条：`npx playwright test --project=timing --no-deps`（-g 管不到被依赖的那组，不加 --no-deps 会先跑完全部）。
 */
const TIMING = /滚轮响应延迟|滚轮调权重仍/

export default defineConfig({
  testDir: './e2e',
  // 桌面程序的冒烟测试单独跑：npm run test:app（playwright.app.config.ts）
  testIgnore: 'app/**',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'main', grepInvert: TIMING },
    { name: 'timing', grep: TIMING, dependencies: ['main'], fullyParallel: false },
  ],
  webServer: {
    command: `node scripts/dev.mjs --test --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
  },
})
