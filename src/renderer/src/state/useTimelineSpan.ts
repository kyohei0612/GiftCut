// タイムラインの「長さ」と、ものさしの目盛り。
//
// ## 長さが2つあるのはなぜか
//
//   contentEnd … **本当に物が置いてある終わり。** 再生はここで止まる。
//   duration   … **画面に出す長さ。** 最低60秒あり、テロップの後ろに3秒足す。
//
// 分けないと、短い素材で「タイムラインが画面の1/10しか無い」になるか、
// 逆に「何も無い所まで延々と再生が続く」になる。片方だけ直すと、
// 置いた物が画面の右端からはみ出したまま気づけない。
//
// ## 目盛りは「見えている範囲」だけ作る
//
// 再生ヘッドが動くたびに作り直すと、長い素材ではそれだけで重くなるので、
// 尺・拡大率・**いま見えている所**だけで決まるようにしてある。
//
// **2026-08-03 まで端から端まで作っていた**（上限20,000個）。実データ（451秒）で
// 寄せると目盛りだけで 4,538 個の要素になり、帯（クリップ）は23個しか
// 描いていないのに DOM が 1,679 → 10,412 に膨らんでいた。
// **帯は元から窓の分だけ描いていたのに、目盛りだけが全部だった。**
// 刻みの決め方は `shared/rulerTicks`（試験14件）。
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatTimecode } from '../../../shared/timeline'
import { visibleTicks } from '../../../shared/rulerTicks'
import { useDoc } from './contentContext'

export interface UseTimelineSpanDeps {
  /** 本編（V1）の長さ */
  videoTLen: number
  /** 1秒あたりの横幅（px） */
  zoom: number
  fps: number
  /** 横に送る枠。**見えている範囲を知るために要る** */
  scrollRef: { current: HTMLDivElement | null }
}

export function useTimelineSpan(deps: UseTimelineSpanDeps) {
  const { videoTLen, zoom, fps, scrollRef } = deps
  const { cues, seClips, imgClips, vClips } = useDoc()

  const seEnd = useMemo(
    () => (seClips.length ? Math.max(...seClips.map((s) => s.tStart + s.duration)) : 0),
    [seClips]
  )
  /** 画像の終わり（動画より後ろに置いた締めの絵などもタイムラインの長さに含める） */
  const imgEnd = useMemo(
    () => (imgClips.length ? Math.max(...imgClips.map((c) => c.tStart + c.duration)) : 0),
    [imgClips]
  )
  /** 重ねる動画の終わりも長さに含める */
  const vcEnd = useMemo(
    () =>
      vClips.length
        ? Math.max(...vClips.map((c) => c.tStart + Math.max(0.05, c.srcEnd - c.srcStart)))
        : 0,
    [vClips]
  )

  /** 画面に出す長さ。テロップの後ろに3秒、そして最低60秒 */
  const duration = useMemo(() => {
    const cueEnd = cues.length ? Math.max(...cues.map((c) => c.end)) + 3 : 0
    return Math.max(cueEnd, videoTLen, seEnd, imgEnd, vcEnd, 60)
  }, [cues, videoTLen, seEnd, imgEnd, vcEnd])

  /** 本当に物が置いてある終わり。再生はここで止まる */
  const contentEnd = useMemo(() => {
    const cueEnd = cues.length ? Math.max(...cues.map((c) => c.end)) : 0
    return Math.max(cueEnd, videoTLen, seEnd, imgEnd, vcEnd)
  }, [cues, videoTLen, seEnd, imgEnd, vcEnd])
  const contentEndRef = useRef(0)
  useEffect(() => {
    contentEndRef.current = contentEnd
  }, [contentEnd])

  /**
   * ものさしの目盛り。
   *
   * 大きい目盛りは「文字が 84px ぶん取れる」いちばん細かい刻みを選ぶ。
   * 小さい目盛りは、その間が 7px 以上あく範囲でいちばん細かく割る。
   * 上限を置いてあるのは、拡大 × 長尺で目盛りが何十万個にもなるため。
   */
  // **横に送ったら作り直す。** 送っている間ずっと同じ物を出していると、
  // 端まで行った所で目盛りが尽きる。ZoomBar と同じやり方で見張る
  //（React は他人の scrollLeft を知らないので、自分で聞きに行くしかない）
  const [scrollTick, bumpScroll] = useState(0)
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    const bump = (): void => bumpScroll((n) => n + 1)
    sc.addEventListener('scroll', bump, { passive: true })
    const ro = new ResizeObserver(bump)
    ro.observe(sc)
    return () => {
      sc.removeEventListener('scroll', bump)
      ro.disconnect()
    }
  }, [scrollRef])

  const rulerTicks = useMemo(() => {
    void scrollTick // 送るたびに作り直すための取っ手
    const sc = scrollRef.current
    return visibleTicks(zoom, duration, fps, sc?.scrollLeft ?? 0, sc?.clientWidth ?? 0).map((t) => ({
      left: t.left,
      major: t.major,
      label: t.time != null ? formatTimecode(t.time, fps) : undefined
    }))
  }, [zoom, duration, fps, scrollTick, scrollRef])

  return { seEnd, imgEnd, vcEnd, duration, contentEnd, contentEndRef, rulerTicks }
}
