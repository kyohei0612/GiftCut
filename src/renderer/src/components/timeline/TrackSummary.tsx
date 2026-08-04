// **引いたときは、帯を1本ずつ作らずに1枚の絵で描く。**
//
// ## なぜ要るか（2026-08-04 に測った）
//
// 全体表示（60分）では、テロップ1200枚が**全部画面の中**に入る。帯は1本1個の
// `div` なので、1ノッチ寄せるたびに約14,000個の要素を作り直すことになる。
//
//   タイムラインを拡大・縮小  95% 120.9ms（1コマ 47ms）
//   テロップ1200枚を抜くと    95%  70.9ms（-41%）
//
// **帯そのものは既に最小**（細いときは文字も摘み手も出さない `div` 1個）なので、
// 削る脂肪は無い。数を減らすには**作るのをやめる**しかない。
//
// ## 選べなくはしない（プレミアと同じ形）
//
// プレミアのタイムラインは DOM ではなく自前で描いていて、選択は
// 「押した x → 時刻 → どのクリップか」を**データ側で引いて**いる。
// だから 1px でも選べる。**重いのは「1本ずつ DOM を作ること」であって、
// 当たり判定ではない。** ここも同じにする（時刻から引くだけなので数十行）。
//
// ※ 掴んで動かすのは引いた状態では**できない**。2px の帯は元から実質掴めず
//   （検査が1つそれで落ちていた）、ほぼ全部が「端」なのでトリム側の判定に入る。
//   寄せれば今までどおりの帯に戻る。
//
// ## `willReadFrequently` を外さないこと
//
// GPU で描く 2D canvas は**1枚ずつ独立した合成レイヤー**に載る。段の数だけ
// レイヤーが増えると、今度は `Layerize` が重くなる（同じ日に波形で踏んだ）。
// ここは CPU 描画でよい——描き直すのは拡大したときだけ。

import { useEffect, useRef } from 'react'
import type { JSX } from 'react'

/** 1本ぶん。**時刻で持つ**（px は zoom を掛けて出す。二重に持つと必ずズレる） */
export interface SummaryBand {
  id: number
  start: number
  end: number
  /** 帯の色。付いていなければ既定の塗り */
  color?: string
  selected?: boolean
}

/**
 * この px/秒 より引いていたら1枚の絵にする。
 *
 * 2秒のテロップが 6px になる所。これより細いと、
 * 文字も摘み手も出ない（＝`div` である意味が無い）。
 */
export const SUMMARY_ZOOM = 3

/** 既定の塗り（`styles.css` の `.clip` と揃える。色ラベルが無い帯の色） */
const BASE = '#3a4a6b'
const SELECTED = '#ffd54f'

/**
 * その時刻にある帯を返す（無ければ `null`）。
 *
 * **絵の上の当たり判定はここが全部。** 要素の重なりではなく時刻から引くので、
 * 1px の帯でも当たる（プレビューと同じ考え方）。
 *
 * **純関数にしてある**——引いた状態は e2e の素材（20秒）では再現できず、
 * 画面越しには一度も通らない。`TrackSummary.test.ts` がここを押さえる。
 *
 * 後ろから探すのは、**後に描いた物が上に見えている**から（重なったときに
 * 目に見えている方が選ばれないと、押した物と違う物が選ばれる）。
 */
export function pickBandAt(bands: SummaryBand[], t: number): number | null {
  for (let i = bands.length - 1; i >= 0; i--) {
    if (t >= bands[i].start && t < bands[i].end) return bands[i].id
  }
  return null
}

export function TrackSummary({
  bands,
  zoom,
  onPick
}: {
  bands: SummaryBand[]
  zoom: number
  /** 押された帯。**`null` は「何も無い所」**（選択を外す側が決める） */
  onPick: (id: number | null, e: React.PointerEvent) => void
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  // **幅は「いちばん後ろの帯の終わり」まで。** 段の全長で作ると、
  // 中身が前半だけの段でも 60分ぶんの canvas を持つことになる
  const endSec = bands.reduce((m, b) => Math.max(m, b.end), 0)
  const w = Math.max(1, Math.ceil(endSec * zoom))

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    // **高さは自分で測る（数字で持たない）。** 段の高さは利用者が変えられるうえ、
    // 帯の高さは CSS が `calc(100% - 6px)` で決めている。ここに数字を書くと
    // **CSS を触った日に絵だけ古い高さのまま**になる（同じ物を2か所に持たない）
    const draw = (): void => {
      const height = cv.clientHeight
      if (!(height > 0)) return
      const dpr = window.devicePixelRatio || 1
      cv.width = Math.max(1, Math.round(w * dpr))
      cv.height = Math.max(1, Math.round(height * dpr))
      // GPU 描画に戻さないこと（上の説明のとおり。合成レイヤーが段の数だけ増える）
      const ctx = cv.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, height)
      for (const b of bands) {
        const x = b.start * zoom
        // **1px は必ず残す。** 0 にすると、細い帯だけ黙って消える
        //（「置いたはずの物が見えない」になる。数が合わないより気づきにくい）
        const bw = Math.max(1, (b.end - b.start) * zoom)
        ctx.fillStyle = b.selected ? SELECTED : b.color && b.color !== 'none' ? b.color : BASE
        ctx.fillRect(x, 1, bw, height - 2)
      }
    }
    draw()
    // 段の高さを変えたら描き直す（数字で持っていないので、実物の変化で拾う）
    const ro = new ResizeObserver(draw)
    ro.observe(cv)
    return () => ro.disconnect()
  }, [bands, zoom, w])

  return (
    <canvas
      ref={ref}
      className="track-summary"
      style={{ width: w }}
      onPointerDown={(e) => {
        // **要素の重なりではなく、時刻から引く。** 1px の帯でも当たる
        const rect = e.currentTarget.getBoundingClientRect()
        onPick(pickBandAt(bands, (e.clientX - rect.left) / zoom), e)
      }}
    />
  )
}
