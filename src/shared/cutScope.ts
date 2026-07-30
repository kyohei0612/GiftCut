// 再生ヘッドで切るとき、**何を切るか**の決め方。
//
// 決まりは2つだけ。
//
//   何も選んでいない → 再生ヘッドの位置に載っている物を全部切る
//   何かを選んでいる → その選んだ物だけを切る
//
// 以前は種類ごとに判断が散らばっていて、「動画は常に全部・テロップだけ選択を見る・
// 効果音と画像と映像レイヤーはそもそも切れない」という食い違った状態だった。
// 判断を1か所に集めておけば、種類を足したときに揃え忘れない。

/**
 * その物を切る対象にするか。
 *
 * @param anySelected 画面のどこかで何か選ばれているか（種類は問わない）
 * @param selected    その物自身が選ばれているか
 */
export function shouldCut(anySelected: boolean, selected: boolean): boolean {
  return !anySelected || selected
}

/**
 * 切り口がその物の中にあるか。
 *
 * 端ぎりぎりで切ると**長さ0のかけら**ができ、掴めないゴミがタイムラインに残る。
 * 前後に少しだけ余裕を見て、端では切らない。
 */
export function spansCut(start: number, end: number, t: number, margin = 0.02): boolean {
  return start < t - margin && end > t + margin
}
