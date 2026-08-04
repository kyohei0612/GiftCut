// 描いた絵の「中身がある範囲」を出す。**書き出しを速くするための土台。**
//
// ## なぜ要るか
//
// テロップは1枚ずつ**全画面（1920x1080）の透過PNG**として焼いていた。
// ffmpeg はその全画面を毎コマ重ねるので、枚数ぶん丸ごと合成することになる。
//
// 2026-08-04 の実測（1080p60・30秒ぶん・テロップ100枚）:
//
//   重ねない            3.6秒
//   全画面PNG           7.8秒   ← いままで
//   文字ぶんだけのPNG   4.0秒   ← **1.95倍速い**
//
// **書き出し時間のおよそ半分が、透明な部分の合成に使われていた。**
//
// ## 枠は数式では出せない。**描いた画素から取る**
//
// テロップは `foreignObject` の中の HTML として描かれる（位置も大きさも
// CSS レイアウトが決める）。文字送り・折り返し・縁取り・影・アイコンまで
// 入るので、「この cue はここに出るはず」を手で計算すると必ずズレる。
//
// → **描いてから、透明でない所を探す。** 出た枠に切り詰めて、その左上を
//    overlay の x/y に渡せば、合成結果は1画素も変わらない（定義上）。
//
// ## ここを純関数にしてある理由
//
// 画素を触る所を canvas から切り離しておくと、**画面を起動せずに固定できる**。
// 位置ズレは**書き出してからしか分からない**（プレビューは別の道を通る）ので、
// ここだけは目視に頼らず機械で押さえる。

/** 中身のある範囲。無ければ null（＝1画素も描かれていない） */
export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

/**
 * RGBA の並びから、**不透明な画素を含む最小の長方形**を返す。
 *
 * @param data `ctx.getImageData()` の中身（RGBA が1画素4つずつ並ぶ）
 * @param w 画像の幅（画素）
 * @param h 画像の高さ（画素）
 * @param pad 枠の外側へ足す余白（画素）。**縁のなめらか処理を切らないための保険**。
 *   アルファが 0 でなければ拾うので理屈では不要だが、0 に丸められた
 *   ごく薄い画素が端にあると1画素欠ける。既定 2。
 *
 * ※ **アルファが 0 より大きい物は全部拾う。** 「薄いから要らない」と
 *   しきい値を上げると、**ぼかした影の裾が切れて絵が変わる**。
 */
export function opaqueBounds(
  data: Uint8ClampedArray | number[],
  w: number,
  h: number,
  pad = 2
): Bounds | null {
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    const row = y * w * 4
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] === 0) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  const x0 = Math.max(0, minX - pad)
  const y0 = Math.max(0, minY - pad)
  const x1 = Math.min(w - 1, maxX + pad)
  const y1 = Math.min(h - 1, maxY + pad)
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}
