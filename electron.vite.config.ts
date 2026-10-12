import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    // 裏の作業員（lib/cutout/worker）は中で import() を使うので ES module の形で出す
    worker: { format: 'es' },
    // GIFTCUT_NOMIN=1 で縮めない（CPU プロファイルで関数の名前を読むため。配布物には使わない）
    ...(process.env.GIFTCUT_NOMIN ? { build: { minify: false as const } } : {}),
    plugins: [react()]
  }
})
