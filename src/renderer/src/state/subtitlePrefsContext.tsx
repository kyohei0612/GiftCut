// 字幕づくりの設定と進み具合を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useSubtitlePrefs` は**引数を1つも取らない葉**なのに、`useAppWiring` が呼んで
// 各フックへ配り、束へ詰め直して心臓へ戻していた。**配るだけの名前は配線から消せる**
//（数え方と順番は `npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡す形にすると、囲いを描き直すたびに
// 作り直されて、持っていた値が消える。
//
// ## 中身
//
// - `SubtitlePrefsValue` … `useSubtitlePrefs` が返す物（**手で書かず実体から引く**）
// - `SubtitlePrefsProvider` … 囲い。中で `useSubtitlePrefs()` を1回だけ呼ぶ
// - `useSubtitlePrefsCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useSubtitlePrefs } from './useSubtitlePrefs'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type SubtitlePrefsValue = ReturnType<typeof useSubtitlePrefs>

const Ctx = createContext<SubtitlePrefsValue | null>(null)

export function SubtitlePrefsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useSubtitlePrefs()}>{children}</Ctx.Provider>
}

/** 字幕づくりの設定と進み具合を見に行く。囲いの外で呼んだら、その場で落とす */
export function useSubtitlePrefsCtx(): SubtitlePrefsValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSubtitlePrefsCtx は SubtitlePrefsProvider の中でしか使えません')
  return v
}
