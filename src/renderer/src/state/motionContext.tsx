// Motion を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useMotion` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `MotionValue` … `useMotion` が返す物（**手で書かず実体から引く**）
// - `MotionProvider` … 囲い。中で `useMotion()` を1回だけ呼ぶ
// - `useMotionCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useAskCtx } from './askContext'
import { useCurrentLookCtx } from './currentLookContext'
import { useEditCtx } from './editContext'
import { usePlaybackEngineCtx } from './playbackEngineContext'
import { useSegLayoutCtx } from './segLayoutContext'
import { useToastCtx } from './toastContext'
import { useTrackGeomCtx } from './trackGeomContext'
import { useMotion } from './useMotion'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type MotionValue = ReturnType<typeof useMotion>

const Ctx = createContext<MotionValue | null>(null)

export function MotionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { askConfirm } = useAskCtx()
  const { reframeTargetRef } = useCurrentLookCtx()
  const { patchClipMotion, setSegZoom, setImgZoom, setVClipZoom } = useEditCtx()
  const { seekTo } = usePlaybackEngineCtx()
  const { segLayout } = useSegLayoutCtx()
  const { showToast } = useToastCtx()
  const { vcLen } = useTrackGeomCtx()
  const value = useMotion({
    reframeTargetRef, askConfirm, showToast, segLayout,
    patchClipMotion, setSegZoom, setImgZoom, setVClipZoom, vcLen, seekTo
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Motion を見に行く。囲いの外で呼んだら、その場で落とす */
export function useMotionCtx(): MotionValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useMotionCtx は MotionProvider の中でしか使えません')
  return v
}
