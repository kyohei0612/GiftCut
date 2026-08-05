// **土台の指紋を、配る側で作る。**
//
// 受け取る側（`boot.js`）は `process.versions.electron` から作る。
// 配る側は動いている Electron が無いので、**同梱する予定の版**＝
// `node_modules/electron` の版から作る。
//
// ## 同じ関数から作ること
//
// 指紋は**両側で一字でも違えば意味を失う**。片方が「electron31.7.7」、
// もう片方が「31.7.7」なら、正しい差し替えまで全部捨てられて、
// しかも**そう見える**（毎回インストーラで更新されるだけ）ので誰も気づかない。
//
// なので文字列の組み立ては `bootGate.js` の1か所だけ。ここは材料を集めるだけ。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const req = createRequire(import.meta.url)

/** リポジトリの根から、配る物の指紋を作る */
export function makeFingerprint(root) {
  const { makeFingerprint: build } = req(join(root, 'bootGate.js'))
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const electron = JSON.parse(
    readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8')
  )
  if (!electron.version) throw new Error('electron の版が読めません')
  if (typeof pkg.bundleFormat !== 'number')
    throw new Error('package.json の bundleFormat がありません')
  return build(electron.version, pkg.bundleFormat)
}
