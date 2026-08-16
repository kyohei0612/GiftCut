// ViewNav を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useViewNav` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `ViewNavValue` … `useViewNav` が返す物（**手で書かず実体から引く**）
// - `ViewNavProvider` … 囲い。中で `useViewNav()` を1回だけ呼ぶ
// - `useViewNavCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { usePlaybackEngineCtx } from './playbackEngineContext'
import { useTimelineBoxCtx } from './timelineBoxContext'
import { useTimelineSpanCtx } from './timelineSpanContext'
import { useViewNav } from './useViewNav'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type ViewNavValue = ReturnType<typeof useViewNav>

const Ctx = createContext<ViewNavValue | null>(null)

export function ViewNavProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { seekTo } = usePlaybackEngineCtx()
  const { scrollRef, trackInnerRef } = useTimelineBoxCtx()
  // **引ける下限は `viewEnd` から**（＝末尾の空白まで見える所まで引ける）。
  // ↔（全体表示）が合わせる先は `contentEndRef` のままなので、押した絵は変わらない
  const { contentEndRef, viewEndRef } = useTimelineSpanCtx()
  const value = useViewNav({
    scrollRef, trackInnerRef, contentEndRef, durationRef: viewEndRef, seekTo
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** ViewNav を見に行く。囲いの外で呼んだら、その場で落とす */
export function useViewNavCtx(): ViewNavValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useViewNavCtx は ViewNavProvider の中でしか使えません')
  return v
}
