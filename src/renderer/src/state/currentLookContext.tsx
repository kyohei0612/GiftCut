// 再生ヘッドの位置の「いまの見た目」と、リフレーム枠の相手を
// どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// 要る物が全部 心臓にあるのに、配線が呼んで **7本のフックへ配って**いた。
// **中身はここで作る**（上で作って渡すと、描き直すたびに作り直される）。
//
// ## 中身
//
// - `CurrentLookValue` … `useCurrentLook` が返す物（**手で書かず実体から引く**）
// - `CurrentLookProvider` … 囲い。中で要る物を心臓から読んで1回だけ呼ぶ
// - `useCurrentLookCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useMediaCtx } from './mediaContext'
import { usePlaybackCtx } from './playbackContext'
import { useSegLayoutCtx } from './segLayoutContext'
import { useTrackGeomCtx } from './trackGeomContext'
import { useNowShowingCtx } from './nowShowingContext'
import { useCurrentLook } from './useCurrentLook'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type CurrentLookValue = ReturnType<typeof useCurrentLook>

const Ctx = createContext<CurrentLookValue | null>(null)

export function CurrentLookProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { segLayout } = useSegLayoutCtx()
  const { segments, imgClips, vClips } = useDoc()
  const { currentTime } = usePlaybackCtx()
  const { previewSources } = useNowShowingCtx()
  const { activeSrcId, srcOfSeg, videoName } = useMediaCtx()
  const { selectedVideoIds, selectedImgIds, selectedVClipIds } = useSel()
  const { vcLen } = useTrackGeomCtx()
  const value = useCurrentLook({
    segLayout, segments, currentTime, previewSources, activeSrcId,
    selectedVideoIds, selectedImgIds, selectedVClipIds,
    imgClips, vClips, vcLen, srcOfSeg, videoName
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** いまの見た目とリフレーム枠の相手を見に行く。囲いの外で呼んだら、その場で落とす */
export function useCurrentLookCtx(): CurrentLookValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCurrentLookCtx は CurrentLookProvider の中でしか使えません')
  return v
}
