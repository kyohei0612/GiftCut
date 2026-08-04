// 見本帳の棚まわりを、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// 要る物が全部 心臓にあるのに、配線が呼んで各フックへ配っていた。
// **中身はここで作る**（上で作って渡すと、描き直すたびに作り直される）。
//
// ## 中身
//
// - `TemplateShelfValue` … `useTemplateShelf` が返す物（**手で書かず実体から引く**）
// - `TemplateShelfProvider` … 囲い。中で要る物を心臓から読んで1回だけ呼ぶ
// - `useTemplateShelfCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useLibraryCtx } from './libraryContext'
import { useTemplateShelf } from './useTemplateShelf'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type TemplateShelfValue = ReturnType<typeof useTemplateShelf>

const Ctx = createContext<TemplateShelfValue | null>(null)

export function TemplateShelfProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { openTplSec, refreshPresets } = useLibraryCtx()
  return <Ctx.Provider value={useTemplateShelf({ openTplSec, refreshPresets })}>{children}</Ctx.Provider>
}

/** 見本帳の棚まわりを見に行く。囲いの外で呼んだら、その場で落とす */
export function useTemplateShelfCtx(): TemplateShelfValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTemplateShelfCtx は TemplateShelfProvider の中でしか使えません')
  return v
}
