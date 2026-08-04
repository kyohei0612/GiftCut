// 映像を映す <video> の台帳（A面/B面）を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useVideoEls` は**引数を1つも取らない葉**なのに、`useAppWiring` が呼んで
// 各フックへ配り、束へ詰め直して心臓へ戻していた。**配るだけの名前は配線から消せる**
//（数え方と順番は `npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡す形にすると、囲いを描き直すたびに
// 作り直されて、持っていた値が消える。
//
// ## 中身
//
// - `VideoElsValue` … `useVideoEls` が返す物（**手で書かず実体から引く**）
// - `VideoElsProvider` … 囲い。中で `useVideoEls()` を1回だけ呼ぶ
// - `useVideoElsCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useVideoEls } from './useVideoEls'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type VideoElsValue = ReturnType<typeof useVideoEls>

const Ctx = createContext<VideoElsValue | null>(null)

export function VideoElsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useVideoEls()}>{children}</Ctx.Provider>
}

/** 映像を映す <video> の台帳（A面/B面）を見に行く。囲いの外で呼んだら、その場で落とす */
export function useVideoElsCtx(): VideoElsValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useVideoElsCtx は VideoElsProvider の中でしか使えません')
  return v
}
