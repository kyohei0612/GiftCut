// 喋っていない所を見つけて、切る範囲を出す。
//
// 切り抜きの定番作業。いまは人が波形を見ながら手で切っている。
//
// 判定そのもの（どこが無音か）は ffmpeg に任せ、ここでは
// 「素材の無音区間」→「タイムラインで消す範囲」への**変換だけ**を受け持つ。
// ここを純粋な計算にしておかないと、確かめるのに毎回アプリを起動することになる。

import { layoutSegs, segSpeed, type TimeSeg } from './timeline'

/** ffmpeg が返す無音区間（素材の時間・秒） */
export interface Silence {
  start: number
  dur: number
}

/** タイムライン上の範囲（秒） */
export interface CutRange {
  start: number
  end: number
}

export interface SilenceCutOpts {
  /**
   * 無音の前後に残す余白（秒）。
   * 0 にすると喋りの立ち上がりが削れて、ブツ切りに聞こえる。
   */
  pad: number
  /**
   * これより短くなった範囲は切らない（秒）。
   * 細かく切りすぎると、逆に不自然でカット点だらけになる。
   */
  minLen: number
}

export const DEFAULT_SILENCE_CUT: SilenceCutOpts = { pad: 0.15, minLen: 0.4 }

/** 重なっている・くっついている範囲をまとめる */
export function mergeRanges(ranges: readonly CutRange[], gap = 0.001): CutRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const out: CutRange[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end + gap) last.end = Math.max(last.end, r.end)
    else out.push({ ...r })
  }
  return out
}

/**
 * 素材の無音区間から、タイムラインで消す範囲を出す。
 *
 * 切片は同じ素材を指している前提（本編の1本を想定）。
 * 切片ごとに「その切片が使っている素材の範囲」と無音区間を重ね、
 * 重なった分だけをタイムラインの時間へ移す。
 *
 * **速度を変えた切片があっても正しく出す**（素材1秒 = タイムライン 1/速度 秒）。
 */
export function cutsFromSilences<S extends TimeSeg>(
  segs: readonly S[],
  silences: readonly Silence[],
  opts: SilenceCutOpts = DEFAULT_SILENCE_CUT
): CutRange[] {
  const pad = Math.max(0, opts.pad)
  const minLen = Math.max(0, opts.minLen)
  const out: CutRange[] = []
  for (const L of layoutSegs(segs)) {
    const sp = segSpeed(L.seg)
    const s0 = L.seg.srcStart
    const s1 = L.seg.srcEnd
    for (const q of silences) {
      // 素材の時間で重なりを取る。ここで余白ぶん内側へ寄せる
      const a = Math.max(s0, q.start + pad)
      const b = Math.min(s1, q.start + q.dur - pad)
      if (b - a < minLen * sp) continue // 速度が速いほど、素材上では長さが要る
      // タイムラインの時間へ
      const tA = L.tStart + (a - s0) / sp
      const tB = L.tStart + (b - s0) / sp
      out.push({ start: tA, end: tB })
    }
  }
  return mergeRanges(out).filter((r) => r.end - r.start >= minLen)
}

/** 消す範囲の合計（秒）。「これだけ短くなります」と先に見せるため */
export function totalCutLen(ranges: readonly CutRange[]): number {
  return ranges.reduce((a, r) => a + Math.max(0, r.end - r.start), 0)
}
