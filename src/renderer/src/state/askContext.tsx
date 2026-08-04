// 人に聞く（文字を入れてもらう・はい/いいえ）を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useAsk` は**引数を1つも取らない葉**なのに、`useAppWiring` が呼んで
// 5つのフックへ配り、さらに `dialogs` の束へ詰め直していた。
// 配るだけの名前は配線から消せる（数え方は `npm run passthrough`）。
//
// **中身はここで作る。** 上の `App` で作って渡す形にすると、囲いを描き直す
// たびに作り直されて、聞いている最中の状態が消える。`useAsk` は自分で
// state を持つので、囲いの中で1回だけ呼ぶのが正しい。
//
// ## 中身
//
// - `Ask` … `useAsk` が返す物（**手で書かず実体から引く**）
// - `AskProvider` … 囲い。中で `useAsk()` を1回だけ呼ぶ
// - `useAskCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useAsk } from './useAsk'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type Ask = ReturnType<typeof useAsk>

const Ctx = createContext<Ask | null>(null)

export function AskProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useAsk()}>{children}</Ctx.Provider>
}

/** 人に聞く物を見に行く。囲いの外で呼んだら、その場で落とす */
export function useAskCtx(): Ask {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAskCtx は AskProvider の中でしか使えません')
  return v
}
