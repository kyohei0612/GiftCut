// 画面の CSS を**重なり順のまま1本に**して返す。検査から使う。
//
// ## なぜ要るか
//
// `styles.css` は 2026-08-05 に区画ごと（`styles/*.css`）へ割った。
// CSS を読む検査は2つある——当たり判定の実寸（`hitArea.test.ts`）と
// 二重定義（`cssDuplicate.test.ts`）——が、**どちらも「1枚の styles.css」を
// 読む作りだった**ので、割った瞬間に両方が落ちた。
//
// ここで直す時、**読み込みを2か所に書き写すと、それ自体が重複**になる
// （CLAUDE.md「同じ知識が2か所」）。入口を1つにする。
//
// ## 並びは `styles.css` の `@import` から取る（一覧を書き写さない）
//
// CSS は**後に書いた方が勝つ**ので、順番そのものが仕様。ここに区画の名前を
// 並べ直すと、**区画を1つ足した日に、検査だけが古い並びを見続ける**。
// `styles.css` を読んで `@import` の順をそのまま使えば、その余地が消える。

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** `styles.css` の場所（このファイルから見た相対） */
const ROOT_CSS = join(__dirname, '..', 'renderer', 'src', 'styles.css')

/**
 * 画面の CSS 全部を、**当たる順に**繋いだ物。改行は `\n` に揃えてある。
 *
 * @throws 取り込みが1つも読めなかったとき（**黙って空を返さない**。
 *         空のまま検査を通すと「決まりを守っている」と嘘の緑が出る）
 */
export function readAppCss(): string {
  const root = readFileSync(ROOT_CSS, 'utf8').replace(/\r\n/g, '\n')
  const dir = dirname(ROOT_CSS)
  const parts = [...root.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map(([, rel]) =>
    readFileSync(join(dir, rel), 'utf8').replace(/\r\n/g, '\n')
  )
  if (parts.length === 0)
    throw new Error(`${ROOT_CSS} に @import が1つも無い（取り込みの書き方が変わった）`)
  return parts.join('\n')
}
