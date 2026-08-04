// 設定だけのコピー・貼り付けを、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// 要る物が全部 心臓にあるのに、配線が呼んで各フックへ配っていた。
// **中身はここで作る**（上で作って渡すと、描き直すたびに作り直される）。
//
// ## 中身
//
// - `AttrCopyValue` … `useAttrCopy` が返す物（**手で書かず実体から引く**）
// - `AttrCopyProvider` … 囲い。中で要る物を心臓から読んで1回だけ呼ぶ
// - `useAttrCopyCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useMediaCtx } from './mediaContext'
import { useTracksAdminCtx } from './tracksAdminContext'
import { useAttrCopy } from './useAttrCopy'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type AttrCopyValue = ReturnType<typeof useAttrCopy>

const Ctx = createContext<AttrCopyValue | null>(null)

export function AttrCopyProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { mainLocked, telopLocked } = useTracksAdminCtx()
  const { srcOfSeg } = useMediaCtx()
  return <Ctx.Provider value={useAttrCopy({ mainLocked, telopLocked, srcOfSeg })}>{children}</Ctx.Provider>
}

/** 設定だけのコピー・貼り付けを見に行く。囲いの外で呼んだら、その場で落とす */
export function useAttrCopyCtx(): AttrCopyValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAttrCopyCtx は AttrCopyProvider の中でしか使えません')
  return v
}
