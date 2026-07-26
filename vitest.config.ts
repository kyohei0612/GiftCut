import { defineConfig } from 'vitest/config'

// テスト対象は src/shared（React も Electron も import しない純粋ロジック）。
// UI や main プロセスは Electron が要るのでここでは動かさない。
export default defineConfig({
  test: {
    include: ['src/shared/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
    // 失敗を必ず非ゼロ終了で返す（フック/CI が検知できるように）
    passWithNoTests: false
  }
})
