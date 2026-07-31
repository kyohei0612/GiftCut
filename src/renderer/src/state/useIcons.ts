// テロップの前に出すアイコン（コラボ相手の顔など）。
//
// ## 何を持っているか
//
// **「どの画像を持っているか」と「どこに出すか」は別の話。**
//   持ち物  … 取り込んだ画像・お気に入り・フォルダ分け・色/段への割り当て
//   出し方  … どちら側に付けるか・ずらし・大きさ・自動で揃えるか
//
// 混ぜて置いていたので、片方だけ直したいときに全部を読む羽目になっていた。
//
// ## 割り当ての優先順位
//
// テロップに出る画像は、次の順に決まる:
//
//   1. そのテロップに直接置いた画像（iconImage）
//   2. ラベルの色に割り当てた画像
//   3. その段（トラック）に割り当てた画像
//
// **何も割り当てていなければ出さない。** 出すのが既定だと、
// 色を付けただけで知らない顔が出てくることになる。

import { useState } from 'react'
import type { Cue } from '../lib/srt'

/** アイコンの置き場所 */
export type IconSide = 'left' | 'right' | 'top' | 'bottom'

export interface Icons {
  /** どちら側に付けるか */
  iconSide: IconSide
  setIconSide: React.Dispatch<React.SetStateAction<IconSide>>
  /** 微調整のずらし（1080px 基準） */
  iconOffset: { x: number; y: number }
  setIconOffset: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>
  iconScale: number
  setIconScale: React.Dispatch<React.SetStateAction<number>>
  /**
   * 全テロップでアイコンの位置を揃えるか。
   *
   * 揃えないと、テロップの文字量でアイコンが左右に飛び回る。
   */
  iconAuto: boolean
  setIconAuto: React.Dispatch<React.SetStateAction<boolean>>
  /** 揃えるときの軸（左端・縦中央の1点） */
  iconAnchorPos: { x: number; y: number } | null
  setIconAnchorPos: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>
  /** 設定を開いているか */
  iconSettingsOpen: boolean
  setIconSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>

  /** そのテロップに出す画像（上の優先順位で決まる。無ければ出さない） */
  iconForCue: (
    c: Cue,
    assign: Record<string, string>,
    laneAssign: Record<string, string>,
    trackOf: (c: Cue) => string
  ) => string | undefined
}

export function useIcons(): Icons {
  const [iconSide, setIconSide] = useState<IconSide>('left')
  const [iconOffset, setIconOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [iconScale, setIconScale] = useState<number>(1)
  const [iconAuto, setIconAuto] = useState<boolean>(false)
  const [iconAnchorPos, setIconAnchorPos] = useState<{ x: number; y: number } | null>(null)
  const [iconSettingsOpen, setIconSettingsOpen] = useState(false)

  return {
    iconSide,
    setIconSide,
    iconOffset,
    setIconOffset,
    iconScale,
    setIconScale,
    iconAuto,
    setIconAuto,
    iconAnchorPos,
    setIconAnchorPos,
    iconSettingsOpen,
    setIconSettingsOpen,
    iconForCue: (c, assign, laneAssign, trackOf) =>
      // **その1枚だけ消してある**ときは、割り当てがあっても出さない
      c.personIcon === false ? undefined : (c.iconImage ?? assign[c.label] ?? laneAssign[trackOf(c)])
  }
}
