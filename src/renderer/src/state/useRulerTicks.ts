// ものさしの目盛りを、**目盛りだけで**作り直す。
//
// ## なぜ心臓（useTimelineSpan）から出したか（2026-08-07）
//
// 目盛りは「いま画面に映っている範囲」だけ作る（`shared/rulerTicks`）ので、
// 横に送るたびに作り直す必要がある。そこまでは正しい。
//
// **間違っていたのは置き場所。** 作り直しの引き金（`scrollTick`）が
// `useTimelineSpan` に住んでいたため、囲いの値が変わり、
// **タイムライン全体（全部の段・全部の帯）が React で描き直されて**いた。
// 段や帯に `memo` は1つも無いので、丸ごと作り直される。
//
// 実測（負荷チェック・テレビ基準・往復5回で2回ずつ）:
//
//   全体を描き直す（前）  95% 33.1 / 33.3ms   引っかかり 7回 / 2回
//   目盛りだけ（いま）    95% 20.9 / 20.9ms   引っかかり 0回 / 1回   **-37%**
//
// **重なりゼロ。** ここへ辿り着くまでに見立てを3つ外している
//（めじるし／`--tl-scroll` の書き直し／テロップの枚数。どれも `--minus` で空振り）。
// 効いたのは「中身を減らす」ではなく「**描き直す範囲を狭める**」方だった。
//
// ## 隣に正解が住んでいた
//
// 同じ `scroll` を見ている `useVisibleRange` は、**rAF で間引き、さらに
// 半画面ぶん動くまで state を触らない**。こちらは毎イベント素通しだった。
// **同じ穴を隣で塞いであるのに、こちらだけ空いていた**——片方だけ直した型。
//
// ここでは半画面まで待てない（目盛りは送るぶんだけ動かないと嘘になる）ので、
// **rAF で1コマ1回に間引く**ところまでを揃える。
import { useEffect, useMemo, useRef, useState } from 'react'
import { visibleTicks } from '../../../shared/rulerTicks'
import { formatTimecode } from '../../../shared/timeline'

/** 画面に出す目盛り1本 */
export interface RulerTick {
  left: number
  major: boolean
  label?: string
}

/**
 * @param scrollRef 見ている窓（`.track-scroll`）
 */
export function useRulerTicks(
  scrollRef: React.RefObject<HTMLDivElement>,
  zoom: number,
  duration: number,
  fps: number
): RulerTick[] {
  const [scrollTick, bumpScroll] = useState(0)
  /** 最後に作ったときの `scrollLeft`。ここからどれだけ離れたかで作り直しを決める */
  const 作った位置 = useRef(Number.NaN)

  // **半画面ぶん動いたら作り直す**（2026-08-07）。
  //
  // `visibleTicks` は**前後1画面ぶん多めに**作る。目盛りの位置は中身の座標なので、
  // 送っても中身と一緒に動く——**作り直しが要るのは、余分に作った端へ近づいたときだけ。**
  // 毎コマ作り直しても絵は1ドットも変わらない。
  //
  // 実測（テレビ基準・往復5回）: 毎コマ **25.1 / 29.0ms** → 半画面 **下の数字**。
  // ここを止めた実験（目盛りを一切更新しない）は 20.9ms で、それが下限。
  //
  // 隣の `useVisibleRange` が同じ作法（半画面）。**揃えてある。**
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    let id = 0
    const 見直す = (): void => {
      if (id) return
      id = requestAnimationFrame(() => {
        id = 0
        const w = sc.clientWidth || 1
        // **初回（NaN）は必ず通す。** `NaN < x` は false なので、下の判定を素通りする
        if (Math.abs(sc.scrollLeft - 作った位置.current) < w * 0.5) return
        bumpScroll((n) => n + 1)
      })
    }
    sc.addEventListener('scroll', 見直す, { passive: true })
    // 幅が変わったら作り直す（余分に作る量は幅で決まる）
    const ro = new ResizeObserver(() => {
      作った位置.current = Number.NaN
      見直す()
    })
    ro.observe(sc)
    return () => {
      if (id) cancelAnimationFrame(id)
      sc.removeEventListener('scroll', 見直す)
      ro.disconnect()
    }
  }, [scrollRef])

  return useMemo(() => {
    void scrollTick // 送るたびに作り直すための取っ手
    const sc = scrollRef.current
    const left = sc?.scrollLeft ?? 0
    // **いま作った位置を控える。** 拡大率が変わって作り直したときもここを通るので、
    // 次の「半画面」はその場所から数える
    作った位置.current = left
    return visibleTicks(zoom, duration, fps, left, sc?.clientWidth ?? 0).map((t) => ({
      left: t.left,
      major: t.major,
      label: t.time != null ? formatTimecode(t.time, fps) : undefined
    }))
  }, [zoom, duration, fps, scrollTick, scrollRef])
}
