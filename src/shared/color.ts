// 色の算数——16進とRGB・HSV の行き来、oklab で混ぜる、不透明度の補間。
//
// ## なぜ shared に1本置いたか
//
// **同じ計算が2か所にあった**（2026-08-03 に統合）:
//
//   `components/FillPicker.tsx` … hexToRgb / rgbToHex / alphaAt
//   `lib/telopSvg.ts`           … _hex2rgb / _rgb2hex / _alphaAt
//
// しかも `telopSvg.ts` の頭のコメントが自分で
// 「`_` で始まる関数は…**呼びたくなったら、それは共通の計算なので
// `../../../shared` へ出す**」と書いていた。呼びたくなる前に既に割れていた形。
//
// **画面（CSS）と書き出し（SVG）で色がズレると原因が読めない**ので、
// 混ぜ方は必ずここの1本を通す。
//
// ## 混ぜるのは oklab で
//
// sRGB のまま混ぜると、金や銀のグラデが途中でくすむ（明るさの受け取り方が
// 目と違うため）。oklab へ移してから混ぜて戻すと、光沢が保たれる。
// SVG は oklab を受けないので、**焼く前にこちらで sRGB のストップへ直す**。

import { clamp } from './timeline'

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = (hex || '#000000').replace('#', '')
  // #abc のような3桁も受ける（統合前、telopSvg 側はこれを黒にしていた）
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16) || 0
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')
  )
}

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255
  g /= 255
  b /= 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  let h = 0
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: mx ? d / mx : 0, v: mx }
}

export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

/**
 * 不透明度ストップ列を位置 pos(0-1) で線形に混ぜて α(0-1) を返す。
 * 未指定・空は不透明(1)。並び順は当てにせず、必ず位置で並べ直してから見る。
 */
export function alphaAt(
  ops: { opacity: number; pos: number }[] | undefined,
  pos: number
): number {
  if (!ops || ops.length === 0) return 1
  const s = [...ops].sort((a, b) => a.pos - b.pos)
  if (pos <= s[0].pos) return s[0].opacity / 100
  if (pos >= s[s.length - 1].pos) return s[s.length - 1].opacity / 100
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i]
    const b = s[i + 1]
    if (pos >= a.pos && pos <= b.pos) {
      const t = (pos - a.pos) / (b.pos - a.pos || 1)
      return (a.opacity + (b.opacity - a.opacity) * t) / 100
    }
  }
  return 1
}

// --- oklab（混ぜるときだけ通る道） ---

function srgbToLinear(c: number): number {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function linearToSrgb(c: number): number {
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
}

function rgbToOklab(rgb: [number, number, number]): [number, number, number] {
  const r = srgbToLinear(rgb[0]),
    g = srgbToLinear(rgb[1]),
    b = srgbToLinear(rgb[2])
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}

function oklabToRgb(lab: [number, number, number]): [number, number, number] {
  const L = lab[0],
    A = lab[1],
    B = lab[2]
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B
  const s_ = L - 0.0894841775 * A - 1.291485548 * B
  const l = l_ * l_ * l_,
    m = m_ * m_ * m_,
    s = s_ * s_ * s_
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  ]
}

/** 2色を oklab で混ぜる（t=0 で c0、t=1 で c1）。返すのは16進。 */
export function oklabLerp(c0: string, c1: string, t: number): string {
  const p = hexToRgb(c0)
  const q = hexToRgb(c1)
  const a = rgbToOklab([p.r, p.g, p.b])
  const b = rgbToOklab([q.r, q.g, q.b])
  const out = oklabToRgb([
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ])
  return rgbToHex(out[0], out[1], out[2])
}
