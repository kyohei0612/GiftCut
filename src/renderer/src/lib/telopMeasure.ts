// 文字が**実際にどこまで塗られるか**をブラウザに測らせる。
//
// ## なぜ推定しないか
//
// フォントごとに「上にどれだけ出るか」は違う。固定の係数で当てにいくと、
// フォントを1つ足すたびに合わなくなる。ここでは:
//
//   ベースラインの位置 … DOM に置いて**レイアウトエンジン自身に答えさせる**
//   インクの上下端     … canvas の TextMetrics（actualBoundingBox）で実測
//
// **固定係数・フォント別の推定は一切使わない**＝今後どんなフォントを入れても正確。
// Premiere はグラデーションを文字の実描画範囲に張るので、この範囲へストップを
// 写すと見た目が一致する。
//
// ## なぜ独立したファイルなのか
//
// 元は `telopStyle.ts`（623行）の中にあった。あちらの冒頭は
// 「テロップのスタイル定義」の1行だけで、**測る話は宣言されていなかった**。
// ここは DOM と canvas を触る唯一の場所で、CSS の組み立てとは道具が違う
//（2026-08-03 に出した）。
//
// 出したことで `telopSvg → telopStyle` の輪も細くなった
//（SVG 側が要るのは測る2つだけで、スタイルの定数とは無関係だった）。
//
// ## 画面が無い所では null が返る
//
// 試験や書き出しの下ごしらえでは canvas が作れない。**呼ぶ側で必ず見ること。**
import { makeLru } from './lru'

/**
 * グラデーションを張るときに、文字の上下へ足す余白（em）。
 *
 * **測る側と塗る側の両方が同じ値を見る必要がある**ので、測る側に置いてある。
 */
export const GRAD_PAD_EM = 0.35

let inkCtx: CanvasRenderingContext2D | null = null
let measHost: HTMLDivElement | null = null
// フォント名が鍵なので増えない（種類の数で頭打ち）
const baselineCache = new Map<string, number>()
/**
 * 測ったインクの範囲の控え。**上限を付けてある。**
 *
 * 鍵に**文字の中身**が入っている（下の key を見ること）ので、
 * 上限が無いと**1文字打つたびに新しい鍵ができ、古い物は一度も捨てられない**。
 * ＝編集した分だけ増え続ける。実際に「編集すればするほど重くなる」と言われていた。
 *
 * 2000件は、実物のプロジェクト（テロップ242個）の8倍。1本ぶん編集しても
 * 測り直しは起きず、打ち続けても増えない。
 */
const inkCache = makeLru<{ top: number; bottom: number }>(2000)

/**
 * 文字を測るための canvas。**1枚を使い回す。**
 *
 * 測るたびに作ると、テロップの数だけ canvas が増えて重くなる。
 * 画面の無い所（試験など）では作れないので null が返る——呼ぶ側で必ず見ること。
 */
export function inkContext(): CanvasRenderingContext2D | null {
  if (!inkCtx) inkCtx = document.createElement('canvas').getContext('2d')
  return inkCtx
}

// canvasのfontショートハンドが解析失敗する名前（数字始まり等）に備え、各ファミリーを引用符で包む版を作る
export const quoteFamilies = (fontFamily: string): string =>
  fontFamily
    .split(',')
    .map((t) => {
      const s = t.trim()
      if (!s || s.startsWith('"') || s.startsWith("'")) return s
      if (/^(sans-serif|serif|monospace|cursive|fantasy|system-ui)$/i.test(s)) return s
      return `"${s}"`
    })
    .join(', ')

// 行ボックス先頭からベースラインまでの距離(px, fontSize=100px時)をDOMで実測
function measureBaseline(fontFamily: string, fontWeight: number, lineHeight: number): number {
  const key = `${fontFamily}|${fontWeight}|${lineHeight.toFixed(3)}`
  const hit = baselineCache.get(key)
  if (hit != null) return hit
  const em = 100
  if (!measHost) {
    measHost = document.createElement('div')
    measHost.style.cssText =
      'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;white-space:pre'
    document.body.appendChild(measHost)
  }
  measHost.style.fontFamily = fontFamily
  measHost.style.fontWeight = String(fontWeight)
  measHost.style.fontSize = `${em}px`
  measHost.style.lineHeight = String(lineHeight)
  measHost.textContent = ''
  const span = document.createElement('span')
  span.textContent = 'あ永A'
  const marker = document.createElement('span')
  marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'
  measHost.append(span, marker)
  const baseline = marker.getBoundingClientRect().top - measHost.getBoundingClientRect().top
  baselineCache.set(key, baseline)
  return baseline
}

/**
 * 文字インクの縦範囲を実測し、パディング込みの塗り箱に対する割合で返す。
 *
 * 戻り値は 0..1。フォントが読み込み途中なら**控えに入れない**
 *（読み込み後の描き直しで正しい値になる）。
 */
export function measureInkRange(
  text: string,
  fontFamily: string,
  fontWeight: number,
  lineHeight: number
): { top: number; bottom: number } {
  const clampv = (v: number): number => Math.max(0, Math.min(1, v))
  const lines = text.split('\n')
  const first = lines[0] || 'あ'
  const last = lines[lines.length - 1] || 'あ'
  const key = `${fontFamily}|${fontWeight}|${lineHeight.toFixed(3)}|${lines.length}|${first.slice(0, 40)}|${last.slice(0, 40)}`
  const hit = inkCache.get(key)
  if (hit) return hit
  try {
    if (!inkCtx) inkCtx = document.createElement('canvas').getContext('2d')
    if (!inkCtx) return { top: 0, bottom: 1 }
    const em = 100
    const pad = GRAD_PAD_EM * em
    // fontショートハンドの解析失敗を検知（失敗すると前の値が残る）→ 引用符版で再設定
    const qf = quoteFamilies(fontFamily)
    inkCtx.font = '10px monospace'
    inkCtx.font = `${fontWeight} ${em}px ${qf}`
    if (inkCtx.font === '10px monospace') inkCtx.font = `${fontWeight} ${em}px sans-serif`
    const m1 = inkCtx.measureText(first)
    const mN = first === last ? m1 : inkCtx.measureText(last)
    const inkA = m1.actualBoundingBoxAscent ?? em * 0.88
    const inkD = mN.actualBoundingBoxDescent ?? 0
    // ベースライン位置はDOM実測（レイアウトと同じ答え）
    const baseline = measureBaseline(fontFamily, fontWeight, lineHeight)
    const lh = lineHeight * em
    const n = lines.length
    const boxH = n * lh + pad * 2
    const top = clampv((pad + baseline - inkA) / boxH)
    const bottom = Math.max(top, clampv((pad + (n - 1) * lh + baseline + inkD) / boxH))
    const r = { top, bottom }
    // フォント未ロード中の誤計測をキャッシュしない（ロード後の再描画で正しい値に更新される）
    let loaded = true
    try {
      loaded = document.fonts.check(`${fontWeight} ${em}px ${qf}`)
      if (!loaded) void document.fonts.load(`${fontWeight} ${em}px ${qf}`)
    } catch {
      /* check不可なら毎回実測 */
    }
    if (loaded) inkCache.set(key, r)
    return r
  } catch {
    return { top: 0, bottom: 1 }
  }
}
