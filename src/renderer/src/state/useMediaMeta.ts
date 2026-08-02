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
import { useDoc } from './contentContext'
import { useMediaCtx } from './mediaContext'

export interface MediaMeta {
  dur?: number
  wave?: { min: number[]; max: number[]; dur: number }
}

type Snap = { vClips?: { path: string }[]; seClips: { path: string }[]; imgClips?: { path: string }[] }

export interface UseMediaMetaDeps {
  /**
   * やり直しで戻ってくる中身。**ここに居る物の控えは捨てない。**
   *
   * 関数で受けるのは、**捨てる判断が少し待ってから走る**（下の setTimeout）ため。
   * 値でもらうと、待っている間に積み直された分を見落として、
   * やり直した途端に「波形解析中…」になる。
   */
  historySnaps: () => Snap[]
}

export function useMediaMeta(deps: UseMediaMetaDeps) {
  const { historySnaps } = deps
  const { vClips, seClips, imgClips, vClipsRef, seClipsRef, imgClipsRef } = useDoc()
  const { mediaItems, sources, sourcesRef } = useMediaCtx()
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

  // どこからも使われなくなった控えを捨てる。
  //
  // **波形は長い素材だと数MB級**になるので、素材を入れ替えながら作業していると
  // 増える一方になる。落ち着いてから1回だけ走らせる（掴んでいる最中に毎回
  // 走らせると、その計算そのものが引っかかりの元になる）。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const used = new Set<string>()
      for (const m of mediaItems) used.add(m.path)
      for (const c of vClipsRef.current) used.add(c.path)
      for (const c of seClipsRef.current) used.add(c.path)
      for (const c of imgClipsRef.current) used.add(c.path)
      for (const s of sourcesRef.current) used.add(s.path)
      // やり直しで戻ってくるクリップの波形も残す
      // （戻した途端に「波形解析中…」になるのを防ぐ）
      for (const snap of historySnaps()) {
        for (const c of snap.vClips ?? []) used.add(c.path)
        for (const c of snap.seClips) used.add(c.path)
        for (const c of snap.imgClips ?? []) used.add(c.path)
      }
      metaInFlightRef.current.forEach((p) => used.add(p)) // 解析中の物は落とさない
      const keys = Object.keys(mediaMetaRef.current)
      if (keys.every((k) => used.has(k))) return
      setMediaMeta((prev) => {
        const next: Record<string, MediaMeta> = {}
        for (const k of Object.keys(prev)) if (used.has(k)) next[k] = prev[k]
        return next
      })
    }, 3000)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaItems, vClips, seClips, imgClips, sources])

  return { mediaMeta, setMediaMeta, mediaMetaRef, metaInFlightRef, thumbDoneRef }
}
