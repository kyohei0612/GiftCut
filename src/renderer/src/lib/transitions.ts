// トランジション（つなぎ目の演出）の種類と、見た目の対応。
//
// 名前は ffmpeg の xfade に合わせてある。ここを変えると書き出しと食い違う。

// トランジションの種類。頭/間/尻すべてで共通に使う（ffmpeg xfade の transition 名がベース）。
// dipblack/dipwhite は「間」では fadeblack/fadewhite（黒/白に沈んで戻る）、頭/尻では黒/白フェード。
export type TransType =
  | 'fade'
  | 'dipblack'
  | 'dipwhite'
  | 'slideleft'
  | 'slideright'
  | 'slideup'
  | 'slidedown'
  | 'wipeleft'
  | 'wiperight'
export const TRANS_TYPES: { type: TransType; ico: string; label: string }[] = [
  { type: 'fade', ico: '◧', label: 'ディゾルブ' },
  { type: 'dipblack', ico: '🌑', label: '黒フェード' },
  { type: 'dipwhite', ico: '⚡', label: '白フェード' },
  { type: 'slideright', ico: '➡', label: 'スライド右' },
  { type: 'slideleft', ico: '⬅', label: 'スライド左' },
  { type: 'slideup', ico: '⬆', label: 'スライド上' },
  { type: 'slidedown', ico: '⬇', label: 'スライド下' },
  { type: 'wiperight', ico: '▶', label: 'ワイプ右' },
  { type: 'wipeleft', ico: '◀', label: 'ワイプ左' }
]
/**
 * つなぎ目の演出の長さの上限（秒）。**スライダーも帯のドラッグも、ここ1つを見る。**
 *
 * 2026-08-16 に 2秒 → 5秒。「もっと長くしたい」（本人）。
 * 2秒だったのは、実効長が素材の余白で頭打ちになっていた時代の名残で、
 * **その制限を外した日に上限だけが残っていた**（`shared/timeline` の `xfadeDurAt`）。
 * いまは足りないぶんを最初のコマで埋めるので、素材の長さが許すかぎり掛けられる。
 *
 * ※ 実際に効く長さは、これとは別に**左右のクリップの長さ**で抑えられる
 *   （3秒のクリップに5秒の重なりは作れない）。そちらが本当の上限。
 */
export const TRANS_MAX_SEC = 5

export const transLabel = (t?: TransType): string =>
  TRANS_TYPES.find((x) => x.type === (t ?? 'fade'))?.label ?? 'ディゾルブ'
export const transIco = (t?: TransType): string =>
  TRANS_TYPES.find((x) => x.type === (t ?? 'fade'))?.ico ?? '◧'
// dip系のフェード色（頭/尻フェードの色）。fade も黒扱い。slide/wipe は null。
export const dipColor = (t: TransType): 'black' | 'white' | null =>
  t === 'dipwhite' ? 'white' : t === 'dipblack' || t === 'fade' ? 'black' : null
// タイムライン帯のクラス（見た目: 黒/白ディップ or モーション）。
export const bandClass = (t: TransType): string =>
  t === 'dipwhite'
    ? 'ttrans-dip ttrans-white'
    : t === 'dipblack'
      ? 'ttrans-dip ttrans-black'
      : t === 'fade'
        ? 'ttrans-xfade'
        : 'ttrans-motion'
// クリップ単体（頭/尻）または間の1トランジション。
export interface SegTrans {
  type: TransType
  dur: number // 秒
}
// 保存データ→SegTrans 復元。旧形式 {color:'black'|'white'} は dip系へ移行。不正は undefined。
/* eslint-disable @typescript-eslint/no-explicit-any */
export function loadSegTrans(raw: any): SegTrans | undefined {
  if (!raw || !(Number(raw.dur) > 0)) return undefined
  const dur = Number(raw.dur)
  if (TRANS_TYPES.some((x) => x.type === raw.type)) return { type: raw.type as TransType, dur }
  // 旧: 色ディップ
  if (raw.color === 'white') return { type: 'dipwhite', dur }
  if (raw.color === 'black') return { type: 'dipblack', dur }
  // 旧 xfade: type 無し＝fade
  return { type: 'fade', dur }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
