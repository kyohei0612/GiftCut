// 置き場（効果音・テロップの見本・動きの見本帳）と、その並べ方（★・フォルダ・畳み）を
// どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// この2つが返す **34個の名前は、`useAppWiring` では1つも使われていなかった**——
// 束（`rightPanel` / `menus`）へ詰め直して、また心臓へ入れているだけだった。
// **心臓 → 束 → また心臓の往復。** 数え方は `npm run passthrough`。
//
// 作る側をここへ上げると、配線からも束からも34個が消える。
// 使う側（タブのフック・品書き）は**元の心臓を直に見に行く**。
//
// ## 2つは互いを知らない
//
// `useLibraries`（置き場そのもの）と `useLibraryOrganize`（並べ方）は
// **またぐ名前が0個**（2026-08-03 に測って分けた）。だから呼ぶ順にも決まりが無く、
// 1つの囲いにまとめても混ざらない。
//
// ## 中身
//
// - `LibraryValue` … 上の2つが返す物を合わせた形（**手で書かず実体から引く**）
// - `LibraryProvider` … 囲い。中で2つを1回ずつ呼ぶ
// - `useLibraryCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useAskCtx } from './askContext'
import { useLibraries } from './useLibraries'
import { useLibraryOrganize } from './useLibraryOrganize'

/** **手で書かない。** 作っている側2つから引く */
export type LibraryValue = ReturnType<typeof useLibraries> & ReturnType<typeof useLibraryOrganize>

const Ctx = createContext<LibraryValue | null>(null)

export function LibraryProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { askText } = useAskCtx()
  const libs = useLibraries({ askText })
  const org = useLibraryOrganize({ askText })
  // **毎回新しい object を作らない。** 中身が同じでも別物になると、
  // これを見ている区画が全部描き直しになる（置き場は画面のあちこちが見ている）
  const value = useMemo(() => ({ ...libs, ...org }), [libs, org])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** 置き場と並べ方を見に行く。囲いの外で呼んだら、その場で落とす */
export function useLibraryCtx(): LibraryValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLibraryCtx は LibraryProvider の中でしか使えません')
  return v
}
