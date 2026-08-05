// **同じセレクタを2度書いて、片方だけ上書きしていないか。**
//
// ## なぜ要るか（2026-08-05 に本物を1件見つけた）
//
// `.snap-line` が2か所にあった。磁石の線を「実線のピンク」から
// 「点線の水色」へ作り直したとき、**古い方を消し忘れていた**。
//
//   前（消し残り）  width: 2px / background: #ff4df0 / box-shadow: 0 0 4px #ff4df0aa
//   後（本物）      width: 0   / border-left: 1px dashed var(--accent-2)
//
// 後ろが勝つので `width` と線は効かない。**ところが `background` と `box-shadow` は
// 後ろで書き直されていないので生き残る**——実際に出ていたのは
// 「**水色の破線に、マゼンタの発光が付いた線**」で、
// **どちらの定義を読んでも出てこない絵**だった。しかも後ろのコメントには
// 「実線のピンクは紛らわしいので消した」と書いてある。文章は正しく、絵だけが嘘。
//
// ## なぜ既存の検査で拾えなかったか
//
//   `fileSize.test.ts`     … 見る拡張子が `.ts/.tsx/.mjs/.js`。**CSS を1行も見ない**
//   `noDuplicate.test.ts`  … `src/shared` の TS だけ。しかも「同じ形の物」を探す作り
//
// **どちらの網の目からも落ちる場所**だった。CSS は 4,798行あって次に大きい
// ファイルの8倍以上あるのに、見張りが1つも無かった。
//
// ## 何を赤にするか
//
// **「2回書いた」こと自体は赤にしない。** 後から `transition` だけ足す、
// 色と大きさを別の節で書く、といった書き方が実際にあり（`.icon-btn` `.clip` など）、
// それらは衝突していない。赤にするのは**同じ性質を2度書いている**時だけ
// ——そこだけが「どちらが効くのか読んで分からない」場所になる。

import { describe, it, expect } from 'vitest'
import { readAppCss } from './appCss'

// **区画ごとに割ってあるので、当たる順に繋いだ物を見る**（`shared/appCss`）。
// ここで見たいのは「後から上書きし合っていないか」なので、**順番が命**。
// ファイルを1つずつ別々に見ると、**区画をまたいだ二重定義を取り逃がす**
// （`.snap-line` は実際に 2473行 と 2612行＝別の区画に分かれた）。
const CSS = readAppCss()
  // コメントの中の `{` `}` を規則の切れ目と読み違えないよう、先に落とす
  .replace(/\/\*[\s\S]*?\*\//g, '')

/** セレクタ → そこで書いている性質の名前（同じ規則の中で2回書くのは意図なので数えない） */
function propsBySelector(): Map<string, string[][]> {
  const out = new Map<string, string[][]>()
  for (const [, sel, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const key = sel.trim().replace(/\s+/g, ' ')
    // `@media` や `@keyframes` は入れ子なので、この単純な走り方では
    // **中身だけが規則として出てくる**（外側の `@…` は `{` の前の文字列として
    // 消える）。アニメの段（`from` / `to` / `50%`）は、**別のアニメどうしでも
    // 同じ名前になる**ので、そのまま数えると全部が二重に見える（実際そうなった）。
    if (!key || key.startsWith('@') || key === 'from' || key === 'to') continue
    if (/^-?[\d.]+%$/.test(key)) continue
    const props = [...body.matchAll(/(^|;)\s*([a-z-]+)\s*:/g)].map((m) => m[2])
    if (!out.has(key)) out.set(key, [])
    out.get(key)?.push([...new Set(props)])
  }
  return out
}

describe('styles.css に、上書きし合う二重定義が無い', () => {
  const map = propsBySelector()

  it('走り方が壊れていない（規則が拾えている）', () => {
    expect(map.size).toBeGreaterThan(300)
  })

  it('**同じセレクタで、同じ性質を2度書いていない**（どちらが効くか読めなくなる）', () => {
    const bad: string[] = []
    for (const [sel, blocks] of map) {
      if (blocks.length < 2) continue
      const seen = new Set<string>()
      const dup = new Set<string>()
      for (const props of blocks)
        for (const p of props) {
          if (seen.has(p)) dup.add(p)
          seen.add(p)
        }
      if (dup.size)
        bad.push(`${sel} … ${blocks.length}か所で ${[...dup].sort().join(', ')} を二重に指定`)
    }
    expect(
      bad,
      '\n' +
        bad.join('\n') +
        '\n\n後ろが勝つが、**書き直していない性質は前のが生き残る**。' +
        '\n片方に寄せて、もう片方を消すこと（`.snap-line` の実例はこのファイルの頭）\n'
    ).toEqual([])
  })
})
