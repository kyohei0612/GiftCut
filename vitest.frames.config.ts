import { defineConfig } from 'vitest/config'

// 「1コマずつ」の確認だけを回す設定（npm run frames）。
//
// 普段の `npm run verify` からは外してある。実際に ffmpeg を回して全コマを
// 測るので数十秒かかり、コミットのたびに走らせる物ではないため。
// 動きに触ったときだけ回す。
export default defineConfig({
  test: {
    // shared だけでなく renderer 側の道具も回す（テロップの動きの計算は
    // lib/telopStyle にあり、**プレビューも書き出しもそこを通る**ため、
    // ここを1コマずつ確かめるのが一番効く）
    include: ['src/**/*.frames.ts'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 300_000,
    passWithNoTests: false
  }
})
