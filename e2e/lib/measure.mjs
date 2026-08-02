// 出来上がった動画を測る道具。似ているか・明るさ・音量・無音・コマ落ち。
//
// **どれも ffmpeg / ffprobe に聞くだけ。判定はしない**（何点なら合格かは呼ぶ側が決める）。
import { sh } from './shell.mjs'


// ---------------------------------------------------------------------------
/** 2枚の画像がどれくらい同じか（1.0 = 完全に同じ） */
export async function similarity(a, b) {
  const r = await sh('ffmpeg', ['-v', 'info', '-i', a, '-i', b, '-lavfi', 'ssim', '-f', 'null', '-'])
  const m = (r.err + r.out).match(/All:([\d.]+)/)
  return m ? Number(m[1]) : NaN
}
/** 画像の明るさの分布。真っ黒・真っ白・のっぺりを見分ける。 */
export async function brightness(file) {
  // signalstats は数値をフレームの付帯情報に入れるだけなので、metadata=print で吐かせる
  const r = await sh('ffmpeg', ['-i', file, '-vf', 'signalstats,metadata=print', '-f', 'null', '-'])
  const t = r.err + r.out
  const get = (k) => {
    const m = t.match(new RegExp(`lavfi\\.signalstats\\.${k}=([\\d.]+)`))
    return m ? Number(m[1]) : NaN
  }
  return { avg: get('YAVG'), min: get('YMIN'), max: get('YMAX') }
}
/** 音の平均音量(dB)。無音なら -91 付近になる。 */
export async function meanVolume(file) {
  const r = await sh('ffmpeg', ['-v', 'info', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'])
  const m = (r.err + r.out).match(/mean_volume:\s*(-?[\d.]+) dB/)
  return m ? Number(m[1]) : NaN
}
/** 無音区間の合計（秒）。音が丸ごと抜けていないかを見る。 */
export async function silentSec(file) {
  const r = await sh('ffmpeg', [
    '-v', 'info', '-i', file, '-af', 'silencedetect=noise=-50dB:d=1.5', '-f', 'null', '-'
  ])
  const t = r.err + r.out
  return [...t.matchAll(/silence_duration:\s*([\d.]+)/g)].reduce((a, m) => a + Number(m[1]), 0)
}

/** 60fps なら 16.7ms。どれくらい引っかかったかを分布で見る。 */
export function frameStats(frames) {
  const f = frames.filter((x) => x > 0).sort((a, b) => a - b)
  if (!f.length) return null
  const at = (p) => f[Math.min(f.length - 1, Math.floor(f.length * p))]
  return { n: f.length, median: at(0.5), p95: at(0.95), worst: f[f.length - 1], janky: f.filter((x) => x > 50).length }
}

