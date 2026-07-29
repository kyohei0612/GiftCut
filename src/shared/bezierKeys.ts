// キーフレームの「ベジェのつなぎ方」。
//
// いまの keyframes.ts は linear / hold / ease の3種しか持っていない。
// Premiere と After Effects は**キーごとに接線を持つ**形なので、そのままでは
// 向こうで作った動きを写し取れない（＝完コピできない）。ここはその土台。
//
// ## 向こうの持ち方（.prfpset を読んで確かめた）
//
// キー1つが「速度（value/秒）」と「影響（区間に対する割合 0..1）」を、
// **入り側と出側で別々に**持つ。
//
//   [時刻][値][…][入りの速度][入りの影響][出の速度][出の影響]
//
// 区間 A→B は、この4つから三次ベジェの制御点が決まる:
//
//   P0 = (tA, vA)
//   P1 = (tA + iA*dt,  vA + sA*iA*dt)   ← A の「出」
//   P2 = (tB - iB*dt,  vB - sB*iB*dt)   ← B の「入り」
//   P3 = (tB, vB)
//
// **速度が直線の傾きと同じなら、制御点が一直線に並んで直線になる。**
// 実際、読み込んだ素材の多くはこれ（影響が 1/6 や 1/3 でも直線）。
//
// ## 時刻から値を出すには
//
// x（時刻）も三次式なので、「この時刻はベジェのどこか」を先に解く必要がある。
// 解析的に解くと場合分けが増えるので、**二分探索で詰める**（単調増加が保証されて
// いるので確実に収束する。60回も回せば倍精度の限界まで届く）。
//
// ## 書き出しはどうするか
//
// ffmpeg の式では三次方程式を解けない（繰り返しが書けない）。
// なので**折れ線に潰してから**式にする。潰し方は flattenBezier に置いてある。
// プレビューはベジェのまま評価するので、**同じ絵になるかは刻み幅で決まる**。
// どれくらい刻めば足りるかはテストで測ってある。

/** キー1つが持つ接線。速度は「値/秒」、影響は区間に対する割合（0..1） */
export interface Tangent {
  /** 値/秒 */
  speed: number
  /** 区間に対する割合。Premiere の既定は 1/6 か 1/3 */
  influence: number
}

export interface BezierKey {
  /** クリップの先頭からの秒 */
  t: number
  v: number
  /** 入り側（前の区間から来るときの接線） */
  in?: Tangent
  /** 出側（次の区間へ出ていくときの接線） */
  out?: Tangent
}

/** 影響を渡していないときの既定（Premiere と同じ 1/6） */
export const DEFAULT_INFLUENCE = 1 / 6

const cubic = (p0: number, p1: number, p2: number, p3: number, s: number): number => {
  const u = 1 - s
  return u * u * u * p0 + 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s * p3
}

/** 区間 a→b の制御点（時刻・値の2軸ぶん） */
function controls(
  a: BezierKey,
  b: BezierKey
): { tx: [number, number, number, number]; vy: [number, number, number, number] } {
  const dt = b.t - a.t
  const iA = Math.min(1, Math.max(0, a.out?.influence ?? DEFAULT_INFLUENCE))
  const iB = Math.min(1, Math.max(0, b.in?.influence ?? DEFAULT_INFLUENCE))
  // 速度を渡していない項目は「直線の傾き」＝結果として直線になる
  const slope = dt === 0 ? 0 : (b.v - a.v) / dt
  const sA = a.out?.speed ?? slope
  const sB = b.in?.speed ?? slope
  return {
    tx: [a.t, a.t + iA * dt, b.t - iB * dt, b.t],
    vy: [a.v, a.v + sA * iA * dt, b.v - sB * iB * dt, b.v]
  }
}

/**
 * その時刻の値（1区間ぶん）。
 * 時刻の軸も三次なので、二分探索で「どこか」を出してから値を読む。
 */
export function bezierValueAt(a: BezierKey, b: BezierKey, t: number): number {
  if (t <= a.t) return a.v
  if (t >= b.t) return b.v
  const { tx, vy } = controls(a, b)
  let lo = 0
  let hi = 1
  // 60回で倍精度の刻みまで詰まる（時刻の軸は単調なので必ず挟み込める）
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (cubic(tx[0], tx[1], tx[2], tx[3], mid) < t) lo = mid
    else hi = mid
  }
  return cubic(vy[0], vy[1], vy[2], vy[3], (lo + hi) / 2)
}

/** 全区間ぶん。範囲の外は端の値で止める（プレミアと同じ） */
export function bezierAt(keys: BezierKey[], t: number, fallback: number): number {
  if (!keys.length) return fallback
  if (keys.length === 1) return keys[0].v
  if (t <= keys[0].t) return keys[0].v
  const last = keys[keys.length - 1]
  if (t >= last.t) return last.v
  for (let i = 0; i < keys.length - 1; i++) {
    if (t >= keys[i].t && t < keys[i + 1].t) return bezierValueAt(keys[i], keys[i + 1], t)
  }
  return last.v
}

/**
 * 折れ線に潰す（書き出し用）。
 *
 * ffmpeg の式では三次方程式を解けないので、刻んで直線でつなぐ。
 * **刻みは「その動きが実際に描かれるコマ」に合わせる**のが素直なので、
 * fps を渡す形にした（30fps なら 1/30 秒ごと）。
 *
 * 直線の区間（速度が傾きと同じ）は刻まない。刻んでも同じ物が増えるだけで、
 * 式が長くなるだけ損なため。
 */
export function flattenBezier(keys: BezierKey[], fps: number): { t: number; v: number }[] {
  if (keys.length < 2) return keys.map((k) => ({ t: k.t, v: k.v }))
  const step = 1 / Math.max(1, fps)
  const out: { t: number; v: number }[] = [{ t: keys[0].t, v: keys[0].v }]
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    const dt = b.t - a.t
    if (dt > 0 && !isStraight(a, b)) {
      for (let t = a.t + step; t < b.t - 1e-9; t += step) {
        out.push({ t, v: bezierValueAt(a, b, t) })
      }
    }
    out.push({ t: b.t, v: b.v })
  }
  return out
}

/** その区間が実質まっすぐか（制御点が一直線に並んでいるか） */
export function isStraight(a: BezierKey, b: BezierKey): boolean {
  const dt = b.t - a.t
  if (dt <= 0) return true
  const slope = (b.v - a.v) / dt
  const sA = a.out?.speed ?? slope
  const sB = b.in?.speed ?? slope
  const scale = Math.max(1e-9, Math.abs(slope))
  return Math.abs(sA - slope) / scale < 1e-6 && Math.abs(sB - slope) / scale < 1e-6
}
