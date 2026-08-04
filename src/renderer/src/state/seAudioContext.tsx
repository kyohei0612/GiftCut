// 効果音を鳴らす物（置いた物・試聴の物）を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// `useSeAudio` は**引数を1つも取らない葉**なのに、`useAppWiring` が呼んで
// 各フックへ配り、束へ詰め直して心臓へ戻していた。**配るだけの名前は配線から消せる**
//（数え方と順番は `npm run passthrough`）。
//
// **中身はここで作る。** 上で作って渡す形にすると、囲いを描き直すたびに
// 作り直されて、持っていた値が消える。
//
// ## 中身
//
// - `SeAudioValue` … `useSeAudio` が返す物（**手で書かず実体から引く**）
// - `SeAudioProvider` … 囲い。中で `useSeAudio()` を1回だけ呼ぶ
// - `useSeAudioCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useSeAudio } from './useSeAudio'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type SeAudioValue = ReturnType<typeof useSeAudio>

const Ctx = createContext<SeAudioValue | null>(null)

export function SeAudioProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <Ctx.Provider value={useSeAudio()}>{children}</Ctx.Provider>
}

/** 効果音を鳴らす物（置いた物・試聴の物）を見に行く。囲いの外で呼んだら、その場で落とす */
export function useSeAudioCtx(): SeAudioValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSeAudioCtx は SeAudioProvider の中でしか使えません')
  return v
}
