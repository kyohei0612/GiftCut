// 動画クリップ・画像の「動き」（キーフレーム）。
//
// テロップのモーション（lib/telopStyle の Motion）と同じ考え方だが、**項目が違う**。
// クリップと画像で動かせるのは、いま `zoom { scale, x, y }` として持っている3つだけ:
//
//   拡大 … 1=そのまま。**1未満は打てない**（下の「なぜ1未満が無いのか」）
//   位置X / 位置Y … フレーム比の中心オフセット。寄っている中でどこを見せるか
//
// 回転と不透明度を入れていないのは、**書き出し側に時間で変える手が無い**ため。
// `rotate` の角度も `colorchannelmixer` の透明度も式を取らないので、入れると
// 「プレビューでは動くのに書き出すと動かない」になる。それは一番たちの悪いズレ。
//
// 値は**絶対値**で持つ（テロップは元の値との差だが、こちらは元の値と同じ単位なので
// そのまま入れられる）。⏱ を押した瞬間、いまの固定値でキーが1つ置かれる＝
// 見た目が変わらない、という素直な動きになる。
//
// 時刻は**クリップの先頭からの秒**（タイムライン上の絶対時刻ではない）。
// 絶対時刻で持つと、クリップを動かした瞬間に動きが置いていかれる。
//
// ## なぜ1未満（引く）が無いのか
//
// 書き出しで時間ごとに拡大率を変えられるのは `zoompan` だけで、これは1倍以上
// （寄る）しかできない。1未満を時間で変えるには元を先に大きく作る必要があり、
// 0.2倍まで許すと元を5倍（9600px）に拡大することになって重すぎる。
// 切り抜きの「話者にシュッと寄る」は1倍以上なので、実用上はここで足りる。
//
// **固定の zoom は今までどおり1未満にできる**（従来の scale+pad で焼く）。
// 打てないのは「動きのキー」だけ。

import { valueAt, hasKeys, sanitizeKeys, keyTimesOf, type Keys } from './keyframes'

export interface Zoom {
  scale: number
  x: number
  y: number
}

export interface ClipMotion {
  /** 拡大（1=そのまま）。1未満は打てない */
  sc?: Keys
  /** 横位置（フレーム比。右が＋） */
  x?: Keys
  /** 縦位置（フレーム比。下が＋） */
  y?: Keys
}

export const NEUTRAL_ZOOM: Zoom = { scale: 1, x: 0, y: 0 }

/** 動きのキーとして置ける最小の拡大率（zoompan が1倍以上しか扱えない） */
export const MIN_MOTION_SCALE = 1

export const hasClipMotion = (m?: ClipMotion): boolean =>
  !!m && (hasKeys(m.sc) || hasKeys(m.x) || hasKeys(m.y))

/**
 * その時刻の zoom。**印が1つも無ければ、今までの固定値をそのまま返す。**
 * プレビューも書き出しの式もここから作る（別々に計算するとズレる）。
 *
 * @param t クリップの先頭からの秒
 */
export function zoomAt(zoom: Zoom | undefined, m: ClipMotion | undefined, t: number): Zoom {
  const base = zoom ?? NEUTRAL_ZOOM
  if (!hasClipMotion(m)) return base
  return {
    // 拡大だけは1で止める。**書き出しの zoompan が1で止めるので、画面も同じにする**
    scale: hasKeys(m!.sc)
      ? Math.max(MIN_MOTION_SCALE, valueAt(m!.sc, t, base.scale))
      : base.scale,
    x: valueAt(m!.x, t, base.x),
    y: valueAt(m!.y, t, base.y)
  }
}

/** 保存ファイルから読み直すときの検査（壊れていたら「動き無し」に落とす。落ちない） */
export function sanitizeClipMotion(v: unknown): ClipMotion | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const sc = sanitizeKeys(o.sc)
  const m: ClipMotion = {
    // 古い保存や手書きで1未満が入っていても、打てない値は打てない値として直す
    sc: sc?.map((k) => ({ ...k, v: Math.max(MIN_MOTION_SCALE, k.v) })),
    x: sanitizeKeys(o.x),
    y: sanitizeKeys(o.y)
  }
  return hasClipMotion(m) ? m : undefined
}

/** そのクリップに打たれている印の時刻（クリップ先頭からの秒）。タイムラインに出す */
export function clipMotionKeyTimes(m?: ClipMotion): number[] {
  return m ? keyTimesOf(m.sc, m.x, m.y) : []
}
