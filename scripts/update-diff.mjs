#!/usr/bin/env node
// **更新で本当に何MB落ちるかを、次の更新を待たずに出す。**
//
//   node scripts/update-diff.mjs 0.1.26 0.1.27
//   node scripts/update-diff.mjs 0.1.26            （新しい側は package.json の版）
//
// ## なぜ要ったか（2026-08-06）
//
// 「更新が遅い」を差分更新で直そうとしたが、**落とす量を一度も測っていなかった。**
// 測る手段を入れて（`src/main/updateLog.ts`）次の更新を待つつもりでいたが、
// **待たなくてよかった**——blockmap が両方あれば計算で出る。
//
// 出た答えは **1.2 MB / 115.9 MB ＝ 1.0%**。
// **差分は最初から効いていた。** 十数秒の正体は落とす所ではなく、
// インストーラが 263MB を書き直す所だった。狙いどころが丸ごと変わった。
//
// ## どうやって出しているか
//
// electron-updater の差分は blockmap（gzip した JSON）で決まる。
//
//   files[].checksums[i]   i 番目のブロックの中身の指紋
//   files[].sizes[i]       i 番目のブロックの大きさ
//
// 新しい側のブロックのうち、**同じ指紋が古い側に無い物だけ**を範囲指定で取りに行き、
// 在る物は手元の exe から写す。つまり
// **落ちる量 ＝ 古い側に無い指紋のブロックの合計**。
//
// ## 古い側は GitHub から取る（手元の dist を信じない）
//
// `npm run release` は2回回すので、**手元の dist は公開された物と中身が違う**
// （署名の時刻が入る）。実際 0.1.26 の blockmap は
// 手元 127,276 バイト／公開 127,150 バイトで、答えも 1.0MB と 1.2MB でずれた。
// **利用者が持っているのは公開された方**なので、そちらで測る。
import { readFileSync, existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const pkgVersion = () =>
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

const oldV = process.argv[2]
const newV = process.argv[3] ?? pkgVersion()
if (!oldV) {
  console.error('使い方: node scripts/update-diff.mjs <古い版> [新しい版]')
  process.exit(2)
}

/** 公開されている blockmap を取る。無ければ手元の dist で代用する（断って使う） */
function blockmap(v) {
  const url =
    `https://github.com/kyohei0612/GiftCut/releases/download/v${v}/GiftCut-Setup-${v}.exe.blockmap`
  try {
    // -f … 404 を本文ごと拾わずに落ちる（**取れなかったのを 0 バイトで通さない**）
    return execFileSync('curl', ['-fsSL', url], { maxBuffer: 1 << 26 })
  } catch {
    const local = join(ROOT, 'dist', `GiftCut Setup ${v}.exe.blockmap`)
    if (!existsSync(local)) throw new Error(`v${v} の blockmap が取れません（${url}）`)
    console.warn(`※ v${v} は公開の物が取れないので、手元の dist で代用します（数字はずれます）`)
    return readFileSync(local)
  }
}

const load = (buf) => JSON.parse(gunzipSync(buf).toString('utf8'))
const a = load(blockmap(oldV))
const b = load(blockmap(newV))

// 古い側の指紋を全部集める（ファイルをまたいで写せるので、まとめて持つ）
const have = new Set()
for (const f of a.files) for (const c of f.checksums) have.add(c)

let total = 0
let need = 0
let blocks = 0
let needBlocks = 0
for (const f of b.files) {
  for (let i = 0; i < f.checksums.length; i++) {
    total += f.sizes[i]
    blocks++
    if (!have.has(f.checksums[i])) {
      need += f.sizes[i]
      needBlocks++
    }
  }
}

const mb = (n) => (n / 1024 / 1024).toFixed(1)
console.log(`v${oldV} → v${newV}`)
console.log(`  全体    ${mb(total)} MB  （${blocks} ブロック）`)
console.log(`  落とす  ${mb(need)} MB  （${needBlocks} ブロック）`)
console.log(`  割合    ${((need / total) * 100).toFixed(1)} %`)
