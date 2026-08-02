import { useEffect, useRef } from 'react'
import { waveIndexAt } from '../../../shared/timeline'

interface Props {
  min: number[] // [-1,0] 側のピーク（[0, audioDuration] を均等分割）
  max: number[] // [0,1] 側のピーク
  srcStart: number // この切片が表示するソース範囲
  srcEnd: number
  // 波形を解析した音声そのものの長さ。動画の尺を渡すと、音声ストリームとの
  // 尺差ぶん位置が比例してズレる（後ろに行くほど再生ヘッドと合わなくなる）。
  audioDuration: number
  width: number // 表示px幅
  height: number
  color?: string
}

// min/max ピークから canvas に波形を描画（ClipGift風の青い振幅エンベロープ）。
// 表示ピクセル単位で、範囲内バケットを集約 or バケット間を線形補間するので拡大しても滑らか。
export default function WaveformCanvas({
  min,
  max,
  srcStart,
  srcEnd,
  audioDuration,
  width,
  height,
  color = '#2196f3'
}: Props): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const W = Math.max(1, Math.floor(width))
    const H = Math.max(1, Math.floor(height))
    const dpr = window.devicePixelRatio || 1
    cv.width = W * dpr
    cv.height = H * dpr
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const P = max.length
    if (P === 0 || audioDuration <= 0) return

    const amp = H * 0.46
    const mid = H / 2
    // 写像は shared/timeline に集約（ここで書き直すとまたズレる）
    const toIdxF = (t: number): number => waveIndexAt(t, audioDuration, P)

    // **波形の色は変えない。下に暗い敷きを1枚置く。**
    //
    // 帯の背景はクリップに付けた色（ラベル）がそのまま出る。波形は決まった色なので、
    // **近い色を付けると波形が消える**（青いラベルに青い波形）。
    // 色の方を背景に合わせて変える手もあるが、それだと
    // 「どの音がどの波形か」を色で覚えられなくなる——**波形の色は固定が正しい。**
    // 敷きは半透明なので、付けた色は暗くなって残る＝色分けは効いたまま。
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = color

    for (let x = 0; x < W; x++) {
      const ta = srcStart + (x / W) * (srcEnd - srcStart)
      const tb = srcStart + ((x + 1) / W) * (srcEnd - srcStart)
      const ia = toIdxF(ta)
      const ib = toIdxF(tb)
      let lo: number
      let hi: number
      if (Math.floor(ib) > Math.floor(ia)) {
        // このピクセルが複数バケットを跨ぐ → min/max を集約（縮小時）
        lo = 0
        hi = 0
        for (let j = Math.floor(ia); j <= Math.min(P - 1, Math.floor(ib)); j++) {
          if (max[j] > hi) hi = max[j]
          if (min[j] < lo) lo = min[j]
        }
      } else {
        // バケットより細かい → 隣と線形補間（拡大時に階段状にならない）
        const j = Math.min(P - 1, Math.floor(ia))
        const j2 = Math.min(P - 1, j + 1)
        const f = ia - Math.floor(ia)
        hi = max[j] * (1 - f) + max[j2] * f
        lo = min[j] * (1 - f) + min[j2] * f
      }
      const top = mid - hi * amp
      const bot = mid - lo * amp
      ctx.fillRect(x, top, 1, Math.max(1, bot - top))
    }
  }, [min, max, srcStart, srcEnd, audioDuration, width, height, color])

  return <canvas ref={ref} style={{ width, height, display: 'block' }} />
}
