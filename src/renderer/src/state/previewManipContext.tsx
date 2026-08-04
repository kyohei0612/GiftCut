// PreviewManip を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `usePreviewManip` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `PreviewManipValue` … `usePreviewManip` が返す物（**手で書かず実体から引く**）
// - `PreviewManipProvider` … 囲い。中で `usePreviewManip()` を1回だけ呼ぶ
// - `usePreviewManipCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useCurrentLookCtx } from './currentLookContext'
import { useEditCtx } from './editContext'
import { useSegLayoutCtx } from './segLayoutContext'
import { useSel } from './selectionContext'
import { useTimelineBoxCtx } from './timelineBoxContext'
import { useTimelineEditCtx } from './timelineEditContext'
import { useTrackGeomCtx } from './trackGeomContext'
import { usePreviewManip } from './usePreviewManip'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type PreviewManipValue = ReturnType<typeof usePreviewManip>

const Ctx = createContext<PreviewManipValue | null>(null)

export function PreviewManipProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { reframeTargetRef } = useCurrentLookCtx()
  const { patchClipMotion, setSegZoom, setImgZoom, setVClipZoom } = useEditCtx()
  const { segLayout } = useSegLayoutCtx()
  const { clearAll: clearAllSelections } = useSel()
  const { screenRef } = useTimelineBoxCtx()
  const { setSegRotate } = useTimelineEditCtx()
  const { vcLen } = useTrackGeomCtx()
  const value = usePreviewManip({
    screenRef, reframeTargetRef, segLayout, vcLen, patchClipMotion,
    setSegZoom, setImgZoom, setVClipZoom, clearAllSelections,
    setSegRotate
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** PreviewManip を見に行く。囲いの外で呼んだら、その場で落とす */
export function usePreviewManipCtx(): PreviewManipValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePreviewManipCtx は PreviewManipProvider の中でしか使えません')
  return v
}
