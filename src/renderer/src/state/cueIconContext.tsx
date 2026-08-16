// 「そのテロップに出すアイコン画像」を、どの区画からでも触れるようにする。
//
// ## なぜ別の囲いにしたか（2026-08-04）
//
// 決まり（優先順位）そのものは `useIcons` が持っている。ここがやるのは
// **その決まりに、いまの割り当て3つを当てる**だけ:
//
//   個別（テロップに直に落とした絵） → 色（ラベル）の割り当て → 段の割り当て
//
// 当てるのに要る物が `useIcons` ／ プロジェクトの控え ／ 段の geometry と
// **3つの心臓にまたがる**ので、どれか1つの中には置けない。配線が持っていた
// せいで2本のフックが上げられずにいた（`npm run passthrough` の「詰まりの根」）。
//
// ## 中身
//
// - `CueIconProvider` … 囲い。決まりに割り当て3つを当てる
// - `useCueIcon` … そのテロップに出す画像と、**アイコンの縁の色**
import { createContext, useContext, type ReactNode } from 'react'
import { useIconsCtx } from './iconsContext'
import { useProjectStateCtx } from './projectStateContext'
import { useTrackGeomCtx } from './trackGeomContext'
import type { Cue } from '../lib/srt'

/**
 * **1つしか無くても object で返す。**
 * 関数を直に配ると、使う側が `const f = useCueIcon()` と書くことになり、
 * `npm run passthrough` の記号解決が「心臓から取った物」と見なせない
 *（見ているのは分割代入だけ）。数え落とすと剥く順が狂う。
 */
export interface CueIconValue {
  iconForCue: (c: Cue) => string | undefined
  /**
   * そのテロップのアイコンの**縁の色**。
   *
   * **人物（＝ラベルの色）ごとに持たせた色**があればそれ、無ければラベル色そのもの
   *（2026-08-16 まではラベル色しか無く、帯の色分けと縁が連動していた）。
   *
   * **画面と書き出しの両方がここを通る。** 別々に決めると、
   * プレビューと焼けた絵で縁の色が違う——書き出すまで気づけない形になる。
   */
  ringForCue: (c: Cue) => string
}

const Ctx = createContext<CueIconValue | null>(null)

export function CueIconProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const icons = useIconsCtx()
  const { iconAssign, laneIconAssign, iconRing } = useProjectStateCtx()
  const { cueTrack } = useTrackGeomCtx()
  const iconForCue = (c: Cue): string | undefined =>
    icons.iconForCue(c, iconAssign, laneIconAssign, cueTrack)
  const ringForCue = (c: Cue): string => iconRing[c.label] || c.label
  return <Ctx.Provider value={{ iconForCue, ringForCue }}>{children}</Ctx.Provider>
}

/** そのテロップに出すアイコン画像を見に行く。囲いの外で呼んだら、その場で落とす */
export function useCueIcon(): CueIconValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCueIcon は CueIconProvider の中でしか使えません')
  return v
}
