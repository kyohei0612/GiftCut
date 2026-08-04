// 段（トラック）の足す・消す・選ぶ・鍵・音量を、どの区画からでも触れるようにする。
//
// ## なぜ囲いにしたか（2026-08-04）
//
// 要る物は段の数え方（`./trackGeomContext`）だけで、心臓にある。
// それなのに配線が呼んで **15本のフックへ配って**いた（`npm run passthrough`）。
//
// ## 鍵はあらゆる編集の手前で見る
//
// だから**どこからでも同じ物が見えている**ことが要る。配線を経由して配ると、
// 経由しない所（区画が自分で見に行く所）から見えなくなる。
//
// ## 中身
//
// - `TracksAdminValue` … `useTracksAdmin` が返す物（**手で書かず実体から引く**）
// - `TracksAdminProvider` … 囲い。中で段の数え方を心臓から読んで1回だけ呼ぶ
// - `useTracksAdminCtx` … 見に行く。囲いの外で呼んだら、その場で落とす
import { createContext, useContext, type ReactNode } from 'react'
import { useTrackGeomCtx } from './trackGeomContext'
import { useTracksAdmin } from './useTracksAdmin'

/** **手で書かない。** 作っている側から引く（ズレようがない） */
export type TracksAdminValue = ReturnType<typeof useTracksAdmin>

const Ctx = createContext<TracksAdminValue | null>(null)

export function TracksAdminProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { anyAudioSolo, cueTrack, trackNum, nVideoTracks, nAudioTracks } = useTrackGeomCtx()
  const value = useTracksAdmin({ anyAudioSolo, cueTrack, trackNum, nVideoTracks, nAudioTracks })
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** 段の足す・消す・鍵・音量を見に行く。囲いの外で呼んだら、その場で落とす */
export function useTracksAdminCtx(): TracksAdminValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTracksAdminCtx は TracksAdminProvider の中でしか使えません')
  return v
}
