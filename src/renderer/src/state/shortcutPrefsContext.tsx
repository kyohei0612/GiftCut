// キーの割り当てと、環境設定・ファイルメニューの開け閉めを、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useShortcutPrefs` は**引数を1つも取らない葉**なのに、`useAppWiring` が呼んで
// 各フックへ配り、束へ詰め直して心臓へ戻していた。**配るだけの名前は配線から消せる**
//（数え方と順番は `npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡す形にすると、囲いを描き直すたびに
// 作り直されて、持っていた値が消える。
//
// ## 中身
//
// - `ShortcutPrefsValue` … `useShortcutPrefs` が返す物（**手で書かず実体から引く**）
// - `ShortcutPrefsProvider` … 囲い。中で `useShortcutPrefs()` を1回だけ呼ぶ
// - `useShortcutPrefsCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useShortcutPrefs } from './useShortcutPrefs'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type ShortcutPrefsValue = ReturnType<typeof useShortcutPrefs>

const Ctx = createContext<ShortcutPrefsValue | null>(null)

export function ShortcutPrefsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useShortcutPrefs()}>{children}</Ctx.Provider>
}

/** キーの割り当てと、環境設定・ファイルメニューの開け閉めを見に行く。囲いの外で呼んだら、その場で落とす */
export function useShortcutPrefsCtx(): ShortcutPrefsValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useShortcutPrefsCtx は ShortcutPrefsProvider の中でしか使えません')
  return v
}
