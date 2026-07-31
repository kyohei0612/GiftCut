// 切片の見た目（拡大・クロップ・色調整）の既定値と、プレビュー用の CSS。
//
// **「無調整かどうか」を1か所で決める。** 別々に判定を書くと、
// 保存する側と描く側で食い違い、「効いていないのに印だけ付く」が起きる。

export const DEFAULT_ZOOM = { scale: 1, x: 0, y: 0 }
export const isNeutralZoom = (z?: { scale: number; x: number; y: number }): boolean =>
  !z || (Math.abs(z.scale - 1) < 1e-3 && z.x === 0 && z.y === 0)
export const DEFAULT_CROP = { l: 0, t: 0, r: 0, b: 0 }
export const isNeutralCrop = (c?: { l: number; t: number; r: number; b: number }): boolean =>
  !c || (c.l < 1e-4 && c.t < 1e-4 && c.r < 1e-4 && c.b < 1e-4)
// クロップのCSS（プレビュー用・clip-path inset）。切った辺は下地(チェッカー)が見える。
export const cropInset = (c?: { l: number; t: number; r: number; b: number }): string | undefined =>
  isNeutralCrop(c)
    ? undefined
    : `inset(${(c!.t * 100).toFixed(2)}% ${(c!.r * 100).toFixed(2)}% ${(c!.b * 100).toFixed(2)}% ${(c!.l * 100).toFixed(2)}%)`
export const DEFAULT_ADJUST = { b: 1, c: 1, s: 1 }
// 色調整が実質「無調整」か
export const isNeutralAdjust = (a?: { b: number; c: number; s: number }): boolean =>
  !a || (Math.abs(a.b - 1) < 1e-3 && Math.abs(a.c - 1) < 1e-3 && Math.abs(a.s - 1) < 1e-3)
// CSS filter 文字列（プレビュー用）
export const adjustCss = (a?: { b: number; c: number; s: number }): string | undefined =>
  isNeutralAdjust(a) ? undefined : `brightness(${a!.b}) contrast(${a!.c}) saturate(${a!.s})`
