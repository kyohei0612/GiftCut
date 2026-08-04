// 通しe2e の**最後のまとめ**（件数・重い順・見ていない物・落ちた項目の書き出し）。
//
// ## なぜ本体から出したか（2026-08-04）
//
// `run.mjs` が 1,024行あり、**500行を超えると AI は通しで読まず grep に切り替わる**。
// ここは全部が終わったあとの話で、**回す側の事情を何も知らない**（results を
// 読んで出すだけ）。窓を閉じる・素材を捨てるは呼ぶ側に残してある——
// **アプリを落とす前に結果を出し切る**ためで、順番を入れ替えないこと。
//
// ## いちばん怖い壊れ方
//
// **前回の記録を今回の結果だと読むこと。** 落ちなかったときに
// `e2e/ng-report.json` を消すのはそのため（残っていると、緑なのに
// 「まだ落ちている」と読んで、直っている物をもう一度直しにいく）。
//
// 次に怖いのは**絞ったのに「通った」と読むこと**。--only のときは必ず
// 「N件は見ていません」を出す。ここを黙らせないこと。
//
// ## 中身
//
// - `printSummary` … まとめを出し、**落ちた件数を返す**（終了コードの元）
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @param o.results check が積んだ1件ずつの記録
 * @param o.ONLY 絞った言葉（空なら通し）
 * @param o.CHANGED_INFO --changed で選んだ内訳（無ければ null）
 * @param o.viewWarnRef 画面を戻し切れなかった回数
 * @param o.ROOT リポジトリの根（ng-report.json の置き場）
 * @returns 落ちた件数。**呼ぶ側はこれで終了コードを決める**
 */
export function printSummary({ results, ONLY, CHANGED_INFO, viewWarnRef, ROOT }) {
  const ok = results.filter((r) => r.ok).length
  const skipped = results.filter((r) => r.skipped).length
  const ng = results.filter((r) => !r.ok && !r.skipped)
  console.log(`\n\x1b[1m結果: ${ok} / ${results.length} 件が期待どおり\x1b[0m`)
  // **重い項目を名指しで出す。**
  //
  // 「数が多すぎる気がする」で削ると、軽くて価値のある物を消して、
  // 重くて価値の低い物が残る。どこに時間が乗っているかを毎回見せておく。
  const timed = results.filter((r) => r.ms != null).sort((a, b) => b.ms - a.ms)
  if (timed.length) {
    const all = timed.reduce((n, r) => n + r.ms, 0)
    console.log(`\n時間: 合計 ${(all / 60000).toFixed(1)}分。重い順に:`)
    for (const r of timed.slice(0, 10))
      console.log(`  ${(r.ms / 1000).toFixed(1).padStart(6)}秒  ${String(r.name).slice(0, 56)}`)
    const bySec = new Map()
    for (const r of timed) bySec.set(r.section, (bySec.get(r.section) ?? 0) + r.ms)
    console.log('章ごと:')
    for (const [name, ms] of [...bySec].sort((a, b) => b[1] - a[1]).slice(0, 6))
      console.log(`  ${(ms / 1000).toFixed(0).padStart(5)}秒  ${String(name).slice(0, 52)}`)
  }
  // 戻し切れなかった回数は必ず出す。**黙って流すと、次に何かが落ちたときに
  // 「本物か、前の項目の残りか」を毎回調べ直すことになる**
  if (viewWarnRef.n)
    console.log(
      `\x1b[33m※ 画面の状態を戻し切れなかった回数: ${viewWarnRef.n}（上の「戻し切れなかった」を参照）\x1b[0m`
    )
  // 絞って回したときは、必ず「全部は見ていない」と出す。
  // これが無いと、緑を見て「通った＝大丈夫」と読んでしまう。
  if (ONLY.length && skipped) {
    console.log(
      `\x1b[33m※ 絞って回しました（${ONLY.join(' / ')}）。${skipped} 件は見ていません。` +
        `最終確認は絞らずに 1 回。\x1b[0m`
    )
    if (CHANGED_INFO?.unknown.length) {
      console.log(
        `\x1b[33m※ 対応表に無いファイルの変更は見ていません: ${CHANGED_INFO.unknown.join(', ')}\x1b[0m`
      )
    }
  }
  if (ng.length) {
    console.log('\n直すべきもの:')
    for (const r of ng) {
      console.log(`  ・${r.name}\n      ${r.err}`)
      // 通しでだけ落ちるものは、あとから単体で回しても再現しない。
      // そのときの画面を書き出しておく（読むのはこの一覧だけで済む）。
      if (r.state) console.log(`      落ちた時: ${JSON.stringify(r.state)}`)
      if (r.png) console.log(`      画面: ${r.png}`)
    }
    try {
      writeFileSync(
        join(ROOT, 'e2e', 'ng-report.json'),
        JSON.stringify(ng.map(({ name, err, state, png }) => ({ name, err, state, png })), null, 2),
        'utf-8'
      )
      console.log('\n落ちた項目の詳細を e2e/ng-report.json に書き出しました。')
    } catch {
      /* 書けなくても実行結果には影響しない */
    }
  } else {
    // 落ちなかったのに前回の記録が残っていると、それを今回の結果だと読んでしまう
    try {
      rmSync(join(ROOT, 'e2e', 'ng-report.json'), { force: true })
    } catch {
      /* 無ければ何もしない */
    }
  }
  return ng.length
}
