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
import { readFileSync } from 'node:fs'

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

// **先に、空のリリースを作っておく**（2026-08-07）。
//
// これを入れるまで、`npm run release` は**1回目が必ず落ちていた**（5回連続）。
// 原因は競争で、ログには自分で書いてあった:
//
//   • creating GitHub release  reason=release doesn't exist tag=v0.1.31
//   • creating GitHub release  reason=release doesn't exist tag=v0.1.31   ← 2つ走る
//   ⨯ 422 Unprocessable Entity … "code": "already_exists"
//
// electron-builder は**添付ごとに発行を走らせる**ので、どちらも「まだ無い」を見て
// から作りに行く。先に作った方が勝ち、負けた方が 422 で**ビルドごと落ちる**。
// 2回目が通るのは、そのとき既にリリースが在るから——**回数が問題ではなく、
// 「在るかどうか」だけが問題だった。**
//
// だから、こちらで1回だけ作っておく。既に在るなら何もしない（`gh` が言ってくる）。
// **失敗しても止めない**——ここが本筋ではないので、発行に進んで数える側に任せる。
const tag = `v${JSON.parse(readFileSync('package.json', 'utf8')).version}`
{
  const r = spawnSync('gh', ['release', 'create', tag, '--title', tag, '--notes', tag], {
    encoding: 'utf8'
  })
  const 既にある = (r.stderr ?? '').includes('already exists')
  if (r.status === 0) console.log(`${tag} の入れ物を作りました（発行はここへ足していきます）`)
  else if (既にある) console.log(`${tag} は既にあります（そのまま足します）`)
  else console.error(`\x1b[33m入れ物を作れませんでした: ${(r.stderr ?? '').trim()}\x1b[0m`)
}

const published = run('publish:only')
if (published !== 0)
  console.error(`\n\x1b[33m発行が終了コード ${published} で終わりました。` +
    `**それでも添付を数えます**（中途半端に上がっていることがあるため）\x1b[0m\n`)

// **差し替え（JS だけの更新）も一緒に上げる。**
//
// electron-builder は自分が作った物しか上げないので、ここで足す。
// **発行の後**でなければならない——リリースがまだ無いと上げ先が無い。
//
// 上げ損ねても発行は止めない（差し替えが無ければインストーラで更新されるだけ）。
// ただし**黙って落とさない**: `check:release` が名前で数えて赤にする。
// 動いてしまう欠け方なので、機械が見ていないと誰も気づかない
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const bundled = spawnSync('node', ['scripts/make-bundle.mjs'], { stdio: 'inherit', env }).status
if (bundled === 0) {
  const up = spawnSync(
    'gh',
    [
      'release',
      'upload',
      `v${version}`,
      `dist/bundle-${version}.zip`,
      `dist/bundle-${version}.json`,
      '--clobber'
    ],
    { stdio: 'inherit', env }
  ).status
  if (up !== 0) console.error('\x1b[33m差し替えを上げられませんでした\x1b[0m')
} else {
  console.error('\x1b[33m差し替えを作れませんでした\x1b[0m')
}

const counted = run('check:release')
// **どちらかが落ちていれば赤。** 発行が落ちたのに添付が揃っていることは
// ありうる（再実行の後など）が、そのときも発行の失敗は隠さない
process.exit(published !== 0 || counted !== 0 ? 1 : 0)
