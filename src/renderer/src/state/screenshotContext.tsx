// Screenshot を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useScreenshot` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `ScreenshotValue` … `useScreenshot` が返す物（**手で書かず実体から引く**）
// - `ScreenshotProvider` … 囲い。中で `useScreenshot()` を1回だけ呼ぶ
// - `useScreenshotCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useCueIcon } from './cueIconContext'
import { useCurrentLookCtx } from './currentLookContext'
import { useSegLayoutCtx } from './segLayoutContext'
import { useTrackGeomCtx } from './trackGeomContext'
import { useTracksAdminCtx } from './tracksAdminContext'
import { useVideoElsCtx } from './videoElsContext'
import { useScreenshot } from './useScreenshot'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type ScreenshotValue = ReturnType<typeof useScreenshot>

const Ctx = createContext<ScreenshotValue | null>(null)

export function ScreenshotProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { iconForCue } = useCueIcon()
  const { curBlank, curSegZoom } = useCurrentLookCtx()
  const { videoTLen } = useSegLayoutCtx()
  const { cueTrack, vcLen } = useTrackGeomCtx()
  const { v1Hidden } = useTracksAdminCtx()
  const { videoRef } = useVideoElsCtx()
  const value = useScreenshot({
    videoRef, v1Hidden, curBlank, videoTLen, curSegZoom, cueTrack, vcLen, iconForCue
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Screenshot を見に行く。囲いの外で呼んだら、その場で落とす */
export function useScreenshotCtx(): ScreenshotValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useScreenshotCtx は ScreenshotProvider の中でしか使えません')
  return v
}
