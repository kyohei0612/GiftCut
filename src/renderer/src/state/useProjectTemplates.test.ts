// プロジェクトを開いても、**アプリのライブラリへ焼き付けない**こと。
//
// ## 直した症状（2026-08-03）
//
// 本人「テンプレートに保存をしてないのに前回のデータが勝手に持ち越されてる。
// その場で作ったテロップやアイコン…これじゃデフォルトのテンプレートが意味をなさない」。
//
// `useProjectTemplates` はプロジェクトを開くとき、中に入っていた
// ★・分類・自作フォルダ・自作テロップ・アイコン割り当てを**混ぜて**画面に出す。
// そこまでは正しい（人からもらったプロジェクトでも見た目が再現する）。
// 問題は**その結果を `saveFavorites` などで localStorage へ書いていた**こと——
// **プロジェクトを1つ開くだけでアプリ側に焼き付き、新規で始めても残った。**
//
// ## なぜ「呼んでいないこと」を見張るのか
//
// **振る舞いの不在なので、動かして確かめるのが難しい。**
// e2e で見るには「テンプレ入りのプロジェクトを開く → 新規にする →
// ライブラリを覗く」まで要り、確認したい所から遠い。
// ここは `readability.test.ts` / `noDuplicate.test.ts` と同じで、**ソースを読んで**
// 決まりを守らせる。
//
// ## 戻したくなったら
//
// **置き換えに戻す話ではない。** 混ぜるのは今までどおりで、保存だけしない。
// 上の逆（プロジェクト側で置き換える）にすると、テンプレを1回開いただけで
// 育てた設定が全部消える——それは 2026-08-02 以前に実際に起きた事故で、
// `useProjectTemplates.ts` の真上にその理由が書いてある。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(HERE, 'useProjectTemplates.ts'), 'utf8')

/** コメントを落とす（説明文の中の save… に反応しないように） */
const code = src
  .split(/\r?\n/)
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n')

describe('プロジェクトを開いても、アプリのライブラリへ焼き付けない', () => {
  it('**ライブラリへ保存する関数を呼んでいない**', () => {
    const calls = code.match(
      /\bsave(Favorites|CatOverrides|CustomCats|UserTemplates|IconAssign)\s*\(/g
    )
    expect(
      calls ?? [],
      '\nプロジェクトを開く道で ' +
        (calls ?? []).join(' / ') +
        ' を呼んでいる。\n' +
        '**混ぜて画面に出すのはよいが、保存はしないこと**（上の説明を読むこと）'
    ).toEqual([])
  })

  it('**混ぜるのはやめていない**（画面に出す分は今までどおり）', () => {
    // 保存を消すついでに「混ぜる」まで消すと、人からもらったプロジェクトを
    // 開いても見た目が再現しなくなる。そこは残っていること
    for (const fn of ['mergeFavorites', 'mergeAssignments', 'mergeFolders', 'mergeNamed']) {
      expect(code, `${fn} を通らなくなっている`).toContain(`${fn}(`)
    }
  })

  it('**画面には出している**（setXxx は残っている）', () => {
    for (const fn of ['setFavorites', 'setCatOverrides', 'setCustomCats', 'setUserTemplates']) {
      expect(code, `${fn} が無い＝混ぜた結果が画面に出ない`).toContain(`${fn}(`)
    }
  })
})
