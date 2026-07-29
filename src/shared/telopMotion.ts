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
  /**
   * 横だけの拡大（1=そのまま）。Premiere の「スケール(幅)」。
   * **弾む・伸びる演出に要る**（滑り込みながら横に潰れて戻る、が作れない）
   */
  scx?: Keys
  /** 歪曲（度）。斜体と同じ skewX で傾ける。Premiere の「歪曲」 */
  skew?: Keys
  /** 横回転（度・Y軸）。Premiere の基本3D「スウィベル」 */
  roty?: Keys
  /** 縦回転（度・X軸）。基本3D「チルト」 */
  rotx?: Keys
  /** 明るさ（1=そのまま）。ProcAmp の明度 */
  bright?: Keys
  /** ぼかし（px・1080基準）。ガウスぼかし */
  blur?: Keys
  /** 切り抜き（各辺 0..1）。タイプライターや「光」系に要る */
  cl?: Keys
  ct?: Keys
  cr?: Keys
  cb?: Keys
}
