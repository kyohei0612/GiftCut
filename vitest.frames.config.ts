import { defineConfig } from 'vitest/config'

// 「1コマずつ」の確認だけを回す設定（npm run frames）。
//
// 普段の `npm run verify` からは外してある。実際に ffmpeg を回して全コマを
// 測るので数十秒かかり、コミットのたびに走らせる物ではないため。
// 動きに触ったときだけ回す。
export default defineConfig({
  test: {
    include: ['src/shared/**/*.frames.ts'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 300_000,
    passWithNoTests: false
  }
})
