#!/usr/bin/env node
// 出したあとに、**添付が本当に上がっているかを数える。**
//
//   node scripts/check-release.mjs          package.json の版を見る
//   node scripts/check-release.mjs 0.1.23   版を指定する
//
// `npm run release` の最後に繋いである。**これが無いと、添付が足りなくても
// 終了コード 0 で「出せた」と言ってくる**（0.1.11 / 0.1.21 / 0.1.22 / 0.1.23 と
// 4回連続）。判定そのものは src/shared/releaseAssets.ts（試験付き）。
//
// ## なぜ release の中に入れるか
//
// 手順書には前から「2回回す前提」「数えるまで出せたと思うな」と書いてあった。
// **4回とも書いてあるとおりに落ちている**ので、文章では止まらないと分かった。
// 人が読む決まりを、機械が読む決まりに移す。
//
// ## 発行が落ちても、必ずここまで来る
//
// 最初は `electron-builder … && npm run check:release` と書いていた。
// ところが 0.1.24 の1回目は **electron-builder 自身が HTTP エラーで落ちた**ので、
// `&&` の後ろまで来ず、**この検査は一度も走らなかった**。
// しかも Releases には **exe だけが上がっていた**（中途半端な状態）。
//
// 捕まえたいのは「終了コードが嘘をつく」だけではない。
// **「落ちた。しかも中途半端に上がっている」も一度に知りたい。**
// 繋ぎ方はシェルに任せていない（記号がどれも Windows か POSIX で外れるため。
// 経緯は scripts/release.mjs の頭）。発行が落ちても、こちらは必ず走る。

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkAssets, describeVerdict } from '../src/shared/releaseAssets.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const version =
  process.argv[2] ?? JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version

/** gh から添付の一覧を取る。**取れなかったら落とす**（緑にして通さない） */
function fetchAssets(tag) {
  let out
  try {
    out = execFileSync('gh', ['release', 'view', tag, '--json', 'assets'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (e) {
    // **「見に行けなかった」を「問題なし」にしない。**
    // gh が無い・未ログイン・タグが無いのどれでも、出せたことの確認にはならない。
    //
    // **疑う順を、実際に起きた順で書く。** v0.1.27 で「タグが push されて
    // いないのでは」を先に読んで遠回りした。タグは上がっていて、本当は
    // **発行が一度も走っていなかった**（GH_TOKEN が無く electron-builder が即落ち）。
    // 直したのは scripts/release.mjs（gh のログインから鍵を借りる）。
    const notFound = /not found|Could not resolve/i.test(String(e.message))
    throw new Error(
      `gh で ${tag} を見られませんでした（${String(e.message).split('\n')[0]}）。\n` +
        (notFound
          ? 'その版のリリースがまだありません。**発行が一度も通っていない**のが\n' +
            '一番よくある原因です（上の発行のログを見ること）。\n' +
            'タグ（git push origin ' + tag + '）も確かめてください。'
          : 'gh のログイン（gh auth status）を確かめてください。')
    )
  }
  const assets = JSON.parse(out).assets
  if (!Array.isArray(assets)) throw new Error('gh の返事に assets がありません（形が変わった）')
  return assets.map((a) => ({ name: a.name, size: Number(a.size) || 0 }))
}

const verdict = checkAssets(version, fetchAssets(`v${version}`))
if (!verdict.ok) {
  console.error('\n' + describeVerdict(version, verdict) + '\n')
  process.exit(1)
}
console.log(describeVerdict(version, verdict))
