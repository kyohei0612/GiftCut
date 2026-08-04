// テロップの出入りの動き（見本帳から当てる分）を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// 要る5つのうち4つは心臓から取れ、`motionLabel` は**ただの import**。
// 詰まっていたのは `setRightTab` だけで、`useAppChrome` へ移して解けた
//（`npm run passthrough`）。
//
// ## 中身
//
// - `TelopAnimValue` … `useTelopAnim` が返す物（**手で書かず実体から引く**）
// - `TelopAnimProvider` … 囲い。中で `useTelopAnim()` を1回だけ呼ぶ
// - `useTelopAnimCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useAppChromeCtx } from './appChromeContext'
import { useBandDragCtx } from './bandDragContext'
import { motionLabel } from './useLabelsPresets'
import { useTelopAnim } from './useTelopAnim'
import { useTrackGeomCtx } from './trackGeomContext'
import { useTracksAdminCtx } from './tracksAdminContext'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type TelopAnimValue = ReturnType<typeof useTelopAnim>

const Ctx = createContext<TelopAnimValue | null>(null)

export function TelopAnimProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { cueTrack } = useTrackGeomCtx()
  const { telopLocked } = useTracksAdminCtx()
  const { draggingTelopAnimRef } = useBandDragCtx()
  const { setRightTab } = useAppChromeCtx()
  const value = useTelopAnim({ cueTrack, telopLocked, motionLabel, draggingTelopAnimRef, setRightTab })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** テロップの出入りの動きを見に行く。囲いの外で呼んだら、その場で落とす */
export function useTelopAnimCtx(): TelopAnimValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTelopAnimCtx は TelopAnimProvider の中でしか使えません')
  return v
}
