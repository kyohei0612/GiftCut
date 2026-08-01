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
// ## 目盛りは尺と拡大率だけで決まる
//
// 再生ヘッドが動くたびに作り直すと、長い素材ではそれだけで重くなる。
import { useEffect, useMemo, useRef } from 'react'
import { formatTimecode } from '../../../shared/timeline'
import { useDoc } from './contentContext'

export interface UseTimelineSpanDeps {
  /** 本編（V1）の長さ */
  videoTLen: number
  /** 1秒あたりの横幅（px） */
  zoom: number
  fps: number
}

export function useTimelineSpan(deps: UseTimelineSpanDeps) {
  const { videoTLen, zoom, fps } = deps
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
  const rulerTicks = useMemo(() => {
    const cands = [
      1 / fps, 2 / fps, 5 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600
    ]
    const minLabelPx = 84
    let major = cands[cands.length - 1]
    for (const c of cands)
      if (c * zoom >= minLabelPx) {
        major = c
        break
      }
    const majorPx = major * zoom
    const sub = [10, 5, 4, 2, 1].find((n) => majorPx / n >= 7) ?? 1
    const minor = major / sub
    const nMinor = Math.min(20000, Math.floor(duration / minor) + 1)
    const ticks: { left: number; major: boolean; label?: string }[] = []
    for (let i = 0; i <= nMinor; i++) {
      const time = i * minor
      const isMajor = Math.abs(time / major - Math.round(time / major)) < 1e-6
      ticks.push({
        left: time * zoom,
        major: isMajor,
        label: isMajor ? formatTimecode(time, fps) : undefined
      })
    }
    return ticks
  }, [zoom, duration, fps])

  return { seEnd, imgEnd, vcEnd, duration, contentEnd, contentEndRef, rulerTicks }
}
