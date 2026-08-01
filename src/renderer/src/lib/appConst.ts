// 画面ぜんたいで使う決め打ちの数と、小さな換算。
//
// ## なぜ独立した置き場にするか
//
// どれも**どこから読んでも同じ値**なのに、以前は App.tsx の中にあり、
// prop や deps として部品やフックへ配って回っていた（7か所）。
// 渡す物が1つ増えるたび、間に挟まる部品も「受け取って下へ渡すだけの係」になる。
// **配る価値が無い物は配らない。**
import { FPS_FALLBACK } from '../../../shared/timeline'

/** 最近開いたプロジェクトの控え */
export const RECENT_KEY = 'giftcut.recentProjects'
export const RECENT_MAX = 8

/** 素材の fps がまだ分からないときに使う値 */
export const FPS = FPS_FALLBACK

/**
 * つなぎ目を通り過ぎてから、2本目の映像を残しておく猶予（秒）。
 * 本編側が次の場所へ飛び終わるまで重ねておかないと、切り替わりで一瞬黒くなる。
 */
export const XF_GRACE = 0.08

/** ものさしの高さ */
export const RULER_H = 24

/**
 * タイムラインの上下に持たせる余白（テロップ何段ぶんか）。
 *
 * 端に貼り付いていると、上や下に足す余地が見えず窮屈に感じる。
 * ※位置の計算はすべて `RULER_H + この余白` を起点にすること。
 *   ここだけ足して他を直し忘れると、掴んだ場所と実際の段がずれる。
 */
export const TRACK_PAD_ROWS = 2

/**
 * 下書き（落ちたときの備え）を書く間隔。
 *
 * 落ちて失うのは最大でこの間隔ぶん。普通に閉じた場合は別途書き出すので
 * 取りこぼさない。短くすれば安心だが、そのぶん書き込みが増える。
 *
 * **確認のときだけ短くできるようにしてある。** 2分待つ確認は書けないので、
 * ここを外から縮められないと「下書きが本当に走っているか」を誰も見ないままになる
 * （復元する側だけ見て安心する、という空振りが起きる）。
 */
export const AUTOSAVE_MS = ((): number => {
  try {
    const v = Number(localStorage.getItem('giftcut.autosaveMs'))
    if (Number.isFinite(v) && v >= 500) return v
  } catch {
    /* localStorage が使えない環境では既定のまま */
  }
  // 2分。中身が変わっていないときは文字列にすらしないので、
  // 待機中・再生中の負担はゼロ。効くのは「編集し続けている間」だけ。
  return 2 * 60 * 1000
})()

/** 音量(0..1) を dB の表記へ */
export const gainToDb = (g: number): string =>
  g <= 0.0001 ? '-∞' : (20 * Math.log10(g)).toFixed(1)
