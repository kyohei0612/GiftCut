// **色をどう混ぜて、CSS の文字列にするか。** 単色・不透明度・グラデーション。
//
// ## 画面と書き出しで同じ色にする
//
// 画面は CSS（ここ）、書き出しは SVG（./telopSvg）と**経路が2つある**。
// 混ぜ方を別々に書くと、同じテロップが画面と書き出しで違う色になる。
// **中間点の決め方（`resolveGradMid`）は必ずここを通すこと**——あちらも
// ここを import している。
//
// ※ oklab の変換そのものは `shared/color`（画面・書き出し・色ピッカーで共通）。
//
// ## 中間点は「未指定なら明暗から寄せる」
//
// 本家は中間点を持つが、こちらは持たないテロップが大量にある。
// 0.5 固定にすると暗い色から明るい色へのグラデが濁って見えるので、
// 明るさの差だけ寄せる（`GRAD_MID_BIAS`）。
//
// ## なぜ ./telopStyle から出したか（2026-08-04）
//
// あちらは534行で、記号解決で測ったら**この群は受け取る0・返す0**——
// 他の話題と1つも名前を取り合っていなかった（`引き継ぎ-心臓の分け直し.md`）。
//
// ## 中身
//
// - `hexToRgba` … #rrggbb ＋ 不透明度(%) → rgba()
// - `_lum` … 明るさ。色の濃さを見て自動で決める所で使う
// - `GRAD_MID_BIAS` … 中間点をどれだけ明暗へ寄せるか
// - `resolveGradMid` … グラデの中間点。未指定なら色の明暗から寄せる
// - `gradientStopStr` … グラデのストップ列を CSS の文字列にする
// - `isVerticalGrad` … 縦向きのグラデか（縦だけ文字の実描画範囲へ写す）
// - `fillCss` … 塗り（単色 or グラデ）の CSS
import type { TelopStyle } from './telopStyle'

/** #rrggbb + 不透明度(0-100) → rgba() */
export function hexToRgba(hex: string, opacityPercent: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16) || 0
  const g = parseInt(h.substring(2, 4), 16) || 0
  const b = parseInt(h.substring(4, 6), 16) || 0
  return `rgba(${r}, ${g}, ${b}, ${(opacityPercent / 100).toFixed(3)})`
}

// 塗りのCSS（単色 or 線形グラデ）。グラデは background-clip:text で文字に乗せる（縁取りは別途 text-shadow）。
/**
 * グラデのストップ列を CSS 文字列化。Premiereの「色中間点」を CSSカラーヒント（区間中の裸の%）で再現。
 * mid = そのストップと次のストップの間で色が50%になる位置(0-1)。既定0.5＝等間隔。
 * map: ストップ位置(0-1)→塗り箱上の位置(0-1) への変換（インク範囲マッピング）。省略時は恒等。
 */
// #rrggbb → 相対輝度(0-255相当・順序比較用の簡易式)
function _lum(hex: string): number {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16) || 0
  const g = parseInt(h.substring(2, 4), 16) || 0
  const b = parseInt(h.substring(4, 6), 16) || 0
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * グラデ既定の色中間点バイアス。Premiereは暗い色を長めに保ってから明色へ移る（暗部が広い）。
 * CSSの既定は対称(0.5)で淡色へ早く移り「薄く」見えるため、明示midが無い区間は
 * 暗い方の色を長く保つよう中間点をずらす。0=無効, 0.2=暗部を約40%広げる（本家寄せの実測値）。
 */
export const GRAD_MID_BIAS = 0.2

/**
 * 2色間の実効中間点(0-1)を返す。明示mid優先。無指定なら「暗い色を長く保つ」バイアスを適用。
 * プレビュー(gradientStopStr)と書き出し(_gradDef)で同一ロジックを共有する。
 */
export function resolveGradMid(color0: string, color1: string, explicit?: number): number {
  if (explicit != null && explicit > 0 && explicit < 1) return explicit
  if (GRAD_MID_BIAS > 0) {
    const d = _lum(color1) - _lum(color0) // +: color1が明るい → color0(暗)を長く保つ=midを大きく
    if (Math.abs(d) > 4) return 0.5 + GRAD_MID_BIAS * Math.sign(d)
  }
  return 0.5
}

export function gradientStopStr(
  stops: { color: string; pos: number; mid?: number }[],
  map?: (p: number) => number
): string {
  const f = map ?? ((p: number) => p)
  const parts: string[] = []
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i]
    parts.push(`${s.color} ${(f(s.pos) * 100).toFixed(2)}%`)
    const next = stops[i + 1]
    if (!next) continue
    const mid = resolveGradMid(s.color, next.color, s.mid)
    if (mid > 0 && mid < 1 && Math.abs(mid - 0.5) > 0.01) {
      const hint = s.pos + mid * (next.pos - s.pos) // 中間点の絶対位置
      parts.push(`${(f(hint) * 100).toFixed(2)}%`)
    }
  }
  return parts.join(', ')
}

/** 縦方向（Premiere角度90°±45）の線形グラデか（インク範囲マッピングの適用対象） */
export const isVerticalGrad = (g: { type?: string; angle: number }): boolean => {
  if (g.type === 'radial') return false
  const a = ((g.angle % 360) + 360) % 360
  return Math.abs(a - 90) <= 45 || Math.abs(a - 270) <= 45
}

export function fillCss(
  fill: TelopStyle['fill'],
  ink?: { top: number; bottom: number }
): React.CSSProperties {
  if (!fill.enabled) return { color: 'transparent' }
  const g = fill.gradient
  if (g && g.stops.length >= 2) {
    // 縦グラデはインク実測範囲へマップ（フォントを問わず上下端がPremiereと一致）
    const map =
      ink && isVerticalGrad(g) ? (p: number): number => ink.top + p * (ink.bottom - ink.top) : undefined
    const stops = gradientStopStr(g.stops, map)
    // 角度: Premiere準拠（90°=縦）。CSSの linear-gradient は 90deg=横なので +90 して合わせる。
    // ★補間空間 oklab: sRGB既定だと金の中間色が濁って暗くなる（Premiereの描画エンジンと乖離）。
    //   oklabで補間すると金属光沢が出てPremiereに寄る（実測確認済み）。
    const img =
      g.type === 'radial'
        ? `radial-gradient(in oklab circle, ${stops})`
        : `linear-gradient(in oklab ${g.angle + 90}deg, ${stops})`
    return {
      color: 'transparent',
      backgroundImage: img,
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text'
    }
  }
  return { color: fill.color }
}
