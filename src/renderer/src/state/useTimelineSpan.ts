// タイムラインの「長さ」。
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
// ## 目盛りはここに無い（2026-08-07 に `state/useRulerTicks` へ移した）
//
// 目盛りは横に送るたびに作り直す必要があるが、**引き金をここに置くと
// タイムライン全体が描き直される**。理由と実測は移した先の冒頭にある。
import { useEffect, useMemo, useRef } from 'react'
import { vcLen } from '../../../shared/timeline'
import { useDoc } from './contentContext'

export interface UseTimelineSpanDeps {
  /** 本編（V1）の長さ */
  videoTLen: number
}

export function useTimelineSpan(deps: UseTimelineSpanDeps) {
  const { videoTLen } = deps
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
        ? Math.max(...vClips.map((c) => c.tStart + vcLen(c)))
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
  /**
   * **引ける下限を出すのに使う**（2026-08-06）。
   *
   * 下限は「全体がちょうど収まる率」で、その"全体"は**バーが描く長さ**＝
   * こちら（`duration`）でなければならない。`contentEnd` で出すと、
   * バーの端と倍率の限界が食い違って「引いたのにバーが動かない」区間ができる。
   *
   * ホイールもキーボードも、聞かれた瞬間の値が要る（描き直しを待てない）ので控えを置く。
   */
  const durationRef = useRef(60)
  useEffect(() => {
    durationRef.current = duration
  }, [duration])

  const contentEndRef = useRef(0)
  useEffect(() => {
    contentEndRef.current = contentEnd
  }, [contentEnd])

  // **目盛りはここに置かない**（2026-08-07。`state/useRulerTicks` へ移した）。
  //
  // 目盛りは横に送るたびに作り直す必要がある。それは正しいのだが、
  // **引き金がここにあると囲いの値が変わり、タイムライン全体が描き直される**
  //（段にも帯にも `memo` は無いので、丸ごと作り直しになる）。
  // 横に送るだけで全部を作り直していたことになる。
  //
  // 実測（テレビ基準・往復5回で2回ずつ）: **95% 33.2ms → 20.9ms（-37%）。重なりゼロ。**
  // 移した先は、目盛りを出す `TimeRuler` だけが呼ぶ。
  return { seEnd, imgEnd, vcEnd, duration, durationRef, contentEnd, contentEndRef }
}
