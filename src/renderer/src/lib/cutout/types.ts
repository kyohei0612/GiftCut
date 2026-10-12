// 画像の背景を透過する（切り抜き）ときの、設定の形。
//
// ## 何を保存するか
//
// 保存するのは**設定だけ**（模型の結果や出来上がった PNG ではない）。
// 出来上がりは `userData` に置く派生物で、無ければ設定から作り直せる。
// 元画像が外から書き換えられても、同じ設定で作り直せば追従する
// （素材は参照のまま、という 2026-10-11 の決まりと同じ考え）。
//
// ## 2つの抜き方
//
//   auto   … 模型（ISNet）が前景を当てる。Canva の「背景を削除」に当たる
//   color  … 拾った背景色に近い所を抜く。模型が無くても動く・単純な絵に強い
//
// どちらも「どこまで透過するか」（threshold）と、ペンの指定（strokes）、
// 境界の整え（feather / shift / smooth）を同じ順で通す（`./mask` の runCutoutPipeline）。

/** ペンで塗った線。座標は**元画像の px**（画面の拡大率に寄らない） */
export interface CutoutStroke {
  /** keep＝残す / drop＝消す */
  mode: 'keep' | 'drop'
  /** 太さ（元画像 px） */
  size: number
  /** 似た色の範囲ごと塗る（雑に線を引いても境界を読む） */
  smart: boolean
  pts: [number, number][]
}

export interface CutoutSettings {
  /** 透過を使うか。既定は使わない（本人の指定） */
  enabled: boolean
  method: 'auto' | 'color'
  /** 色で抜くときの背景色と、どれだけ近い色まで抜くか（0..100） */
  key?: { r: number; g: number; b: number; tol: number }
  /** どこまで透過するか（0..100）。大きいほど「迷った所」も透過する */
  threshold: number
  /** 境界のぼかし（px） */
  feather: number
  /** 境界を縮める（負）／広げる（正）（px） */
  shift: number
  /** 境界のなめらかさ（px）。ギザギザと小さなゴミを消す */
  smooth: number
  strokes: CutoutStroke[]
}

export const DEFAULT_CUTOUT: CutoutSettings = {
  enabled: false,
  method: 'auto',
  threshold: 50,
  feather: 1,
  shift: 0,
  smooth: 0,
  strokes: []
}

/** 保存データから戻す。壊れていれば既定 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function loadCutoutSettings(raw: any): CutoutSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const strokes: CutoutStroke[] = Array.isArray(raw.strokes)
    ? raw.strokes
        .filter((s: any) => s && (s.mode === 'keep' || s.mode === 'drop') && Array.isArray(s.pts))
        .map((s: any) => ({
          mode: s.mode,
          size: num(s.size, 24),
          smart: !!s.smart,
          pts: s.pts
            .filter((p: any) => Array.isArray(p) && p.length === 2)
            .map((p: any) => [Number(p[0]), Number(p[1])] as [number, number])
        }))
    : []
  const key =
    raw.key && typeof raw.key === 'object'
      ? { r: num(raw.key.r, 0), g: num(raw.key.g, 0), b: num(raw.key.b, 0), tol: num(raw.key.tol, 30) }
      : undefined
  return {
    enabled: !!raw.enabled,
    method: raw.method === 'color' ? 'color' : 'auto',
    key,
    threshold: num(raw.threshold, DEFAULT_CUTOUT.threshold),
    feather: num(raw.feather, DEFAULT_CUTOUT.feather),
    shift: num(raw.shift, DEFAULT_CUTOUT.shift),
    smooth: num(raw.smooth, DEFAULT_CUTOUT.smooth),
    strokes
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
