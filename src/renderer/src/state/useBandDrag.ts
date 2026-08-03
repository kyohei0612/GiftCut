// 右のパネルから「帯になる物」をタイムラインへ放り込む最中の持ち物。
//
// ## なぜ1か所か
//
// つなぎ目の演出・テロップの出入り・見た目の見本・色のアイコン。
// **どれも同じ形**で、掴んだ物の種類を ref に置き、落とし先の見込みを
// state に置いて帯として見せる。バラバラに置くと、落とし先の見せ方だけが
// 種類ごとに食い違って、「ここに置ける」の出方が揃わなくなる。
//
// ## なぜ ref と state に分かれるか
//
//   掴んでいる物   … ref。**指を離したときの処理から読む。**
//                    state だと、掴み始めた時点の古い値が焼き付く。
//   落とし先の見込み … state。見せるために描き直しが要る。
import { useRef, useState } from 'react'
import type { TelopStyle, AnimIn } from '../lib/telopStyle'
import type { TransType } from '../lib/transitions'

/** つなぎ目の演出を置く見込み（V1のどのクリップの行に、どう描くか） */
export interface TransDrop {
  segId: number
  left: number
  width: number
  label: string
  kind: 'in' | 'out' | 'xfade'
}

/** テロップの出入りを置く見込み */
export interface TelopDrop {
  cueId: number
  left: number
  width: number
  label: string
  kind: 'in' | 'out' | 'between'
}

export function useBandDrag() {
  /** 色のアイコン（ラベル色）をテロップへ運んでいる最中 */
  const draggingIconRef = useRef<string | null>(null)

  /** つなぎ目の演出を運んでいる最中。頭/間/尻のどれになるかは落とし先で決まる */
  const draggingTransRef = useRef<{ type: TransType } | null>(null)
  const [transDrop, setTransDrop] = useState<TransDrop | null>(null)

  /** テロップの出入りを運んでいる最中（つなぎ目の演出と同じ流儀） */
  const draggingTelopAnimRef = useRef<{ type: AnimIn } | null>(null)
  const [telopDrop, setTelopDrop] = useState<TelopDrop | null>(null)

  /** 見た目の見本をテロップへ運んでいる最中 */
  const draggingTemplateRef = useRef<TelopStyle | null>(null)

  /**
   * 強調（揺れ・脈打ち）をテロップへ運んでいる最中。
   *
   * **クリックは据え置きで、掴んでも置けるようにする**（本人の方針）。
   * クリックは「選んでいるテロップに付け外し（トグル）」、掴んで落とす方は
   * 「**落とした先に付ける**」——落としたのに消えるのは意味が通らないので、
   * こちらはトグルにしない。
   */
  const draggingEmphasisRef = useRef<'shake' | 'pulse' | null>(null)

  return {
    draggingIconRef,
    draggingTransRef,
    transDrop,
    setTransDrop,
    draggingTelopAnimRef,
    telopDrop,
    setTelopDrop,
    draggingTemplateRef,
    draggingEmphasisRef
  }
}
