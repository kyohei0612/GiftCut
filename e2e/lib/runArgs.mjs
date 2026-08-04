// 通しe2e の**引数を読む所**（--only / --changed / --ratio / --fast / --shot …）。
//
// ## なぜ本体から出したか（2026-08-04）
//
// `run.mjs` が 1,024行あり、**500行を超えると AI は通しで読まず grep に切り替わる**。
// 話題で分けたうちの1つ。ここは「何を回すかを決める」だけで、
// **画面にも Playwright にも一切触らない**（そのぶん単体で読める）。
//
// ## いちばん怖い壊れ方
//
// **知らないフラグは黙って無視される**（`includes` で拾っているだけ）。
// 打ち間違えると絞ったつもりで**全件（約13分）走る**。逆に、ここで
// `process.exit(2)` を弱めると「見ていないのに緑」を作る——`--changed` で
// 1件も選べなかったときに素通りさせると、0件を回して「通った」と読んでしまう。
// **成立しなければ落ちる**に倒してあるので、緩めないこと。
//
// ## 中身
//
// - `readRunArgs` … コマンドラインを1つの束にして返す
import { changedKeywords } from './changedArea.mjs'

/**
 * コマンドラインを読んで、通しe2e の設定を1つの束にして返す。
 *
 * **返す物を個別に配らず束のままにしてあるのは、渡し忘れを消すため。**
 * 呼ぶ側（run.mjs）は必要な物だけ取り出し、束ごと `makeRunReport` へ渡す。
 */
export function readRunArgs() {
const SLOW = process.argv.includes('--slow')
// --fast: 人が眺めるための「間」を置かない（機械が回すとき用）
const FAST = process.argv.includes('--fast')
const KEEP = process.argv.includes('--keep')
// 開発中は追加した項目だけ回したい。--only=キーワード で名前か章を絞る。
// ただし前の項目の状態を引き継ぐ確認もあるので、**最終確認は必ず絞らずに通す**。
const argAfter = (flag) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : null
}
// カンマで複数指定できる（--only=タブ,別ウィンドウ）。
// 1つしか指定できないと、章をまたいで起きることを再現できない。
// 実際「通しでだけ落ちる14件」の調査で、章をまたいで回せずに困った。
const ONLY = ((process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7) ||
  argAfter('--only') ||
  '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const CHANGED = process.argv.includes('--changed')
// 見た目を見たいだけのとき用。確認は一切せず、起動して復元して1枚撮って終わる。
// これが無いと、画面を見るためだけにテストを回すことになる。
const SHOT_ONLY = process.argv.includes('--shot')
/**
 * 画面の縦横比。既定は 16:9。
 *
 *   npm run e2e -- --ratio=9:16   ショート（縦長）で通す
 *
 * **縦長は横長の使い回しでは通らない。** 幅と高さが入れ替わるので、
 * テロップの箱・プレビューの当たり判定・書き出しの寸法が別々の壊れ方をしうる。
 * ショートを作る人には毎回効く所なので、同じ確認を縦長でも回せるようにする。
 * 比率は「プロジェクトを戻すたび」に当て直す（読み込みで 16:9 に戻るため）。
 */
const RATIO = (process.argv.find((a) => a.startsWith('--ratio=')) ?? '').slice(8) || '16:9'
if (!['16:9', '9:16', '1:1'].includes(RATIO)) {
  console.error(`知らない比率です: ${RATIO}（16:9 / 9:16 / 1:1）`)
  process.exit(2)
}
// --changed で選ばれた言葉。ONLY と同じ扱いで絞る
const CHANGED_INFO = CHANGED ? changedKeywords() : null
if (CHANGED_INFO) {
  ONLY.push(...CHANGED_INFO.words)
  console.log(
    `変更に関わる確認だけ回します: ${[...CHANGED_INFO.words].join(' / ') || '（該当なし）'}`
  )
  if (CHANGED_INFO.unknown.length) {
    console.log(
      `\x1b[33m対応表に無いファイルの変更（この実行では見ていない）:\x1b[0m\n  ${CHANGED_INFO.unknown.join('\n  ')}`
    )
  }
  if (!ONLY.length) {
    console.log('\x1b[33m選べる確認がありません。通しで回すか --only を指定してください。\x1b[0m')
    process.exit(2)
  }
}
const STEP = SLOW ? 600 : 0
  return { SLOW, FAST, KEEP, ONLY, CHANGED, SHOT_ONLY, RATIO, CHANGED_INFO, STEP }
}
