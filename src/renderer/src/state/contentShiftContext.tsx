// 「本編に載っている物の時刻を付け替える土台」を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// 中身（`useContentShift`）は前から1本にまとまっていたが、**呼ぶ所が2つ**あった
// ——`useTimelineEdit` の中と、配線が自分で書いていた `shiftAfter`。後者を
// あちらへ寄せたので、**呼ぶのはここ1回だけ**にする。
//
// 状態を持たないので2回呼んでも壊れないが、2回呼べる形にしておくと
// 「どちらを直せばいいか」が消える。
//
// ## 中身
//
// - `ContentShiftValue` … `useContentShift` が返す物（**手で書かず実体から引く**）
// - `ContentShiftProvider` … 囲い。中で `useContentShift()` を1回だけ呼ぶ
// - `useContentShiftCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useContentShift } from './useContentShift'
import { useTrackGeomCtx } from './trackGeomContext'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type ContentShiftValue = ReturnType<typeof useContentShift>

const Ctx = createContext<ContentShiftValue | null>(null)

export function ContentShiftProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { vcLen } = useTrackGeomCtx()
  return <Ctx.Provider value={useContentShift({ vcLen })}>{children}</Ctx.Provider>
}

/** 時刻の付け替えを見に行く。囲いの外で呼んだら、その場で落とす */
export function useContentShiftCtx(): ContentShiftValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useContentShiftCtx は ContentShiftProvider の中でしか使えません')
  return v
}
