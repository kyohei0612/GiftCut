// 取り込んだ素材の「下ごしらえ」を控えておく。
//
// ## なぜ先に用意するか
//
// 掴んで運んでいる最中のゴーストに、**尺の長さと音の波形をそのまま出したい**。
// 掴んだ瞬間に解析を始めたのでは間に合わないので、素材の一覧に並べた時点で
// 済ませておき、ここへ控える。
//
// 保存の対象ではない（プロジェクトを開き直せば作り直せる）ので、
// プロジェクトの中身とは別に持つ。
import { useEffect, useRef, useState } from 'react'

export interface MediaMeta {
  dur?: number
  wave?: { min: number[]; max: number[]; dur: number }
}

export function useMediaMeta() {
  const [mediaMeta, setMediaMeta] = useState<Record<string, MediaMeta>>({})

  /**
   * 「いまこの瞬間の控え」。掴んでいる最中や解析の途中から読む用。
   * state だけだと、掴み始めた時点の古い中身が焼き付いたまま読まれる。
   */
  const mediaMetaRef = useRef<Record<string, MediaMeta>>({})
  useEffect(() => {
    mediaMetaRef.current = mediaMeta
  }, [mediaMeta])

  /**
   * いま解析にかけているファイル。**同じ物を二重三重に解析しないため。**
   * 上の ref は effect 経由なので1拍遅れる。同じ回の中で続けて呼ばれると
   * どちらも「まだ無い」と見て走り出してしまうので、こちらで止める。
   */
  const metaInFlightRef = useRef<Set<string>>(new Set())

  /** 見本の絵を作った（作りかけの）ファイル。同じ物を何度も作らないため */
  const thumbDoneRef = useRef<Set<string>>(new Set())

  return { mediaMeta, setMediaMeta, mediaMetaRef, metaInFlightRef, thumbDoneRef }
}
