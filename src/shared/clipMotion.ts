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

import { valueAt, hasKeys, sanitizeKeys, keyTimesOf, keysToExpr, type Keys } from './keyframes'

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
    // **動きが1つでも付いていれば、拡大は1で止める。**
    // 焼くのは zoompan で、これは1倍以上しか扱えない。位置だけ動かしたい人でも、
    // 引いたまま（0.5倍など）では焼けないので、画面の方を書き出しに合わせる。
    // 合わせないと「画面では小さいのに書き出すと大きい」になる。
    scale: Math.max(MIN_MOTION_SCALE, valueAt(m!.sc, t, base.scale)),
    x: valueAt(m!.x, t, base.x),
    y: valueAt(m!.y, t, base.y)
  }
}

/**
 * 書き出し（ffmpeg）の zoompan を組み立てる。**プレビューと同じ折れ線を式にする。**
 *
 * zoompan を使うのは「時間で拡大率を変えられる唯一のフィルタ」だから。
 * 代わりに使っていた `scale`＋`crop` は、切り出す**大きさ**に時間の式を書けない
 * （crop の w/h は最初に1回だけ評価される）。
 *
 * 座標の対応（いまの固定値の焼き方と1対1で合わせてある）:
 *   固定: scale=W*s:H*s, crop=W:H:(iw-W)/2-x*W:(ih-H)/2-y*H
 *   これを元の絵の座標に直すと、切り出し窓は
 *     幅 = W/s、左 = W/2 - W/(2s) - x*W/s
 *   zoompan の x は「元の絵の座標での窓の左上」なので、そのまま同じ式になる。
 *
 * 注意（実際に測って分かったこと）:
 *   - zoompan は**出力の時刻を作り直す**（入れる前にずらしておいた時刻は消える）。
 *     重ねる物は、この後ろで置き直すこと
 *   - `s` の既定は hd720、`fps` の既定は 25。**両方必ず指定する**
 *   - 静止画は1枚しか入って来ないので、frames に「尺×fps」を渡して増やす
 */
export function zoompanFilter(
  zoom: Zoom | undefined,
  m: ClipMotion | undefined,
  o: {
    width: number
    height: number
    /** 秒を表す式。zoompan で使えるのは出力フレーム番号 on だけなので `on/30` の形 */
    timeExpr: string
    /** ffmpeg へ渡す fps 表記（30 や 30000/1001） */
    fpsArg: string
    /** 入力1フレームから何フレーム出すか（動画=1、静止画=尺×fps） */
    frames: number
  }
): string {
  const base = zoom ?? NEUTRAL_ZOOM
  const t = o.timeExpr
  // 固定値も1で止める（zoomAt と同じ。画面と書き出しを一致させる）
  const z = keysToExpr(m?.sc, Math.max(MIN_MOTION_SCALE, base.scale), t)
  const zExpr = `max(1,${z})`
  const xExpr = `iw/2-(iw/zoom/2)-(${keysToExpr(m?.x, base.x, t)})*iw/zoom`
  const yExpr = `ih/2-(ih/zoom/2)-(${keysToExpr(m?.y, base.y, t)})*ih/zoom`
  // 式にはカンマが入る（if(lt(t,1),a,b)）。フィルタの区切りと混ざらないよう ' で囲む
  const q = (s: string): string => `'${s.replace(/'/g, '')}'`
  return (
    `zoompan=z=${q(zExpr)}:x=${q(xExpr)}:y=${q(yExpr)}` +
    `:d=${Math.max(1, Math.round(o.frames))}:s=${o.width}x${o.height}:fps=${o.fpsArg}`
  )
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
