// 音のトラック1本ぶんの音量を出す。
//
// ## なぜ分けて置くか
//
// **「状態が無い」を「消音」と読んでいて、復元したプロジェクトで SE が
// 1つも鳴らなくなっていた。** しかも書き出しにも同じ式があり、そちらでも
// 無音になっていた（気づけるのは書き出したあと）。
//
// 音の不具合は「鳴らない」方に倒れると気づきにくい。目で見える物と違って、
// 鳴らない事に気づくには、そこを聴くまで分からない。だから画面を起動せずに
// 確かめられる所へ出して、規則をテストで固定する。

export interface TrackState {
  volume?: number
  muted?: boolean
  solo?: boolean
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/**
 * 聴くときの音量（0〜1）。
 *
 * **状態が無いトラックは「既定」＝そのまま鳴らす。**
 * 設定を触っていないトラックの状態は保存されないことがあるので、
 * 無い＝消音にすると、保存して開き直しただけで音が消える。
 *
 * ソロはモニタリング用。誰かがソロなら、ソロでない物は黙る。
 */
export function trackGain(
  st: TrackState | undefined,
  masterVolume: number,
  anySolo: boolean
): number {
  if (st?.muted) return 0
  if (anySolo && !st?.solo) return 0
  return clamp01((st?.volume ?? 1) * masterVolume)
}

/**
 * 書き出すときの音量（0〜1）。
 *
 * **ソロは効かせない。** ソロはモニタリング専用の約束（プレミアでも各DAWでも同じ）。
 * BGMだけ確認しようとソロにしたまま書き出して、本編もSEも全部無音の動画が
 * できる事故を防ぐ。反映するのはミュートと音量だけ。
 */
export function trackGainForExport(st: TrackState | undefined, masterVolume: number): number {
  if (st?.muted) return 0
  return clamp01((st?.volume ?? 1) * masterVolume)
}
