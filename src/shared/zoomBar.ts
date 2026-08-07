// タイムラインの下に置く「拡大バー」。**掴む所で意味が変わる。**
//
//   真ん中を掴む … 見ている所を左右へ動かす（移動）
//   端のボッチ   … その端だけを動かす＝見える範囲が伸び縮みする（拡大・縮小）
//
// プレミアと同じ形。スライダーと横スクロールが別々にあると、
// 「どこを見ているか」と「どれだけ寄っているか」を2か所で操ることになる。
//
// ## なぜ画面から出すか
//
// **端を動かしたときに、反対の端が動いてはいけない。**
// 右のボッチを掴んだのに左まで動くと、見ていた場所を見失う。
// 画面では「なんとなく動いた」ようにしか見えず、ずれても気づけない。
//
// 計算そのものは「割合 ↔ 秒 ↔ 拡大率」の行き来だけなので、画面が無くても確かめられる。
//
// ## つまみの「最小の幅」は、ここでは決めない
//
// 寄るほどつまみは細くなり、細すぎると掴めない。ただし**ここで細さに下限を置くと、
// 拡大の上限（ZOOM_MAX）と2つの制限がぶつかる**——短い素材では、
// つまみの下限に先に当たって**上限まで寄れなくなる**（実際にそうなって試験で出た）。
// しかも Ctrl+ホイールは別の道なので、そちらでは寄れてしまい、
// つまみだけが「もう寄れない」と言う食い違いになる。
//
// 制限は**拡大率の上限・下限だけ**にして、細くなりすぎたつまみは
// **描くときに最低幅を持たせる**（CSS）。掴めればよいので、それで足りる。

/** 見えている範囲（バー全体に対する割合。0..1） */
export interface BarSpan {
  a: number
  b: number
}

/**
 * いま見えている範囲を、バー全体に対する割合で返す。
 *
 * @param scrollLeft いま左端が何px目か
 * @param viewW      見えている幅（px）
 * @param totalSec   タイムライン全体の長さ（秒）
 * @param zoom       px/秒
 */
export function barSpan(
  scrollLeft: number,
  viewW: number,
  totalSec: number,
  zoom: number
): BarSpan {
  const contentW = Math.max(1, totalSec * zoom)
  const a = Math.min(1, Math.max(0, scrollLeft / contentW))
  const b = Math.min(1, Math.max(a, (scrollLeft + viewW) / contentW))
  // 全部見えているときは端から端まで（つまみが消えない）
  return b - a >= 1 ? { a: 0, b: 1 } : { a, b }
}

/**
 * **丸めない**見えている範囲。掴んで動かすときの起点に使う。
 *
 * ## なぜ `barSpan` と分けるか（2026-08-06）
 *
 * `barSpan` は**描くための値**なので 0〜1 に収まっている。
 * ところが倍率はその外側へも動く——全部見えた後もさらに引けるし、
 * つまみが下限（28px）に達した後もさらに寄れる。
 * **つまり両端で、描いてある位置と本当の倍率が食い違う。**
 *
 * その状態で●を掴み、描いてある位置から倍率を出し直すと、
 * **掴んだ瞬間に本当の倍率へ飛ぶ**（本人の言葉:「ワープする」）。
 *
 * こちらは丸めないので、掴んだ時点の値が本当の倍率と一致する。
 * 掴んだ瞬間に何も起きない＝飛ばない。
 */
export function viewSpan(
  scrollLeft: number,
  viewW: number,
  totalSec: number,
  zoom: number
): BarSpan {
  const contentW = Math.max(1, totalSec * zoom)
  const a = scrollLeft / contentW
  return { a, b: a + viewW / contentW }
}

/**
 * つまみを動かした結果から、拡大率と見ている位置を出す。
 *
 * **端を動かしたときは、反対の端をそのまま残す。** 右を掴んだのに左が動くと、
 * 見ていた場所を見失う。ここでは渡された a・b をそのまま信じて、
 * 「その範囲が画面いっぱいになる拡大率」を出すだけにしてある。
 *
 * 拡大率が限界に当たったときは、**掴んでいない側を動かさない**ように
 * 位置の方を詰める（両端が同時に動くと、何を掴んだのか分からなくなる）。
 *
 * @param anchor どちらの端を掴んでいるか。'l' なら右端を、'r' なら左端を残す
 */
export function zoomFromSpan(
  span: BarSpan,
  totalSec: number,
  viewW: number,
  limits: { min: number; max: number },
  anchor: 'l' | 'r' | 'move' = 'move'
): { zoom: number; scrollLeft: number } {
  // **バーの外へはみ出した値も、そのまま受ける**（2026-08-06・本人の指定）。
  //
  // 前はここで 0〜1 に丸めていた。すると●を端まで持っていっても
  // 「全体がちょうど1画面」までしか行かず、**バーでは最大まで縮小できない**。
  // Ctrl+ホイールは下限（`minZoom`）まで引けるので、
  // **同じ物を操る2つの入口で、行ける所が違う**状態だった。
  //
  // 丸めをやめると (b-a) が 1 を超えられる＝1画面より広い範囲を指せるので、
  // 下の `limits.min` まで引き切れる。**行き過ぎは limits が止める**ので、
  // ここで先回りして丸める必要はない。
  const a = span.a
  // 端どうしが重なると秒数が 0 になって割り算が壊れる。ほんの少しだけ空ける
  const b = Math.max(a + 1e-6, span.b)
  const sec = Math.max(1e-6, (b - a) * totalSec)
  const zoom = Math.min(limits.max, Math.max(limits.min, viewW / sec))
  // 限界に当たると、その範囲は画面いっぱいにならない。
  // 掴んでいない端を残すように左端を決め直す
  const shownSec = viewW / zoom
  const startSec =
    anchor === 'l' ? Math.max(0, b * totalSec - shownSec) : a * totalSec
  return { zoom, scrollLeft: Math.max(0, startSec * zoom) }
}

/**
 * 全体表示のときに空ける余白（px）。中身が画面の端にぴったり付かないようにする。
 */
export const FIT_MARGIN_PX = 40

/**
 * 中身がちょうど収まる拡大率（px / 秒）。**全体表示の式はここ1つ。**
 *
 * 「↔ 全体表示」も、拡大バーを目一杯引いたときの下限も、通しの後始末
 *（e2e の restoreView）も、全部この率へ行き着く。式を別々に持つと、
 * 「フィットを押した所」と「バーの左端」が微妙に違う場所になる。
 */
export function fitZoom(viewW: number, totalSec: number): number {
  return (viewW - FIT_MARGIN_PX) / Math.max(totalSec, 10)
}

/**
 * 引ける下限（px / 秒）。**全体が収まる所までは引ける。**
 *
 * ## なぜ固定値ではいけないか（2026-08-03 に変えた）
 *
 * 以前は 6 px/秒 の固定で、理由は「これより引くとクリップが線になって掴めない。
 * 全体を見たいときは↔（フィット）がある」だった。**その逃げ道も塞がっていた**
 * ——`fitTimelineZoom` も同じ 6 で頭打ちしていたので、**長い素材では
 * ↔ を押しても全体が見えなかった**（451秒の実データで、6px/秒だと 2,706px 要る）。
 *
 * プレミアと同じく「目一杯引いたら全体が見える」に変える。
 *
 * ## 「全体が収まる所」で止める（2026-08-06・本人の指定でここへ来た）
 *
 * 前は固定の下限（`floor`）との**小さい方**を採っていた。短い素材では
 * 全体が収まる率の方が大きいので、**そこからさらに引けて右に空白が出た**。
 *
 * それをやめた理由は、**下のバーが表せなくなるから**。
 * バーのつまみは「見えている割合」なので、全部見えた時点で端から端まで＝満杯。
 * その先も引けると、**倍率だけ下がってバーは動かない**——本人の言葉:
 * 「縮小時、ここをマックスの値として下のバーの大きさをしてほしい。
 * 　この時点でバーがマックスやから、そこよ」。
 *
 * 全体が収まる所を限界にすると、**バーの端＝倍率の限界**が一致する。
 * 「引いたのにバーが動かない」区間そのものが消える。
 *
 * ※ 引数を減らした（前は固定の下限を受けていた）。**限界は中身の長さだけで決まる。**
 */
export function minZoom(viewW: number, totalSec: number): number {
  const fit = fitZoom(viewW, totalSec)
  return Number.isFinite(fit) && fit > 0 ? fit : 1
}

/**
 * 拡大したあとの横位置。**再生ヘッドを軸にする**（プレミアと同じ）。
 *
 * ## なぜカーソルではなく再生ヘッドか（2026-08-05・本人の指定）
 *
 * 前はカーソルの下の時刻を留めていた。**寄る先が毎回マウスの位置で変わる**ので、
 * 「寄ってから編集する」流れだと、寄った直後に見たい所（＝いま作業している時刻）が
 * 画面の端へ行ってしまう。編集で軸になるのは**いつも再生ヘッド**。
 *
 * ## 画面の外に居るときは、真ん中へ連れてくる
 *
 * ヘッドが見えていない状態でそのまま軸にすると、**画面の外の一点を留める**ことになり、
 * 寄るほど遠ざかる（見えない所を中心に回る）。見えていないなら真ん中へ寄せる
 * ——プレミアで寄ると再生ヘッドの所へ行く、という体感はこれ。
 *
 * @param t       再生ヘッドの時刻（秒）
 * @param nz      これから当てる拡大率（px / 秒）
 * @param headX   いまヘッドが画面のどこに居るか（px。負や幅超えは「画面の外」）
 * @param viewW   見えている幅（px）
 * @returns 当てるべき `scrollLeft`（px。負にはしない）
 */
export function scrollForZoomAtPlayhead(
  t: number,
  nz: number,
  headX: number,
  viewW: number
): number {
  // 見えているなら**そのままの位置に留める**（画面が動いたように見えない）
  const visible = headX >= 0 && headX <= viewW
  const anchorX = visible ? headX : viewW / 2
  return Math.max(0, t * nz - anchorX)
}

// **`keepPlayheadVisible` は消した**（2026-08-06・本人の指定）。
//
// 08-05 は「拡大バーの●は直接操作だから、ヘッドを軸にすると指の下から逃げる」
// という理屈で、**はみ出しそうなときだけ送り返す**関数を置いていた。
// 理屈は通っていたが、実際に触ると読めない動きになった（本人の言葉:
// 「拡大バーを触った瞬間だけ再生バーに追従するため、そこがぶつかって
// 拡大バーがバグる」）。
//
// **ほとんどの間は指に付いてくるのに、端に来た瞬間だけ別の力が働く。**
// いつ切り替わるかが手前で読めない物は、正しく動いていても不具合に見える。
// → バーも `scrollForZoomAtPlayhead` に統一した。●は指から離れるが、
//   **離れ方がいつも同じ**なので予測できる。

/** つまみを丸ごと動かしたとき（移動だけ。拡大率は変えない） */
export function panFromSpan(
  aNext: number,
  span: BarSpan,
  totalSec: number,
  zoom: number
): number {
  const w = span.b - span.a
  const a = Math.min(Math.max(0, aNext), Math.max(0, 1 - w))
  return Math.max(0, a * totalSec * zoom)
}
