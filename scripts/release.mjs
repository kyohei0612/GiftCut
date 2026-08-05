#!/usr/bin/env node
// 出す（発行 → **必ず添付を数える**）。
//
//   npm run release
//
// ## なぜ npm の1行で繋がないか（2026-08-06）
//
// 最初は `electron-builder … && npm run check:release` と書いていた。
// 0.1.24 の1回目で **electron-builder 自身が HTTP エラーで落ちた**ので
// `&&` の後ろまで来ず、検査が一度も走らなかった。しかも Releases には
// **exe だけが上がっていた**（中途半端な状態）。
//
// そこで `;` に変えたら、今度は **Windows で動かなかった**。
// npm はスクリプトを cmd.exe に渡すが、**cmd では `;` が区切りではない**ので
// `publish:only;` という名前のスクリプトを探しに行って落ちる。
//
//   `&&`  発行が落ちると検査が走らない
//   `;`   POSIX では動くが **cmd では動かない**
//   `&`   cmd では動くが、**POSIX では裏に回してしまう**
//
// **どの記号もどちらかで外す。** シェルに任せず、ここで順に呼ぶ。
//
// ## 発行が落ちても数える
//
// 捕まえたいのは「終了コードが嘘をつく」だけではない。
// **「落ちた。しかも中途半端に上がっている」も一度に知りたい。**

import { spawnSync } from 'node:child_process'

// **鍵は思い出さなくても通るようにする**（2026-08-06）。
//
// electron-builder が見るのは環境変数の `GH_TOKEN` だけ。ところが普段
// GitHub を触るのは `gh` で、あちらは鍵を keyring に持っている。
// **`gh` にログイン済みなのに発行だけ落ちる**、という食い違いが起きる。
//
// 実際に v0.1.27 で踏んだ。しかも出たのは
// 「タグが push されていないのでは」という**別の場所を疑わせる文面**で、
// 本当の原因（発行が一度も走っていない）に辿り着くまで遠回りした。
//
// 人が思い出さないと通らない手順は、いずれ必ず抜ける。**こちらから取りに行く。**
// **`shell: true` を付けない。** 付けると Node が「引数を繋ぐだけなので危ない」と
// 警告を出し、リリースのログに毎回混ざる。`gh` は .exe なのでシェル無しで見つかる
const ghToken = () => {
  const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}

// 既に環境にあるならそれを使う（CI では `gh` が居ないので、そちらが本筋）
const env = { ...process.env }
if (!env.GH_TOKEN && !env.GITHUB_TOKEN) {
  const t = ghToken()
  // **鍵そのものは出さない。** 出所だけ言う
  if (t) {
    env.GH_TOKEN = t
    console.log('GH_TOKEN が無いので、gh のログインから借りました')
  } else {
    console.error(
      '\x1b[33mGH_TOKEN が無く、gh からも取れませんでした。' +
        '`gh auth login` を済ませるか、GH_TOKEN を渡してください\x1b[0m'
    )
  }
}

/** npm のスクリプトを1つ走らせる（Windows でも動くように shell 経由） */
const run = (name) =>
  spawnSync('npm', ['run', name], { stdio: 'inherit', shell: true, env }).status ?? 1

const published = run('publish:only')
if (published !== 0)
  console.error(`\n\x1b[33m発行が終了コード ${published} で終わりました。` +
    `**それでも添付を数えます**（中途半端に上がっていることがあるため）\x1b[0m\n`)

const counted = run('check:release')
// **どちらかが落ちていれば赤。** 発行が落ちたのに添付が揃っていることは
// ありうる（再実行の後など）が、そのときも発行の失敗は隠さない
process.exit(published !== 0 || counted !== 0 ? 1 : 0)
