import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// テスト対象:
//  - src/shared … React も Electron も import しない純粋ロジック（環境 node）
//  - App.smoke.test.tsx … 実際に App を描画して起動できるか確かめる（環境 jsdom。
//    ファイル冒頭の @vitest-environment で指定している）。型チェックとロジック
//    テストが全部通っているのにアプリが起動しない、という事故を防ぐため。
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/shared/**/*.test.ts', 'src/renderer/src/**/*.test.tsx'],
    environment: 'node',
    reporters: ['default'],
    // 失敗を必ず非ゼロ終了で返す（フック/CI が検知できるように）
    passWithNoTests: false
  }
})
