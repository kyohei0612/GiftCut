// テロップの足し引きを、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// 要る物が全部 心臓にあるのに、配線が呼んで各フックへ配っていた。
// **中身はここで作る**（上で作って渡すと、描き直すたびに作り直される）。
//
// ## 中身
//
// - `TelopEditValue` … `useTelopEdit` が返す物（**手で書かず実体から引く**）
// - `TelopEditProvider` … 囲い。中で要る物を心臓から読んで1回だけ呼ぶ
// - `useTelopEditCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useAppChromeCtx } from './appChromeContext'
import { useTrackGeomCtx } from './trackGeomContext'
import { useTracksAdminCtx } from './tracksAdminContext'
import { useTelopEdit } from './useTelopEdit'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type TelopEditValue = ReturnType<typeof useTelopEdit>

const Ctx = createContext<TelopEditValue | null>(null)

export function TelopEditProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { cueTrack, trackNum } = useTrackGeomCtx()
  const { idCounter } = useAppChromeCtx()
  const { insertTrackOrdered } = useTracksAdminCtx()
  return <Ctx.Provider value={useTelopEdit({ cueTrack, idCounter, trackNum, insertTrackOrdered })}>{children}</Ctx.Provider>
}

/** テロップの足し引きを見に行く。囲いの外で呼んだら、その場で落とす */
export function useTelopEditCtx(): TelopEditValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTelopEditCtx は TelopEditProvider の中でしか使えません')
  return v
}
