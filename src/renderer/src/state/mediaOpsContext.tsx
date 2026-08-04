// MediaOps を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useMediaOps` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `MediaOpsValue` … `useMediaOps` が返す物（**手で書かず実体から引く**）
// - `MediaOpsProvider` … 囲い。中で `useMediaOps()` を1回だけ呼ぶ
// - `useMediaOpsCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useAppChromeCtx } from './appChromeContext'
import { useHistoryCtx } from './historyContext'
import { useLibraryCtx } from './libraryContext'
import { useMediaCtx } from './mediaContext'
import { usePlaybackEngineCtx } from './playbackEngineContext'
import { useVideoElsCtx } from './videoElsContext'
import { kindOf } from './useSegOps'
import { useMediaOps } from './useMediaOps'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type MediaOpsValue = ReturnType<typeof useMediaOps>

const Ctx = createContext<MediaOpsValue | null>(null)

export function MediaOpsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { proxyForPathRef, initializedForPathRef } = useAppChromeCtx()
  const { setTime, baselineRef, redoStackRef, pendingTimerRef, undoStackRef, suppressHistoryRef } = useHistoryCtx()
  const { setOpenAccSec } = useLibraryCtx()
  const { srcAddedAtRef } = useMediaCtx()
  const { stopPlayback } = usePlaybackEngineCtx()
  const { videoElsRef } = useVideoElsCtx()
  const value = useMediaOps({
    stopPlayback,
    setTime,
    kindOf,
    setOpenAccSec,
    videoElsRef,
    proxyForPathRef,
    srcAddedAtRef,
    initializedForPathRef,
    baselineRef,
    redoStackRef,
    pendingTimerRef,
    undoStackRef,
    suppressHistoryRef
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** MediaOps を見に行く。囲いの外で呼んだら、その場で落とす */
export function useMediaOpsCtx(): MediaOpsValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useMediaOpsCtx は MediaOpsProvider の中でしか使えません')
  return v
}
