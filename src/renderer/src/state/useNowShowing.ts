// いま画面に出ている物（テロップと、映す素材の一覧）。
//
// ## 先頭のテロップだけ特別扱いする
//
// 聞き取りで作った字幕は 0.1秒 あたりから始まることが多い。素直に判定すると
// 頭のわずかな間だけ字幕が出ず、**再生し始めた瞬間に一瞬なにも無い**という
// 見え方になる。先頭が 0.5秒 以内から始まるときだけ、頭の隙間を埋める。
//
// ## 開始ちょうどから出す
//
// 以前は1コマぶん先に出していた。すると隣り合うテロップが切り替わりの1コマで
// 重なり、「2枚ぬめっと重なる」見え方になっていた。隣り合う場合（前の終わり＝
// 次の始まり）は判定が互いに補い合うので、先に出さなくても隙間はできない。
import { useMemo } from 'react'
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
    const firstStart = cues.reduce((m, c) => Math.min(m, c.start), Infinity)
    const headFill = firstStart <= 0.5
    return cues
      .filter((c) => {
        const eff = headFill && c.start === firstStart ? 0 : c.start
        return currentTime >= eff && currentTime < c.end
      })
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
