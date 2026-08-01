// 重ねる動画（V2以降に置いたクリップ）の <video> 要素。
//
// ## なぜ「窓」で区切るか
//
// 出ている区間だけを描くと、区間の境目で <video> が捨てられる。戻ってくると
// 作り直しになり、**先頭のコマが一瞬出てから読み込み直す**。かといって全部を
// 常設すると、クリップの数だけメディア要素が居座って重い。
// そこで再生ヘッドの前後2秒ぶんだけ要素を残し、**表示だけ切り替える**。
import { useMemo, useRef } from 'react'

/** 再生ヘッドの前後、何秒ぶんの要素を残しておくか */
const VC_WINDOW = 2

export function useVClipEls(
  vClips: { id: number; track: string; tStart: number; srcStart: number; srcEnd: number }[],
  currentTime: number,
  tracks: { id: string }[]
) {
  /** いま要素を置いておくクリップ（重なりは下から＝トラックの並びの逆順） */
  const windowVClips = useMemo(
    () =>
      vClips
        .filter(
          (c) =>
            currentTime >= c.tStart - VC_WINDOW &&
            currentTime < c.tStart + Math.max(0.05, c.srcEnd - c.srcStart) + VC_WINDOW
        )
        .slice()
        .sort(
          (a, b) =>
            tracks.findIndex((t) => t.id === b.track) - tracks.findIndex((t) => t.id === a.track)
        ),
    [vClips, currentTime, tracks]
  )

  /** クリップID → <video>。音もこの要素から鳴る */
  const vcElsRef = useRef<Map<number, HTMLVideoElement>>(new Map())
  const vcRefCbsRef = useRef<Map<number, (el: HTMLVideoElement | null) => void>>(new Map())

  /**
   * クリップIDごとの ref コールバック。**IDごとに1つに固定する。**
   * 毎レンダー新しい無名関数を渡すと React が外す→付け直すを繰り返し、
   * 要素の作り直し（＝先頭のコマのちらつき）を招く。
   */
  const vcRefCb = (id: number): ((el: HTMLVideoElement | null) => void) => {
    let fn = vcRefCbsRef.current.get(id)
    if (!fn) {
      fn = (el: HTMLVideoElement | null): void => {
        if (el) vcElsRef.current.set(id, el)
        else {
          // 窓から外れて外される瞬間に音が残らないよう、忘れる前に止める
          const prev = vcElsRef.current.get(id)
          if (prev && !prev.paused) prev.pause()
          vcElsRef.current.delete(id)
          vcRefCbsRef.current.delete(id)
        }
      }
      vcRefCbsRef.current.set(id, fn)
    }
    return fn
  }

  return { windowVClips, vcElsRef, vcRefCb }
}
