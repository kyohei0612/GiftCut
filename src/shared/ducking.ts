// 声が入っている間だけ BGM を下げる（ダッキング）。
//
// 切り抜きで BGM を敷くなら必須。手でやると、声のたびに音量を打ち込むことになる。
//
// ここでは「どこで・どれだけ下げるか」の**計算だけ**を持つ。
// 実際に音を下げるのは、プレビュー（再生中の音量）と書き出し（ffmpeg）の両方。
// **同じ計算を両方で使う**ので、プレビューで聴いた通りに書き出される。

import type { Silence } from './silenceCut'

export interface DuckOpts {
  /** 声のある間、どれだけ下げるか（dB。-12 なら約1/4の音量） */
  amountDb: number
  /** 下がりきるまでの時間（秒）。速すぎるとブツッと鳴る */
  attack: number
  /** 戻りきるまでの時間（秒）。速すぎると不自然に戻る */
  release: number
}

export const DEFAULT_DUCK: DuckOpts = { amountDb: -12, attack: 0.15, release: 0.4 }

/** 音量の折れ線。t 秒で g 倍（1=そのまま） */
export interface GainPoint {
  t: number
  g: number
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

/**
 * 無音区間の裏返し＝声が入っている区間。
 *
 * 無音の一覧しか無いので、その隙間を声とみなす。
 * 「声を探す」より「静かな所を探す」方が、しきい値をいじれる分あてになる。
 */
export function voiceRegions(
  silences: readonly Silence[],
  totalDur: number
): { start: number; end: number }[] {
  const sorted = [...silences]
    .map((s) => ({ start: Math.max(0, s.start), end: Math.max(0, s.start + s.dur) }))
    .sort((a, b) => a.start - b.start)
  const out: { start: number; end: number }[] = []
  let cur = 0
  for (const s of sorted) {
    if (s.start > cur) out.push({ start: cur, end: Math.min(s.start, totalDur) })
    cur = Math.max(cur, s.end)
  }
  if (cur < totalDur) out.push({ start: cur, end: totalDur })
  return out.filter((r) => r.end - r.start > 0.001)
}

/**
 * 声の区間から、音量の折れ線を作る。
 *
 * 声の**手前**で下げ始めて（attack）、声が終わってから戻す（release）。
 * 声と同時に下げると、頭の一音が大きいまま残る。
 */
export function duckEnvelope(
  regions: readonly { start: number; end: number }[],
  opts: DuckOpts = DEFAULT_DUCK
): GainPoint[] {
  const low = dbToGain(opts.amountDb)
  const at = Math.max(0.01, opts.attack)
  const rel = Math.max(0.01, opts.release)
  const pts: GainPoint[] = []
  for (const r of regions) {
    pts.push({ t: Math.max(0, r.start - at), g: 1 })
    pts.push({ t: r.start, g: low })
    pts.push({ t: r.end, g: low })
    pts.push({ t: r.end + rel, g: 1 })
  }
  // 声が近いと折れ線が交差する。時間順に並べ、同じ時間なら小さい方（下げた方）を残す
  pts.sort((a, b) => a.t - b.t || a.g - b.g)
  const out: GainPoint[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.t - p.t) < 1e-6) {
      last.g = Math.min(last.g, p.g)
      continue
    }
    // 下がっている途中で戻し始めない（間が詰まった声で音量が波打つのを防ぐ）
    if (last && last.g < 1 && p.g === 1) {
      const next = pts.find((q) => q.t > p.t && q.g < 1)
      if (next && next.t - p.t < rel) continue
    }
    out.push({ ...p })
  }
  return out
}

/** 折れ線の t 秒での倍率（間は直線でつなぐ） */
export function gainAt(env: readonly GainPoint[], t: number): number {
  if (!env.length) return 1
  if (t <= env[0].t) return env[0].g
  const last = env[env.length - 1]
  if (t >= last.t) return last.g
  for (let i = 1; i < env.length; i++) {
    const a = env[i - 1]
    const b = env[i]
    if (t <= b.t) {
      const span = b.t - a.t
      if (span <= 1e-9) return b.g
      return a.g + ((t - a.t) / span) * (b.g - a.g)
    }
  }
  return 1
}

/**
 * ffmpeg の volume に渡す式にする。
 *
 * プレビューと同じ折れ線をそのまま式へ落とす（別々に作ると、聴いた音と
 * 書き出した音が違う、という一番たちの悪いズレになる）。
 */
export function envToFfmpegExpr(env: readonly GainPoint[]): string {
  if (env.length < 2) return '1'
  const f = (n: number): string => n.toFixed(4)
  // 後ろから包む: if(lt(t,t1), 区間1の式, if(lt(t,t2), 区間2の式, ...))
  let expr = f(env[env.length - 1].g)
  for (let i = env.length - 1; i >= 1; i--) {
    const a = env[i - 1]
    const b = env[i]
    const span = b.t - a.t
    const seg =
      span <= 1e-9
        ? f(b.g)
        : `(${f(a.g)}+(t-${f(a.t)})*${f((b.g - a.g) / span)})`
    expr = `if(lt(t,${f(b.t)}),${seg},${expr})`
  }
  return `if(lt(t,${f(env[0].t)}),${f(env[0].g)},${expr})`
}
