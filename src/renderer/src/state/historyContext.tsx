// 元に戻す・やり直す（控えと、時刻の入れ替え）を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// **これが配線でいちばん詰まっていた**——7本のフックがこれを待っていた
//（`npm run passthrough`）。待っていた理由は**ただの ref が2つ**で、
// どちらも配線が自分で `useRef` していただけだった。ここへ持ってくれば解ける。
//
// ## 2つの ref をここで作る理由
//
//   `lastPaintRef` … 再生中に最後に時刻を書いた瞬間（描き直しの間引き）。
//                    **使うのは履歴だけ**なので、外へ出さない。
//   `ratioRef`     … 「いまこの瞬間」の比率。履歴と、控えをまとめる側
//                    （`useHistoryCoalesce`）の**両方**が見るので外へ出す。
//
// **中身はここで作る。** 上で作って渡すと、囲いを描き直すたびに作り直されて
// 積んだ控えが消える。
//
// ## 中身
//
// - `HistoryValue` … `useHistory` が返す物 ＋ `ratioRef`（**手で書かず実体から引く**）
// - `HistoryProvider` … 囲い。中で ref を作って1回だけ呼ぶ
// - `useHistoryCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react'
import { usePlaybackCtx } from './playbackContext'
import { useProxyCtx } from './proxyContext'
import { useHistory } from './useHistory'
import type { Ratio } from './useExportSettings'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type HistoryValue = ReturnType<typeof useHistory> & {
  ratioRef: React.MutableRefObject<Ratio>
}

const Ctx = createContext<HistoryValue | null>(null)

export function HistoryProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { preparedRef } = usePlaybackCtx()
  const { previewResRef } = useProxyCtx()
  /** 再生中に最後に時刻を書いた瞬間（描き直しを間引くのに使う） */
  const lastPaintRef = useRef(0)
  /** 「いまこの瞬間」の比率。控えをまとめる側も見る */
  const ratioRef = useRef<Ratio>('16:9')
  const history = useHistory({ preparedRef, previewResRef, lastPaintRef, ratioRef })
  // **毎回新しい object を作らない**（これを見ている区画が全部描き直しになる）
  const value = useMemo(() => ({ ...history, ratioRef }), [history])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** 元に戻す・やり直すを見に行く。囲いの外で呼んだら、その場で落とす */
export function useHistoryCtx(): HistoryValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useHistoryCtx は HistoryProvider の中でしか使えません')
  return v
}
