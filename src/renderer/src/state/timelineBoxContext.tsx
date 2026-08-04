// タイムラインの箱への参照と、追従（縦・横）を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useTimelineBox` は**引数を1つも取らない葉**なのに、`useAppWiring` が呼んで
// 各フックへ配り、束へ詰め直して心臓へ戻していた。**配るだけの名前は配線から消せる**
//（数え方と順番は `npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡す形にすると、囲いを描き直すたびに
// 作り直されて、持っていた値が消える。
//
// ## 中身
//
// - `TimelineBoxValue` … `useTimelineBox` が返す物（**手で書かず実体から引く**）
// - `TimelineBoxProvider` … 囲い。中で `useTimelineBox()` を1回だけ呼ぶ
// - `useTimelineBoxCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useTimelineBox } from './useTimelineBox'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type TimelineBoxValue = ReturnType<typeof useTimelineBox>

const Ctx = createContext<TimelineBoxValue | null>(null)

export function TimelineBoxProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useTimelineBox()}>{children}</Ctx.Provider>
}

/** タイムラインの箱への参照と、追従（縦・横）を見に行く。囲いの外で呼んだら、その場で落とす */
export function useTimelineBoxCtx(): TimelineBoxValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTimelineBoxCtx は TimelineBoxProvider の中でしか使えません')
  return v
}
