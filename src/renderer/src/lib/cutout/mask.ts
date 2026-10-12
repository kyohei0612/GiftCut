// 透過（切り抜き）の、アルファの計算。**画面に依らない純粋な関数だけ。**
//
// 入力はアルファ1枚（Uint8ClampedArray・幅×高さ・0=透明/255=不透明）。
// 模型の答え（`./model`）も色で抜いた答え（`matteFromKey`）も同じ形にして、
// あとは同じ順で整える（`runCutoutPipeline`）。順番を変えると、同じ設定で
// 違う絵になるので、ここ1か所で決める。
//
// ## 中身
//
// - `matteFromKey`      … 拾った背景色に近い所を透明にする（模型なし）
// - `applyThreshold`    … どこまで透過するか（迷った所の足切り）
// - `applyLabels`       … ペンの指定（残す＝255／消す＝0）を上書き
// - `shiftEdge`         … 境界を縮める／広げる（min/max の箱フィルタ）
// - `boxBlur`           … 箱ぼかし（3回掛けるとガウスに近い）
// - `smoothEdge`        … ぼかしてから 128 で切り直す＝ギザギザとゴミ取り
// - `runCutoutPipeline` … 上を設定の順に通す
// - `composeAlpha`      … RGBA の A を差し替える

import type { CutoutSettings } from './types'

export type Alpha = Uint8ClampedArray

/**
 * 拾った背景色からの距離で抜く。tol（0..100）が近さの許容。
 * 距離が tol まで→透明、tol の 1.6 倍以上→不透明、間は直線でつなぐ
 * （段差を作らないため。段差があると縁に色の輪が残る）
 */
export function matteFromKey(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  key: { r: number; g: number; b: number; tol: number }
): Alpha {
  const out = new Uint8ClampedArray(w * h)
  // 距離の最大は √(255²×3) ≒ 441.7。tol 100 で半分まで抜ける程度に
  const t0 = (key.tol / 100) * 220
  const t1 = t0 * 1.6
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const dr = rgba[p] - key.r
    const dg = rgba[p + 1] - key.g
    const db = rgba[p + 2] - key.b
    const d = Math.sqrt(dr * dr + dg * dg + db * db)
    out[i] = d <= t0 ? 0 : d >= t1 ? 255 : Math.round(((d - t0) / (t1 - t0)) * 255)
  }
  return out
}

/** どこまで透過するか。t（0..100）以下の確信度は透明へ、残りは 0..255 に伸ばし直す */
export function applyThreshold(a: Alpha, t: number): Alpha {
  const T = Math.max(0, Math.min(254, Math.round((t / 100) * 255)))
  if (T === 0) return a
  const out = new Uint8ClampedArray(a.length)
  const k = 255 / (255 - T)
  for (let i = 0; i < a.length; i++) out[i] = a[i] <= T ? 0 : Math.round((a[i] - T) * k)
  return out
}

/** ペンの指定（0=なし / 1=残す / 2=消す）で上書き。指定が無ければ同じ物を返す */
export function applyLabels(a: Alpha, labels: Uint8Array | null): Alpha {
  if (!labels) return a
  const out = new Uint8ClampedArray(a)
  for (let i = 0; i < out.length; i++) {
    const l = labels[i]
    if (l === 1) out[i] = 255
    else if (l === 2) out[i] = 0
  }
  return out
}

/** 縦横に分けて掛ける min/max（半径 r の正方形）。shift>0 で広げ、<0 で縮める */
export function shiftEdge(a: Alpha, w: number, h: number, shift: number): Alpha {
  const r = Math.round(Math.abs(shift))
  if (r === 0) return a
  const pick = shift > 0 ? Math.max : Math.min
  const tmp = new Uint8ClampedArray(a.length)
  const out = new Uint8ClampedArray(a.length)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let v = a[row + x]
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w - 1, x + r)
      for (let k = x0; k <= x1; k++) v = pick(v, a[row + k])
      tmp[row + x] = v
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h - 1, y + r)
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x]
      for (let k = y0; k <= y1; k++) v = pick(v, tmp[k * w + x])
      out[y * w + x] = v
    }
  }
  return out
}

/** 箱ぼかし1回（半径 r）。端は内側の値で埋める（外を透明と見なすと縁が痩せる） */
export function boxBlur(a: Alpha, w: number, h: number, r: number): Alpha {
  r = Math.round(r)
  if (r <= 0) return a
  const tmp = new Float32Array(a.length)
  const out = new Uint8ClampedArray(a.length)
  const n = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let k = -r; k <= r; k++) sum += a[row + Math.min(w - 1, Math.max(0, k))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / n
      const add = a[row + Math.min(w - 1, x + r + 1)]
      const sub = a[row + Math.max(0, x - r)]
      sum += add - sub
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = Math.round(sum / n)
      const add = tmp[Math.min(h - 1, y + r + 1) * w + x]
      const sub = tmp[Math.max(0, y - r) * w + x]
      sum += add - sub
    }
  }
  return out
}

/** ぼかしてから 128 で切り直す。ギザギザが丸まり、ぼかし半径より小さなゴミが消える */
export function smoothEdge(a: Alpha, w: number, h: number, px: number): Alpha {
  const r = Math.round(px)
  if (r <= 0) return a
  const b = boxBlur(boxBlur(a, w, h, r), w, h, r)
  const out = new Uint8ClampedArray(a.length)
  for (let i = 0; i < out.length; i++) out[i] = b[i] >= 128 ? 255 : 0
  return out
}

/**
 * 設定の順で整える。**順番はここだけが持つ。**
 *
 *   足切り → ペンの指定 → 縮める/広げる → なめらか → ぼかし
 *
 * ペンを足切りの後に置くのは、「残す」と塗った所が確信度で消えないように。
 * ぼかしを最後に置くのは、縮めた後の縁をやわらげるため（先にぼかすと縮めたとき硬い縁に戻る）。
 */
export function runCutoutPipeline(
  matte: Alpha,
  labels: Uint8Array | null,
  s: CutoutSettings,
  w: number,
  h: number
): Alpha {
  let a = applyThreshold(matte, s.threshold)
  a = applyLabels(a, labels)
  a = shiftEdge(a, w, h, s.shift)
  a = smoothEdge(a, w, h, s.smooth)
  if (s.feather > 0) {
    const r = Math.max(1, Math.round(s.feather / 2))
    a = boxBlur(boxBlur(boxBlur(a, w, h, r), w, h, r), w, h, r)
  }
  return a
}

/** RGBA の A をアルファで差し替えた新しい配列 */
export function composeAlpha(rgba: Uint8ClampedArray, alpha: Alpha): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba)
  for (let i = 0, p = 3; i < alpha.length; i++, p += 4) out[p] = alpha[i]
  return out
}
