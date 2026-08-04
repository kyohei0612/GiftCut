// 重ねる段でも切片でも同じように要る、**小さなフィルタ片**だけを置く。
//
// ## 何も要らないときは空文字を返す
//
// 「既定値なら1つも挟まない」が全部に共通する決まり。挟むほど ffmpeg は遅くなり、
// 挟んだだけ絵が変わる危険も増える（色調整は 1.0 でも完全な素通しではない）。
// **呼ぶ側は判定せずに必ず呼んでよい**——要否はここが決める。
//
// ## 中身
//
// - `cropFilter` … 切り抜き。切った領域は下の段なら黒、重ねる段なら透明
// - `needsEq` … 色調整が要るか（1に近ければ何も挟まない）
// - `opacityFilter` … 不透明度。1（既定）なら何も挟まない
import type { ExportAdjust, ExportCrop } from './exportTypes'

/**
 * 切り抜き。各辺を内側へ切り込み、切った領域は `bg` で埋める（枠サイズは不変）。
 *
 * **重ねる段は透明**（下の映像が見える＝プレビューと一致）、
 * **いちばん下の段（本編の切片）は黒**（透ける先が無い）。
 */
export function cropFilter(
  c: ExportCrop | undefined,
  width: number,
  height: number,
  bg = 'black@0'
): string {
  if (!c || !(c.l > 1e-4 || c.t > 1e-4 || c.r > 1e-4 || c.b > 1e-4)) return ''
  const cl = Math.min(0.9, Math.max(0, c.l))
  const ct = Math.min(0.9, Math.max(0, c.t))
  const crg = Math.min(0.9, Math.max(0, c.r))
  const cb = Math.min(0.9, Math.max(0, c.b))
  const cw = Math.max(2, Math.round(width * (1 - cl - crg)))
  const ch = Math.max(2, Math.round(height * (1 - ct - cb)))
  const cx = Math.round(width * cl)
  const cy = Math.round(height * ct)
  return `,crop=${cw}:${ch}:${cx}:${cy},pad=${width}:${height}:${cx}:${cy}:color=${bg},setsar=1`
}

/** 色調整が要るか（1に近ければ何もしない＝無駄なフィルタを挟まない） */
export function needsEq(a: ExportAdjust | undefined): boolean {
  return (
    !!a &&
    (Math.abs(a.b - 1) > 1e-3 || Math.abs(a.c - 1) > 1e-3 || Math.abs(a.s - 1) > 1e-3)
  )
}

/** 不透明度。1（既定）なら何も挟まない */
export function opacityFilter(opacity: number | undefined): string {
  return opacity != null && opacity < 1
    ? `,colorchannelmixer=aa=${Math.max(0, opacity).toFixed(3)}`
    : ''
}
