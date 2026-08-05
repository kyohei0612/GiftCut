#!/usr/bin/env node
// **差し替え用の JS ひと揃い（bundle）を作る。**
//
//   npm run build && node scripts/make-bundle.mjs
//   → dist/bundle-<版>.zip  と  dist/bundle-<版>.json
//
// ## これは何のためか
//
// 更新のたびにインストーラが 263MB を書き直している。**変わるのは `out/` だけ**
// （737KB）。それだけを配って、userData に置いて、開き直す。
// インストーラを走らせないので、再起動が「閉じて開く」だけになる。
//
// ※ 落とす量の話ではない（差分ダウンロードは元から効いていて 1.2MB だった）。
//   潰したいのは**書き直す時間**。→ `引き継ぎ-差分更新.md`
//
// ## node_modules は入れない
//
// `out/main/index.js` は `electron-updater` などを外から読むが、それらは
// **土台の側**（同梱の asar）に在る。指紋（Electron の版と `bundleFormat`）が
// 同じなら中身も同じなので、毎回運ぶ意味がない。
// 差し替えから見えるようにするのは `boot.js` の仕事。
//
// ## 圧縮する
//
// `writeZip` は既定で圧縮しない（素材は圧縮済みで、掛けても数%しか減らないのに
// 読み直す時間だけ増えるため）。**JS は逆**で、よく縮む。
// なので中身を渡す形（`data`）で入れる——そちらは yazl が既定で圧縮する。
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { writeZip } from '../src/main/zip.ts'
import { makeFingerprint } from './bundleMeta.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const OUT = join(ROOT, 'out')
const DIST = join(ROOT, 'dist')

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

/** out/ の下を全部たどる（名前は out/ からの相対・区切りは /） */
function walk(dir, base = OUT) {
  const found = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) found.push(...walk(p, base))
    else found.push({ name: relative(base, p).replace(/\\/g, '/'), from: p })
  }
  return found
}

const files = walk(OUT)
// **入口が無ければ作らない。** 中身の無い差し替えを配ると、掴んだ側が
// 1回起動に失敗してから捨てることになる（使う人には「一瞬落ちた」に見える）
if (!files.some((f) => f.name === 'main/index.js'))
  throw new Error('out/main/index.js がありません。先に npm run build を通すこと')

const version = pkg.version
const zipPath = join(DIST, `bundle-${version}.zip`)
mkdirSync(DIST, { recursive: true })

await writeZip(
  zipPath,
  files.map((f) => ({ name: f.name, data: readFileSync(f.from) }))
)

const zip = readFileSync(zipPath)
const manifest = {
  version,
  // **土台の指紋。** 合わなければ受け取った側が読まずに捨てる
  fingerprint: makeFingerprint(ROOT),
  sha512: createHash('sha512').update(zip).digest('base64'),
  size: zip.length,
  files: files.length
}
writeFileSync(join(DIST, `bundle-${version}.json`), JSON.stringify(manifest, null, 2) + '\n')

const kb = (n) => `${(n / 1024).toFixed(0)} KB`
const raw = files.reduce((n, f) => n + statSync(f.from).size, 0)
console.log(`bundle-${version}.zip  ${kb(zip.length)}（元 ${kb(raw)} / ${files.length} ファイル）`)
console.log(`  指紋  ${manifest.fingerprint}`)
