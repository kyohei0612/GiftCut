#!/usr/bin/env node
// onnxruntime-web の wasm（画像の背景を当てる模型を動かす土台）を、
// 画面の公開フォルダ `src/renderer/public/ort/` へ写す。**build の前に毎回走る。**
//
// ## なぜ写すか
//
// onnxruntime-web は既定で wasm を CDN から取りに行く。配布物はオフラインで
// 動く物なので、手元に置いて `wasmPaths` で指す（`lib/cutout/model`）。
// `public/` に置けば `out/renderer/ort/` に入り、**JS だけの差し替え更新でも届く**
// （resources に置くと土台の側になって、差し替えでは届かない）。
//
// git には入れない（27MB の生成物。`npm install` で手に入る）。
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join('node_modules', 'onnxruntime-web', 'dist')
const DST = join('src', 'renderer', 'public', 'ort')
// CPU（wasm）用の jsep 版だけ写す。
//
// WebGPU（`onnxruntime-web/webgpu`・asyncify 版 24MB）も試したが、**Electron 31 では
// 動かない**（adapter.info に subgroupMinSize が無く、1.30 の初期化が落ちる）。
// 動かない物を 24MB 運ぶ意味が無いので写さない。CPU でも 1024² を 7 秒（実測・
// 2026-10-12）で、裏の作業員で動くので画面は固まらない。Electron を上げたら
// ここに asyncify 版を足すだけで WebGPU が試される（lib/cutout/model の inferMatte）
const FILES = ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']

mkdirSync(DST, { recursive: true })
for (const f of FILES) {
  const from = join(SRC, f)
  const to = join(DST, f)
  if (!existsSync(from)) {
    console.error(`onnxruntime-web の ${f} が無い（npm install が要る）`)
    process.exit(1)
  }
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue
  copyFileSync(from, to)
  console.log(`ort: ${f} を写した`)
}
