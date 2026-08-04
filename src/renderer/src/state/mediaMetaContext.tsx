// 取り込んだ素材の下ごしらえ（尺・波形の控え）を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useMediaMeta` が返す5つは、**配線が受け取って6本のフックへ配り直していただけ**
// だった（`npm run passthrough` の「先を6本解く」）。ここへ上げると、
// その6本も「要る物が全部 心臓から取れる」側へ回る。
//
// ## 引数を1つ取るので `mkctx` では作れない
//
// 要るのは履歴の控え（元に戻すと出てくる素材の分まで残すため）だけで、
// それは `useHistoryCtx` から取れる。**上（App）で作って渡さない**——
// 囲いを描き直すたびに作り直されて、控えが消える。
//
// ## 呼ぶ順が入れ替わっている（が、害が無いことを確かめてある）
//
// 配線では「**履歴より後で呼ぶ**」だったが、囲いは `HistoryProvider` の**内側**
// なので、効果（useEffect）は逆に**こちらが先**に走る。それでよいのは、
// 履歴の控えを見るのが `historySnaps()` を**呼んだ瞬間**（3秒後の setTimeout の中）
// だけで、効果の走った順を見ていないため。
//
// ## 中身
//
// - `MediaMetaValue` … `useMediaMeta` が返す物（**手で書かず実体から引く**）
// - `MediaMetaProvider` … 囲い。中で `useMediaMeta()` を1回だけ呼ぶ
// - `useMediaMetaCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useHistoryCtx } from './historyContext'
import { useMediaMeta } from './useMediaMeta'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type MediaMetaValue = ReturnType<typeof useMediaMeta>

const Ctx = createContext<MediaMetaValue | null>(null)

export function MediaMetaProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { undoStackRef, redoStackRef } = useHistoryCtx()
  const { mediaMeta, setMediaMeta, mediaMetaRef, metaInFlightRef, thumbDoneRef } = useMediaMeta({
    historySnaps: () => [...undoStackRef.current, ...redoStackRef.current]
  })
  // **毎回新しい object を作らない**（これを見ている区画が全部描き直しになる）。
  // 変わるのは `mediaMeta` だけで、あとの4つは据え置き。
  const value = useMemo(
    () => ({ mediaMeta, setMediaMeta, mediaMetaRef, metaInFlightRef, thumbDoneRef }),
    [mediaMeta, setMediaMeta, mediaMetaRef, metaInFlightRef, thumbDoneRef]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** 素材の下ごしらえを見に行く。囲いの外で呼んだら、その場で落とす */
export function useMediaMetaCtx(): MediaMetaValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useMediaMetaCtx は MediaMetaProvider の中でしか使えません')
  return v
}
