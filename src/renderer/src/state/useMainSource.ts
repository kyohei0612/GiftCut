// 「主の元動画」を据え直す・消えた元動画を生き返らせる。
//
// ## 主の元動画とは
//
// 元動画の一覧（sources）の先頭。**srcId を持たない切片はこれを指す**。書き出しの
// 原本（videoPath）・名前・波形も、この1本の物を別の state に写して持っている。
// だから先頭が入れ替わったら、写しも一緒に替えないと食い違う。
//
// ## なぜ1つにまとめたか（2026-11-12）
//
// 先頭が入れ替わる所は3つある——置き場から主を消したとき・元に戻すで消した主が
// 帰ってくるとき・差し替えを元に戻すとき。前は「消したとき」が自前で
// `videoPath` を空にするだけだったので、**他の動画が残っていても書き出せなくなり、
// そのまま保存すると元動画の一覧ごと失われていた**（開き直すと「動画が見つかりません」）。
//
// ※ 読み込む側（`state/useMediaOps` の loadVideo・`state/useProjectApply`）は
//   ここを通していない。あちらは解析（fps・波形・サムネ）を自分で走らせるので、
//   「もう在る物を据え直す」こことは仕事が違う。
//
// ## 中身
//
// - `useMainSource` … 下の2つを返す
//   - `adoptMain`   … 渡した元動画を主に据える（null なら「動画なし」に戻す）
//   - `reviveFor`   … 控え（履歴の1手）が指している元動画を生き返らせ、主を合わせる

import { useMediaCtx } from './mediaContext'
import { useAppChromeCtx } from './appChromeContext'
import type { Source, VSeg } from '../lib/projectTypes'

export interface MainSource {
  adoptMain: (s: Source | null) => void
  reviveFor: (segments: VSeg[], mainSrcId: number | null | undefined) => void
}

export function useMainSource(): MainSource {
  const {
    setVideoPath, setVideoSrc, setVideoName, setVideoDuration, setWaveform, setThumbnailSrc,
    sourcesRef, setSources, sourceGraveRef, videoPathRef, curSourceIdRef, mediaItemsRef
  } = useMediaCtx()
  const { initializedForPathRef, proxyForPathRef } = useAppChromeCtx()

  function adoptMain(s: Source | null): void {
    // 映す面は選び直させる（`state/useVideoSync` が、いまの再生位置の切片から決める）。
    // 前の id を残すと「もう映している」と見なされて、消えた要素を掴んだままになる
    curSourceIdRef.current = null
    if (!s) {
      // 前の動画の焼き直しが終わったとき、勝手にプレビューへ入らないように
      proxyForPathRef.current = null
      setVideoPath(null)
      setVideoSrc(null)
      setVideoName(null)
      setVideoDuration(0)
      setWaveform(null)
      setThumbnailSrc(null)
      return
    }
    // **最初の切片を自動で作らせない。** 「この動画はもう並べた」の印を先に置く
    //（`components/panels/PreviewArea` の onLoadedMetadata が、印の無い動画に
    //   全長1本を置く。据え直しでそれが走ると、戻した中身の上に1本増える）
    initializedForPathRef.current = s.path
    proxyForPathRef.current = s.path
    setVideoPath(s.path)
    setVideoName(s.name)
    // 焼き直しがあれば、映す側がこのあと差し替える（`state/useVideoSync`）
    setVideoSrc(s.origUrl)
    if (s.duration > 0) setVideoDuration(s.duration)
    setWaveform(s.waveform ?? null)
    setThumbnailSrc(mediaItemsRef.current.find((m) => m.path === s.path)?.thumb ?? null)
  }

  function reviveFor(segments: VSeg[], mainSrcId: number | null | undefined): void {
    const cur = sourcesRef.current
    const has = (list: Source[], id: number): boolean => list.some((s) => s.id === id)
    // この控えが指している元動画。srcId の無い切片は「その時点の主」を指す
    const want = new Set<number>()
    for (const g of segments) {
      if (g.gap) continue
      if (g.srcId != null) want.add(g.srcId)
      else if (mainSrcId != null) want.add(mainSrcId)
    }
    const back = [...want]
      .filter((id) => !has(cur, id))
      .map((id) => sourceGraveRef.current.get(id))
      .filter((s): s is Source => !!s)
    let next = back.length ? [...cur, ...back] : cur
    // **その時点の主を先頭へ戻す。** 並びが違うと、srcId の無い切片が
    // 別の動画を指す（黙って違う映像にすり替わる）
    const i = mainSrcId != null ? next.findIndex((s) => s.id === mainSrcId) : -1
    if (i > 0) next = [next[i], ...next.slice(0, i), ...next.slice(i + 1)]
    if (next !== cur) setSources(next)
    // 先頭が替わった・動画なしから帰ってきた、のどちらでも写しを合わせる。
    // **空になった方は触らない**——切片が無いだけの控えへ戻ったとき、元動画は
    // 残っている（やり直すで帰ってくる）ので、主もそのままでよい
    const main = next[0]
    if (main && main.path !== videoPathRef.current) adoptMain(main)
  }

  return { adoptMain, reviveFor }
}
