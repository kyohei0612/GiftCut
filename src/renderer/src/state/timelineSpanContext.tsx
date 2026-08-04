// タイムラインの長さ（出す長さ／本当の終わり）と、ものさしの目盛りを
// どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// 要る物は4つとも心臓にある（切片の並び・拡大率・fps・送る入れ物）。
// それなのに配線が呼んで **17本のフックへ配って**いた（`npm run passthrough`）。
//
// ## 長さが2つある理由は useTimelineSpan の中
//
// 「出す長さ」と「本当の終わり」は別物。混ぜると、素材より後ろへ置いた
// テロップが書き出しから落ちる。**ここでは触らない**（作る側に1つだけ）。
//
// ## 中身
//
// - `TimelineSpanValue` … `useTimelineSpan` が返す物（**手で書かず実体から引く**）
// - `TimelineSpanProvider` … 囲い。中で4つを心臓から読んで1回だけ呼ぶ
// - `useTimelineSpanCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { usePlaybackCtx } from './playbackContext'
import { useViewCtx } from './viewContext'
import { useSegLayoutCtx } from './segLayoutContext'
import { useTimelineBoxCtx } from './timelineBoxContext'
import { useTimelineSpan } from './useTimelineSpan'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type TimelineSpanValue = ReturnType<typeof useTimelineSpan>

const Ctx = createContext<TimelineSpanValue | null>(null)

export function TimelineSpanProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { videoTLen } = useSegLayoutCtx()
  const { zoom } = useViewCtx()
  const { fps } = usePlaybackCtx()
  const { scrollRef } = useTimelineBoxCtx()
  const value = useTimelineSpan({ videoTLen, zoom, fps, scrollRef })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** タイムラインの長さと目盛りを見に行く。囲いの外で呼んだら、その場で落とす */
export function useTimelineSpanCtx(): TimelineSpanValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTimelineSpanCtx は TimelineSpanProvider の中でしか使えません')
  return v
}
