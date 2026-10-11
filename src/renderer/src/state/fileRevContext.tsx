// 参照している素材ファイルの版を、どの区画からでも触れるようにする。
//
// ## なぜ囲いか（2026-10-11）
//
// `useFileRev` は**引数を1つも取らない葉**。最初から囲いにして、使う側
//（プレビューの <img>・スクショ・main からの知らせ）が自分で見に行く
//（配線 `useAppWiring` には書かない。決まりは `CLAUDE.md` の「フックを1本足すとき」）。
//
// **中身はここで作る。** 上で作って渡す形にすると、囲いを描き直すたびに
// 作り直されて、持っていた値が消える。
//
// ## 中身
//
// - `FileRevValue` … `useFileRev` が返す物（**手で書かず実体から引く**）
// - `FileRevProvider` … 囲い。中で `useFileRev()` を1回だけ呼ぶ
// - `useFileRevCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useFileRev } from './useFileRev'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type FileRevValue = ReturnType<typeof useFileRev>

const Ctx = createContext<FileRevValue | null>(null)

export function FileRevProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useFileRev()}>{children}</Ctx.Provider>
}

/** 参照している素材ファイルの版を見に行く。囲いの外で呼んだら、その場で落とす */
export function useFileRevCtx(): FileRevValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useFileRevCtx は FileRevProvider の中でしか使えません')
  return v
}
