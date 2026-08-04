// 静かな所を切る・声の間だけ BGM を下げるを、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// 要る物が全部 心臓にあるのに、配線が呼んで各フックへ配っていた。
// **中身はここで作る**（上で作って渡すと、描き直すたびに作り直される）。
//
// ## 中身
//
// - `SilenceDuckValue` … `useSilenceDuck` が返す物（**手で書かず実体から引く**）
// - `SilenceDuckProvider` … 囲い。中で要る物を心臓から読んで1回だけ呼ぶ
// - `useSilenceDuckCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useDoc } from './contentContext'
import { useSilenceDuck } from './useSilenceDuck'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type SilenceDuckValue = ReturnType<typeof useSilenceDuck>

const Ctx = createContext<SilenceDuckValue | null>(null)

export function SilenceDuckProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { segments } = useDoc()
  return <Ctx.Provider value={useSilenceDuck(segments)}>{children}</Ctx.Provider>
}

/** 静かな所を切る・声の間だけ BGM を下げるを見に行く。囲いの外で呼んだら、その場で落とす */
export function useSilenceDuckCtx(): SilenceDuckValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSilenceDuckCtx は SilenceDuckProvider の中でしか使えません')
  return v
}
