// 再生そのもの（流す・止める・飛ぶ・早送り・A面B面の入れ替え）を、
// どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// **配線でいちばん詰まっていた**——16本がこの先で止まっていた
//（`npm run passthrough`）。詰まりの理由は `videoDurationRef` **1つ**で、
// 配線が自分で `useRef` して `videoDuration` を写していただけだった。
// 元の持ち主（`useMedia`）へ移したら解けた。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `PlaybackEngineValue` … `usePlaybackEngine` が返す物（**手で書かず実体から引く**）
// - `PlaybackEngineProvider` … 囲い。中で `usePlaybackEngine()` を1回だけ呼ぶ
// - `usePlaybackEngineCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useHistoryCtx } from './historyContext'
import { useMediaCtx } from './mediaContext'
import { usePlaybackEngine } from './usePlaybackEngine'
import { useSeAudioCtx } from './seAudioContext'
import { useSegLayoutCtx } from './segLayoutContext'
import { useTimelineBoxCtx } from './timelineBoxContext'
import { useTimelineSpanCtx } from './timelineSpanContext'
import { useVideoElsCtx } from './videoElsContext'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type PlaybackEngineValue = ReturnType<typeof usePlaybackEngine>

const Ctx = createContext<PlaybackEngineValue | null>(null)

export function PlaybackEngineProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { videoRef, videoBRef, videoElsRef, elKey, setActiveHalf, halfOf } = useVideoElsCtx()
  const { segLayoutRef, videoTLenRef } = useSegLayoutCtx()
  const { srcOfSeg, videoDurationRef } = useMediaCtx()
  const { contentEndRef } = useTimelineSpanCtx()
  const { seAudioRefs, sePreviewRef } = useSeAudioCtx()
  const { paintTime, setTime } = useHistoryCtx()
  const { revealPlayhead } = useTimelineBoxCtx()
  const value = usePlaybackEngine({
    videoRef, videoBRef, videoElsRef, setActiveHalf, halfOf, elKey, segLayoutRef,
    srcOfSeg, videoTLenRef, videoDurationRef, contentEndRef,
    seAudioRefs, sePreviewRef, paintTime, setTime, revealPlayhead
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** 再生そのものを見に行く。囲いの外で呼んだら、その場で落とす */
export function usePlaybackEngineCtx(): PlaybackEngineValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePlaybackEngineCtx は PlaybackEngineProvider の中でしか使えません')
  return v
}
