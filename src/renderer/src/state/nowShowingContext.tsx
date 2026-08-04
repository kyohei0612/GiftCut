// いま出ているテロップと、映す素材の一覧を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// 要る物が全部 心臓にあるのに、配線が呼んで各フックへ配っていた。
// 上げると、これを待っていたフックも順に上げられるようになる（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `NowShowingValue` … `useNowShowing` が返す物（**手で書かず実体から引く**）
// - `NowShowingProvider` … 囲い。中で要る物を心臓から読んで1回だけ呼ぶ
// - `useNowShowingCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useDoc } from './contentContext'
import { useMediaCtx } from './mediaContext'
import { usePlaybackCtx } from './playbackContext'
import { useTracksCtx } from './tracksContext'
import { useTrackGeomCtx } from './trackGeomContext'
import { useNowShowing } from './useNowShowing'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type NowShowingValue = ReturnType<typeof useNowShowing>

const Ctx = createContext<NowShowingValue | null>(null)

export function NowShowingProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { cues } = useDoc()
  const { currentTime, fps } = usePlaybackCtx()
  const { tracks } = useTracksCtx()
  const { cueTrack } = useTrackGeomCtx()
  const { sources, videoSrc, videoDuration } = useMediaCtx()
  const value = useNowShowing({ cues, currentTime, tracks, cueTrack, sources, videoSrc, videoDuration, fps })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** いま出ているテロップと、映す素材の一覧を見に行く。囲いの外で呼んだら、その場で落とす */
export function useNowShowingCtx(): NowShowingValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useNowShowingCtx は NowShowingProvider の中でしか使えません')
  return v
}
