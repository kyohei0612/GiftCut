// ペンで塗った線を「残す／消す」の指定（labels）に落とす。**画面に依らない。**
//
// labels は幅×高さの Uint8Array。0=指定なし / 1=残す / 2=消す。
// 後に塗った線が勝つ（塗り直しがきく）。
//
// ## かしこく塗る（smart）
//
// 雑に線を引いても境界を読んでほしい、が本人の要望。線の下の色から始めて、
// **似た色が続く所へ広げる**（塗りつぶしと同じ）。広がる範囲は線の太さの
// 数倍までに抑える——抑えないと、空と同じ色の服まで一息に抜ける。
//
// ## 中身
//
// - `rasterizeStrokes` … 線の並びを labels にする（smart なら色で広げる）
// - `stampDisc`        … 1点に丸を打つ（線は点の連なり）
// - `smartGrow`        … 線の下の色を種に、似た色へ広げる（線から一定の距離まで）
// - `similar`          … 隣の画素が似た色か

import type { CutoutStroke } from './types'

export function stampDisc(labels: Uint8Array, w: number, h: number, cx: number, cy: number, r: number, v: 1 | 2): void {
  const x0 = Math.max(0, Math.floor(cx - r))
  const x1 = Math.min(w - 1, Math.ceil(cx + r))
  const y0 = Math.max(0, Math.floor(cy - r))
  const y1 = Math.min(h - 1, Math.ceil(cy + r))
  const rr = r * r
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx
      if (dx * dx + dy * dy <= rr) labels[y * w + x] = v
    }
  }
}

/** 似た色か（チャンネルごとの差の合計で見る。速さ優先） */
function similar(rgba: Uint8ClampedArray, a: number, b: number, tol: number): boolean {
  const pa = a * 4
  const pb = b * 4
  return (
    Math.abs(rgba[pa] - rgba[pb]) + Math.abs(rgba[pa + 1] - rgba[pb + 1]) + Math.abs(rgba[pa + 2] - rgba[pb + 2]) <=
    tol
  )
}

/**
 * 線の下の画素を種にして、似た色へ広げる。広がるのは線から `reach` px 以内。
 * 種は「線の中心に近い画素」だけ（縁の画素を種にすると背景色まで種に混じる）
 */
function smartGrow(
  labels: Uint8Array,
  w: number,
  h: number,
  rgba: Uint8ClampedArray,
  seeds: number[],
  reach: number,
  v: 1 | 2
): void {
  const TOL = 60 // 3チャンネルの差の合計。写真の同じ面がだいたい収まる
  const visited = new Uint8Array(w * h)
  const queue: number[] = []
  // 種ごとの距離の上限は、いちばん近い種からの距離で見る（線から遠くへ漏れない）
  const seedX = new Float32Array(seeds.length)
  const seedY = new Float32Array(seeds.length)
  seeds.forEach((s, i) => {
    seedX[i] = s % w
    seedY[i] = Math.floor(s / w)
    visited[s] = 1
    queue.push(s)
  })
  const near = (x: number, y: number): boolean => {
    for (let i = 0; i < seeds.length; i++) {
      const dx = seedX[i] - x
      const dy = seedY[i] - y
      if (dx * dx + dy * dy <= reach * reach) return true
    }
    return false
  }
  let head = 0
  while (head < queue.length) {
    const cur = queue[head++]
    labels[cur] = v
    const x = cur % w
    const nbrs = [cur - 1, cur + 1, cur - w, cur + w]
    for (let k = 0; k < 4; k++) {
      const n = nbrs[k]
      if (n < 0 || n >= w * h) continue
      if (k === 0 && x === 0) continue
      if (k === 1 && x === w - 1) continue
      if (visited[n]) continue
      const nx = n % w
      const ny = (n - nx) / w
      if (!near(nx, ny)) continue
      if (!similar(rgba, cur, n, TOL)) continue
      visited[n] = 1
      queue.push(n)
    }
  }
}

/**
 * 線の並び → labels。rgba を渡すと smart の線が色で広がる。
 * 線は点を 1px 刻みで補間して丸を打つ（速く引いても途切れない）
 */
export function rasterizeStrokes(
  strokes: CutoutStroke[],
  w: number,
  h: number,
  rgba?: Uint8ClampedArray
): Uint8Array | null {
  if (!strokes.length) return null
  const labels = new Uint8Array(w * h)
  for (const st of strokes) {
    const v: 1 | 2 = st.mode === 'keep' ? 1 : 2
    const r = Math.max(0.5, st.size / 2)
    const seeds: number[] = []
    const pushSeed = (x: number, y: number): void => {
      const ix = Math.round(x)
      const iy = Math.round(y)
      if (ix >= 0 && ix < w && iy >= 0 && iy < h) seeds.push(iy * w + ix)
    }
    if (st.pts.length === 1) {
      stampDisc(labels, w, h, st.pts[0][0], st.pts[0][1], r, v)
      pushSeed(st.pts[0][0], st.pts[0][1])
    }
    for (let i = 1; i < st.pts.length; i++) {
      const [ax, ay] = st.pts[i - 1]
      const [bx, by] = st.pts[i]
      const len = Math.hypot(bx - ax, by - ay)
      const steps = Math.max(1, Math.ceil(len))
      for (let k = 0; k <= steps; k++) {
        const t = k / steps
        const x = ax + (bx - ax) * t
        const y = ay + (by - ay) * t
        stampDisc(labels, w, h, x, y, r, v)
        // 種は数px おきで十分（全部入れると広げる判定が重い）。端は必ず入れる
        if (k % 4 === 0 || k === steps) pushSeed(x, y)
      }
    }
    if (st.smart && rgba && seeds.length) smartGrow(labels, w, h, rgba, seeds, st.size * 3, v)
  }
  return labels
}
