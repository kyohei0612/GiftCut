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

/**
 * canvas に持たせる実画素の上限。
 *
 * **Chrome は 65,535px を超えると canvas を丸ごと無効にする**（例外も出ない）。
 * 半分を上限にして余裕を持たせる。
 */
const MAX_BUF_PX = 32768

/**
 * 実際に描く横幅（論理px）。**帯の幅そのままでは描かない。**
 *
 * ## なぜ上限が要るか（2026-08-03）
 *
 * 帯の幅は「長さ × 拡大率」なので、451秒の素材を目一杯寄せると
 * **108,240px** になる。上の上限を超えると canvas が無効になり、
 * **何も描かれない＝波形が消えて白くなる**（本人の症状そのもの）。
 *
 * ついでに、下のループは1画素ずつ `fillRect` を呼ぶので、
 * **10万回の描画命令**を毎回出していた（掴んでいる間はここも効く）。
 *
 * ## 上限まで落としても見た目が変わらない理由
 *
 * 元データは**ピーク P 点しか無い**（`min[]` / `max[]`）。P を超える画素は
 * 隣どうしの線形補間で埋めているだけなので、**線形補間を横へ引き伸ばしても
 * 同じ形**になる。つまり上限で描いて CSS で伸ばせば、目で見て違いは出ない。
 *
 * ※ もっと良い形は「**見えている範囲だけ描く**」だが、帯が窓の位置を知らないので
 *   配線が要る。そちらは `やること.md` の「重さ」に残してある。
 */
export function waveBufWidth(width: number, dpr: number): number {
  // **Math.max(1, NaN) は NaN。** 素通しすると canvas の幅が NaN になり、
  // 例外も出ないまま何も描かれない（＝白くなる。直したい症状と同じ形）
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  const w = Number.isFinite(width) ? Math.floor(width) : 1
  // ※ **この上限を外すと本当に赤くなることを確かめてある**（2026-08-03）。
  //   WaveformCanvas.test.ts が `expected 108240 to be less than 108240` で落ちる。
  return Math.max(1, Math.min(w, Math.floor(MAX_BUF_PX / d)))
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
    // **描くのは帯の幅そのままではなく、上限まで。** 見た目は CSS 側で帯幅へ伸ばす
    const BW = waveBufWidth(W, dpr)
    cv.width = Math.max(1, Math.round(BW * dpr))
    cv.height = H * dpr
    // **`willReadFrequently: true` を外さないこと。GPU 描画に戻ると重くなる。**
    //
    // Chromium は GPU で描く 2D canvas を**1枚ずつ独立した合成レイヤー**に載せる。
    // 波形は音声クリップの数だけあるので、テレビの編集1時間ぶん（カット600）だと
    // **canvas 427枚＋巻き添えで昇格した親 347枚＝合成レイヤー 800枚**になっていた。
    //
    // 枚数が増えると、ブラウザが毎フレーム「どれをどのレイヤーへ入れるか」を
    // 組み直す（`Layerize`）のに時間を食う。2026-08-04 の実測（掴んで28秒）:
    //
    //   レイヤー800枚  Layerize＋合成の更新に **17.8秒**（1回 79ms）→ 95% 200ms
    //   レイヤー160枚  同 1.3秒（1回 1.7ms）                        → 95%  25ms
    //
    // **赤／緑がレイヤー枚数と完全に一致していた。** 塗る処理でも React でも
    // レイアウトでもなく、レイヤーの組み直しが 85% を占めていた。
    //
    // この指定は「読み戻しが多い」宣言だが、実質は**GPU 描画をやめる**指示になる。
    // 波形は拡大したときにしか描き直さないので、GPU である利点がそもそも無い。
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, BW, H)
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
    ctx.fillRect(0, 0, BW, H)
    ctx.fillStyle = color

    // **座標系は BW（描く幅）で通す。** 帯の幅 W と混ぜると波形が横にずれる
    //（CSS 側が W へ引き伸ばすので、ここは最後まで BW のままでよい）
    for (let x = 0; x < BW; x++) {
      const ta = srcStart + (x / BW) * (srcEnd - srcStart)
      const tb = srcStart + ((x + 1) / BW) * (srcEnd - srcStart)
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
