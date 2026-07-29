// プロパティ欄でくり返し出てくる行。
//
// 色調整（明るさ・コントラスト・彩度）とクロップ（上下左右）と変形（回転・反転）は、
// 動画クリップ・映像レイヤー・画像の3か所で同じ形で出る。以前は3回書かれていて、
// 「画像だけ規則が違う」といった食い違いが起きやすかった。
//
// 特にクロップの **対辺の合計が95%を超えないよう押し戻す** 規則は、
// 3か所に同じ式が書いてあった。1か所にまとめてある（clampCrop）。

import type { JSX } from 'react'

export interface Adjust {
  b: number
  c: number
  s: number
}
export interface Crop {
  l: number
  r: number
  t: number
  b: number
}

export const ADJUST_ROWS = [
  { key: 'b', label: '明るさ' },
  { key: 'c', label: 'コントラスト' },
  { key: 's', label: '彩度' }
] as const

export const CROP_ROWS = [
  { key: 'l', label: '左' },
  { key: 'r', label: '右' },
  { key: 't', label: '上' },
  { key: 'b', label: '下' }
] as const

/**
 * 切り抜きすぎて何も残らないのを防ぐ。
 * 片側を動かして対辺との合計が 95% を超えたら、**相手側を押し戻す**
 * （今動かした方を戻すと、掴んでいるつまみが勝手に戻って操作できない）。
 */
export function clampCrop(next: Crop, moved: keyof Crop): Crop {
  const out = { ...next }
  if (out.l + out.r > 0.95) {
    if (moved === 'l') out.r = 0.95 - out.l
    else if (moved === 'r') out.l = 0.95 - out.r
  }
  if (out.t + out.b > 0.95) {
    if (moved === 't') out.b = 0.95 - out.t
    else if (moved === 'b') out.t = 0.95 - out.b
  }
  return out
}

/** ラベル＋つまみ＋今の値、の1行 */
export function SliderRow({
  label,
  min,
  max,
  step,
  value,
  onChange,
  format
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
  format: (v: number) => string
}): JSX.Element {
  return (
    <div className="sp-row">
      <span className="sp-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="sp-val">{format(value)}</span>
    </div>
  )
}

/** 0〜200% の割合を出す行（音量・不透明度・拡大） */
export function PercentRow({
  label,
  value,
  onChange,
  min = 0,
  max = 200,
  step = 1
}: {
  label: string
  /** 1 = 100% */
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}): JSX.Element {
  return (
    <SliderRow
      label={label}
      min={min}
      max={max}
      step={step}
      value={Math.round(value * 100)}
      onChange={(v) => onChange(v / 100)}
      format={(v) => `${Math.round(v)}%`}
    />
  )
}

/** 秒を出す行（フェード・長さ） */
export function SecondsRow({
  label,
  value,
  max,
  onChange,
  min = 0,
  step = 0.05
}: {
  label: string
  value: number
  max: number
  onChange: (v: number) => void
  min?: number
  step?: number
}): JSX.Element {
  return (
    <SliderRow
      label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={onChange}
      format={(v) => `${v.toFixed(2)}s`}
    />
  )
}

export function AdjustRows({
  value,
  onChange
}: {
  value: Adjust
  onChange: (next: Adjust) => void
}): JSX.Element {
  return (
    <>
      <label className="field-label" style={{ marginTop: 12 }}>
        色調整
      </label>
      {ADJUST_ROWS.map((r) => (
        <SliderRow
          key={r.key}
          label={r.label}
          min={0}
          max={2}
          step={0.02}
          value={value[r.key]}
          onChange={(v) => onChange({ ...value, [r.key]: v })}
          format={(v) => v.toFixed(2)}
        />
      ))}
    </>
  )
}

export function CropRows({
  value,
  onChange
}: {
  value: Crop
  onChange: (next: Crop) => void
}): JSX.Element {
  return (
    <>
      <label className="field-label" style={{ marginTop: 12 }}>
        クロップ（切り抜き）
      </label>
      {CROP_ROWS.map((r) => (
        <SliderRow
          key={r.key}
          label={r.label}
          min={0}
          max={90}
          step={1}
          value={Math.round(value[r.key] * 100)}
          onChange={(v) => onChange(clampCrop({ ...value, [r.key]: v / 100 }, r.key))}
          format={(v) => `${Math.round(v)}%`}
        />
      ))}
    </>
  )
}

/** 回転（90°ずつ）と上下左右の反転 */
export function TransformRow({
  rotate,
  flipH,
  flipV,
  onRotate,
  onFlipH,
  onFlipV
}: {
  rotate?: number
  flipH?: boolean
  flipV?: boolean
  onRotate: () => void
  onFlipH: () => void
  onFlipV: () => void
}): JSX.Element {
  return (
    <>
      <label className="field-label" style={{ marginTop: 12 }}>
        変形
      </label>
      <div className="seg seg-wide">
        <button className="seg-btn" onClick={onRotate} title="90°回転">
          ↻ 回転{rotate ? `（${Math.round(rotate)}°）` : ''}
        </button>
        <button className={`seg-btn ${flipH ? 'seg-on' : ''}`} onClick={onFlipH} title="左右反転">
          ⇄ 左右
        </button>
        <button className={`seg-btn ${flipV ? 'seg-on' : ''}`} onClick={onFlipV} title="上下反転">
          ⇅ 上下
        </button>
      </div>
    </>
  )
}

/** 次の90°（0 に戻ったときは「無し」にする＝保存に余計な値を残さない） */
export function nextRotate(cur?: number): number | undefined {
  const next = (Math.round((cur ?? 0) / 90) * 90 + 90) % 360
  return next === 0 ? undefined : next
}
