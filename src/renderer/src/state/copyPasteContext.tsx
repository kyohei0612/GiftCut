// CopyPaste を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useCopyPaste` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `CopyPasteValue` … `useCopyPaste` が返す物（**手で書かず実体から引く**）
// - `CopyPasteProvider` … 囲い。中で `useCopyPaste()` を1回だけ呼ぶ
// - `useCopyPasteCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useAppChromeCtx } from './appChromeContext'
import { useCurrentLookCtx } from './currentLookContext'
import { useLayout } from './layoutContext'
import { useMotionCtx } from './motionContext'
import { useSelectedCue } from './selectedCueContext'
import { useTrackGeomCtx } from './trackGeomContext'
import { useTracksAdminCtx } from './tracksAdminContext'
import { useCopyPaste } from './useCopyPaste'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type CopyPasteValue = ReturnType<typeof useCopyPaste>

const Ctx = createContext<CopyPasteValue | null>(null)

export function CopyPasteProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { idCounter } = useAppChromeCtx()
  const { reframeTargetRef } = useCurrentLookCtx()
  const { leftTab } = useLayout()
  const { motionSelRef, motionRowsRef } = useMotionCtx()
  const { selected } = useSelectedCue()
  const { cueTrack } = useTrackGeomCtx()
  const { fallbackTrack, telopLocked } = useTracksAdminCtx()
  const value = useCopyPaste({
    cueTrack, fallbackTrack, telopLocked, selected, idCounter,
    motionSelRef, motionRowsRef, reframeTargetRef, leftTab
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** CopyPaste を見に行く。囲いの外で呼んだら、その場で落とす */
export function useCopyPasteCtx(): CopyPasteValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCopyPasteCtx は CopyPasteProvider の中でしか使えません')
  return v
}
