// いま画面に出ている物（テロップと、映す素材の一覧）。
//
// ## 出す・出さないの判定は自分で持たない
//
// **`shared/cueWindow` の `isCueShowing` を通す。** ここに式を書き直すと、
// 書き出し側（`overlayEnableExpr`）と食い違って
// **プレビューには出ているのに書き出した動画には無い**が起きる。
// 実際に起きた（先頭のテロップを画面側だけ 0秒 まで引き延ばしていた。
// 経緯は `shared/cueWindow.ts` の頭）。
//
// ## 開始ちょうどから出す
//
// 以前は1コマぶん先に出していた。すると隣り合うテロップが切り替わりの1コマで
// 重なり、「2枚ぬめっと重なる」見え方になっていた。隣り合う場合（前の終わり＝
// 次の始まり）は判定が互いに補い合うので、先に出さなくても隙間はできない。
import { useMemo } from 'react'
import { isCueShowing } from '../../../shared/cueWindow'
import type { Cue } from '../lib/srt'
import type { Source, Track } from '../lib/projectTypes'

export interface UseNowShowingDeps {
  cues: Cue[]
  currentTime: number
  tracks: Track[]
  cueTrack: (c: Cue) => string
  sources: Source[]
  videoSrc: string | null
  videoDuration: number
  fps: number
}

export function useNowShowing(deps: UseNowShowingDeps) {
  const { cues, currentTime, tracks, cueTrack, sources, videoSrc, videoDuration, fps } = deps

  /** いま出ているテロップ。**下の段から順**に並べる（後ろに描いた物が手前） */
  const activeCues = useMemo(() => {
    return cues
      .filter((c) => isCueShowing(c.start, c.end, currentTime))
      .sort(
        (a, b) =>
          tracks.findIndex((t) => t.id === cueTrack(b)) -
          tracks.findIndex((t) => t.id === cueTrack(a))
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cues, currentTime, tracks])

  /**
   * プレビューに置いておく <video> の元になる一覧。
   * 素材の登録がまだでも、映す物が手元にあれば仮の1件で描く
   * （でないと読み込み直後に一瞬なにも映らない）。
   */
  const previewSources: Source[] = useMemo(() => {
    if (sources.length) return sources
    if (videoSrc)
      return [
        {
          id: -1,
          path: '',
          name: '',
          origUrl: videoSrc,
          duration: videoDuration,
          fps,
          waveform: null
        }
      ]
    return []
  }, [sources, videoSrc, videoDuration, fps])

  return { activeCues, previewSources }
}
