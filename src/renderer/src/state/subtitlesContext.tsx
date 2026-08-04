// Subtitles を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useSubtitles` が要る物は**全部すでに心臓から取れる**のに、配線が取り出して渡し、
// 返ってきた物を束へ詰め直して心臓へ戻していた（`npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直される。
//
// ## 中身
//
// - `SubtitlesValue` … `useSubtitles` が返す物（**手で書かず実体から引く**）
// - `SubtitlesProvider` … 囲い。中で `useSubtitles()` を1回だけ呼ぶ
// - `useSubtitlesCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useAppChromeCtx } from './appChromeContext'
import { useAskCtx } from './askContext'
import { useHistoryCtx } from './historyContext'
import { usePlaybackEngineCtx } from './playbackEngineContext'
import { useProjectStateCtx } from './projectStateContext'
import { useSegLayoutCtx } from './segLayoutContext'
import { useSubtitlePrefsCtx } from './subtitlePrefsContext'
import { useSubtitles } from './useSubtitles'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type SubtitlesValue = ReturnType<typeof useSubtitles>

const Ctx = createContext<SubtitlesValue | null>(null)

export function SubtitlesProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { idCounter } = useAppChromeCtx()
  const { askConfirm } = useAskCtx()
  const { resetHistory } = useHistoryCtx()
  const { stopPlayback, seekTo } = usePlaybackEngineCtx()
  const { newTelopStyle, setSrtPath } = useProjectStateCtx()
  const { segLayout } = useSegLayoutCtx()
  const { subMaxChars, subReplace, setSubtitleOpen, setSubtitleState } = useSubtitlePrefsCtx()
  const value = useSubtitles({
    stopPlayback,
    seekTo,
    segLayout,
    resetHistory,
    askConfirm,
    idCounter,
    subMaxChars,
    subReplace,
    newTelopStyle,
    setSrtPath,
    setSubtitleOpen,
    setSubtitleState
  })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Subtitles を見に行く。囲いの外で呼んだら、その場で落とす */
export function useSubtitlesCtx(): SubtitlesValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSubtitlesCtx は SubtitlesProvider の中でしか使えません')
  return v
}
