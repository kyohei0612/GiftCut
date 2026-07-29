// テロップの「動き」の形。
//
// 中身の計算（出入りのアニメと重ねる所）は renderer 側の lib/telopStyle にあるが、
// **形だけはここに置く**。画面を持たない側（プリセットの取り込みなど）からも
// 同じ形を作る必要があるため。renderer を import すると Electron ごと引きずる。

import type { Keys } from './keyframes'

export interface Motion {
  /** 横位置（1080基準px。右が＋） */
  tx?: Keys
  /** 縦位置（1080基準px。下が＋） */
  ty?: Keys
  /** 大きさ（1=そのまま） */
  sc?: Keys
  /** 回転（度） */
  rot?: Keys
  /** 透明度（0..1） */
  op?: Keys
}
