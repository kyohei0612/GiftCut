// AutosaveMark を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useAutosaveMark` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `AutosaveMarkValue` … `useAutosaveMark` が返す物（**手で書かず実体から引く**）
// - `AutosaveMarkProvider` … 囲い。中で `useAutosaveMark()` を1回だけ呼ぶ
// - `useAutosaveMarkCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useAppChromeCtx } from './appChromeContext'
import { useLaneHeightsCtx } from './laneHeightsContext'
import { useLayout } from './layoutContext'
import { useAutosaveMark } from './useAutosaveMark'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type AutosaveMarkValue = ReturnType<typeof useAutosaveMark>

const Ctx = createContext<AutosaveMarkValue | null>(null)

export function AutosaveMarkProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { rightTab } = useAppChromeCtx()
  const { videoTrackH, audioTrackH } = useLaneHeightsCtx()
  const { popped, paneGeom, leftW, rightW, timelineH, tabOrder, monitorTab } = useLayout()
  const value = useAutosaveMark({
    // 画面の配置は心臓ではなくフックが持っているので、ここから渡す
    layout: [popped, paneGeom, leftW, rightW, timelineH, videoTrackH, audioTrackH, tabOrder, rightTab, monitorTab]
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** AutosaveMark を見に行く。囲いの外で呼んだら、その場で落とす */
export function useAutosaveMarkCtx(): AutosaveMarkValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAutosaveMarkCtx は AutosaveMarkProvider の中でしか使えません')
  return v
}
