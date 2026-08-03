// 絵の中で「目印がどこに居るか」を測る。
//
// ## 何のためか
//
// **プレビューと書き出しで、同じ物が同じ場所に出ているか**を数で言うため。
// 「見た目が違う」は感覚では詰められない——右に何%ずれている、と出せば、
// どちらの式が違うかを1回で絞れる。
//
// ## 測り方
//
// いちばん明るい画素の**重なりの中心**（重心）を返す。目印には単色の四角を使う
// ので、しきい値より明るい所＝目印になる。返すのは 0〜1 の割合なので、
// **プレビュー（画面の実寸）と書き出し（1080p）を直接くらべられる。**
import { sh } from './shell.mjs'

/**
 * 明るい所の重心を 0〜1 の割合で返す。
 *
 * @param file    画像ファイル（png / 動画から抜いた1コマ）
 * @param thresh  これより明るい画素だけを見る（0〜255）
 * @returns {{x:number,y:number,n:number}} n は拾えた画素数（0 なら目印が無い）
 */
export async function brightSpot(file, thresh = 200) {
  // 生の灰色画像として吐かせて、こちらで数える。
  // （ffmpeg のフィルタだけで重心は出せない。geq は色を作る物で、集計はできない）
  const r = await sh('ffmpeg', [
    '-v', 'error', '-i', file,
    '-vf', 'format=gray,scale=160:90:flags=area',
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'
  ], { raw: true })
  const buf = r.raw
  const W = 160
  const H = 90
  if (buf.length < W * H) return { x: NaN, y: NaN, n: 0 }
  let sx = 0
  let sy = 0
  let n = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (buf[y * W + x] >= thresh) {
        sx += x
        sy += y
        n++
      }
    }
  }
  if (!n) return { x: NaN, y: NaN, n: 0 }
  return { x: sx / n / W, y: sy / n / H, n }
}
