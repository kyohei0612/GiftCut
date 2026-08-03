import { useRef, useState } from 'react'
import type { FillGradient } from '../lib/telopStyle'
import { clamp } from '../../../shared/timeline'
import { alphaAt, hexToRgb } from '../../../shared/color'
import { ColorArea, FloatingPicker } from './ColorArea'

// ※ 色の算数（hexToRgb / rgbToHex / rgbToHsv / hsvToRgb / alphaAt）は
//    shared/color へ出した。**lib/telopSvg にも同じ計算があった**ので、
//    書き出しと画面で色がズレないよう1本に寄せた（2026-08-03）。

type Fill = { enabled: boolean; color: string; gradient?: FillGradient; gradStash?: FillGradient }
type Mode = 'solid' | 'linear' | 'radial'
type Sel = { kind: 'color' | 'opacity'; i: number }

// ドラッグで位置(0-1)を返す共通ハンドラ
function dragRatio(barEl: HTMLElement | null, onMove: (ratio: number) => void): void {
  if (!barEl) return
  const rect = barEl.getBoundingClientRect()
  const move = (ev: PointerEvent): void => onMove(clamp((ev.clientX - rect.left) / rect.width, 0, 1))
  const up = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

// ※ 色を1つ選ぶ部品（SVSquare / ColorArea / ColorPopup / ColorField）は
//    components/ColorArea へ出した。このファイルは「グラデを編集する」1つになる。
//    dragRatio はグラデ側でしか使っていないので、こちらに残した

export function FillPicker({
  fill,
  onChange,
  onClose
}: {
  fill: Fill
  onChange: (f: Fill) => void
  onClose: () => void
}): JSX.Element {
  const mode: Mode = !fill.gradient ? 'solid' : (fill.gradient.type ?? 'linear') === 'radial' ? 'radial' : 'linear'
  const stops = fill.gradient?.stops ?? []
  // 不透明度ストップ: 未定義なら両端100%を暗黙表示（編集時にデータへ実体化）
  const opStops = fill.gradient?.opacityStops ?? [
    { opacity: 100, pos: 0 },
    { opacity: 100, pos: 1 }
  ]
  const [sel, setSel] = useState<Sel>({ kind: 'color', i: 0 })
  const barRef = useRef<HTMLDivElement>(null)

  const curColor = mode === 'solid' ? fill.color : stops[sel.kind === 'color' ? sel.i : 0]?.color ?? '#ffffff'

  const setMode = (m: Mode): void => {
    if (m === 'solid') {
      onChange({ ...fill, gradient: undefined, gradStash: fill.gradient ?? fill.gradStash })
    } else {
      const base = fill.gradient ??
        fill.gradStash ?? {
          angle: 90,
          stops: [
            { color: fill.color, pos: 0 },
            { color: '#ffffff', pos: 1 }
          ]
        }
      onChange({ ...fill, gradient: { ...base, type: m }, gradStash: undefined })
    }
  }
  const setGrad = (patch: Partial<FillGradient>): void => {
    if (fill.gradient) onChange({ ...fill, gradient: { ...fill.gradient, ...patch } })
  }
  const setStop = (i: number, patch: Partial<{ color: string; pos: number; mid: number }>): void =>
    setGrad({ stops: stops.map((s, k) => (k === i ? { ...s, ...patch } : s)) })
  const setOp = (i: number, patch: Partial<{ opacity: number; pos: number }>): void =>
    setGrad({ opacityStops: opStops.map((s, k) => (k === i ? { ...s, ...patch } : s)) })

  const applyColor = (hex: string): void => {
    if (mode === 'solid') onChange({ ...fill, color: hex })
    else if (fill.gradient && sel.kind === 'color') setStop(sel.i, { color: hex })
  }

  const addColorStop = (ratio: number): void => {
    if (!fill.gradient) return
    const ns = [...stops, { color: curColor, pos: ratio }].sort((a, b) => a.pos - b.pos)
    setGrad({ stops: ns })
    setSel({ kind: 'color', i: ns.findIndex((s) => s.pos === ratio) })
  }
  const addOpStop = (ratio: number): void => {
    if (!fill.gradient) return
    const ns = [...opStops, { opacity: Math.round(alphaAt(opStops, ratio) * 100), pos: ratio }].sort(
      (a, b) => a.pos - b.pos
    )
    setGrad({ opacityStops: ns })
    setSel({ kind: 'opacity', i: ns.findIndex((s) => s.pos === ratio) })
  }

  // バー背景: 色×不透明度を rgba で反映（市松の上に重ねる）
  const gradCss = (): string => {
    const ss = [...stops].sort((a, b) => a.pos - b.pos)
    const parts = ss.map((s) => {
      const c = hexToRgb(s.color)
      return `rgba(${c.r},${c.g},${c.b},${alphaAt(opStops, s.pos).toFixed(3)}) ${Math.round(s.pos * 100)}%`
    })
    return `linear-gradient(to right, ${parts.join(', ')})`
  }

  const selPos =
    sel.kind === 'color' ? stops[sel.i]?.pos ?? 0 : opStops[sel.i]?.pos ?? 0
  const colOrder = stops.map((_, i) => i).sort((a, b) => stops[a].pos - stops[b].pos)

  // 窓の枠（掴んで動かせる見出し）は components/ColorArea の FloatingPicker。
  // **同じ25行が単色用にもう1つ書かれていた**（割ったら検査が拾った）
  return (
    <FloatingPicker initialY={90} onClose={onClose}>

      <div style={{ marginBottom: 8 }}>
        <select className="sp-select" value={mode} onChange={(e) => setMode(e.target.value as Mode)} style={{ width: '100%' }}>
          <option value="solid">単色ベタ塗り</option>
          <option value="linear">線形グラデーション</option>
          <option value="radial">円形グラデーション</option>
        </select>
      </div>

      {mode !== 'solid' && fill.gradient && (
        <div style={{ marginBottom: 10 }}>
          {/* グラデバー: 上半分クリック=不透明度ストップ / 下半分=色ストップ */}
          <div
            ref={barRef}
            onPointerDown={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1)
              if (e.clientY - rect.top < rect.height / 2) addOpStop(ratio)
              else addColorStop(ratio)
            }}
            style={{
              position: 'relative',
              height: 30,
              margin: '10px 0',
              borderRadius: 4,
              border: '1px solid #ffffff33',
              background: `${gradCss()}, repeating-conic-gradient(#888 0% 25%, #bbb 0% 50%) 0/12px 12px`,
              cursor: 'copy'
            }}
          >
            {/* 不透明度ストップ（上・□） */}
            {opStops.map((o, i) => (
              <div
                key={'o' + i}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  setSel({ kind: 'opacity', i })
                  dragRatio(barRef.current, (r) => setOp(i, { pos: r }))
                }}
                title={`不透明度 ${o.opacity}% / ${Math.round(o.pos * 100)}%`}
                style={{
                  position: 'absolute',
                  left: `${o.pos * 100}%`,
                  top: -7,
                  width: 11,
                  height: 11,
                  transform: 'translateX(-50%)',
                  background: `rgba(0,0,0,${(o.opacity / 100).toFixed(2)})`,
                  border: `2px solid ${sel.kind === 'opacity' && sel.i === i ? '#4af' : '#fff'}`,
                  cursor: 'ew-resize'
                }}
              />
            ))}
            {/* 色ストップ（下・◇） */}
            {stops.map((s, i) => (
              <div
                key={'c' + i}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  setSel({ kind: 'color', i })
                  dragRatio(barRef.current, (r) => setStop(i, { pos: r }))
                }}
                title={`${s.color} / ${Math.round(s.pos * 100)}%`}
                style={{
                  position: 'absolute',
                  left: `${s.pos * 100}%`,
                  bottom: -7,
                  width: 12,
                  height: 12,
                  transform: 'translateX(-50%) rotate(45deg)',
                  background: s.color,
                  border: `2px solid ${sel.kind === 'color' && sel.i === i ? '#4af' : '#fff'}`,
                  cursor: 'ew-resize'
                }}
              />
            ))}
            {/* カラー中間点（選択色ストップ基準） */}
            {sel.kind === 'color' &&
              (() => {
                const p = colOrder.indexOf(sel.i)
                const nextI = colOrder[p + 1]
                if (nextI == null) return null
                const a = stops[sel.i]
                const b = stops[nextI]
                const mid = a.mid ?? 0.5
                const x = a.pos + mid * (b.pos - a.pos)
                return (
                  <div
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      dragRatio(barRef.current, (r) =>
                        setStop(sel.i, { mid: clamp((r - a.pos) / (b.pos - a.pos || 1), 0.05, 0.95) })
                      )
                    }}
                    title="カラー中間点"
                    style={{
                      position: 'absolute',
                      left: `${x * 100}%`,
                      bottom: -5,
                      width: 8,
                      height: 8,
                      transform: 'translateX(-50%) rotate(45deg)',
                      background: '#ffd54a',
                      border: '1px solid #7a5',
                      cursor: 'ew-resize'
                    }}
                  />
                )
              })()}
          </div>

          <div className="sp-row" style={{ gap: 6 }}>
            {sel.kind === 'opacity' && (
              <>
                <span className="sp-label">不透明度</span>
                <input
                  type="number"
                  className="sp-num"
                  min={0}
                  max={100}
                  value={Math.round(opStops[sel.i]?.opacity ?? 100)}
                  onChange={(e) => setOp(sel.i, { opacity: clamp(Number(e.target.value), 0, 100) })}
                />
                <span className="sp-val">%</span>
              </>
            )}
            <span className="sp-label">場所</span>
            <input
              type="number"
              className="sp-num"
              min={0}
              max={100}
              value={Math.round(selPos * 100)}
              onChange={(e) => {
                const p = clamp(Number(e.target.value) / 100, 0, 1)
                if (sel.kind === 'color') setStop(sel.i, { pos: p })
                else setOp(sel.i, { pos: p })
              }}
            />
            <span className="sp-val">%</span>
            {mode === 'linear' && (
              <>
                <span className="sp-label">角度</span>
                <input
                  type="number"
                  className="sp-num"
                  value={fill.gradient.angle}
                  onChange={(e) => setGrad({ angle: Number(e.target.value) })}
                />
                <span className="sp-val">°</span>
              </>
            )}
            <button
              className="btn small"
              title="選択ストップを削除"
              onClick={() => {
                if (sel.kind === 'color' && stops.length > 2) {
                  setGrad({ stops: stops.filter((_, k) => k !== sel.i) })
                  setSel({ kind: 'color', i: 0 })
                } else if (sel.kind === 'opacity' && opStops.length > 2) {
                  setGrad({ opacityStops: opStops.filter((_, k) => k !== sel.i) })
                  setSel({ kind: 'color', i: 0 })
                }
              }}
            >
              削除
            </button>
          </div>
        </div>
      )}

      {/* 不透明度ストップ選択時は不透明度スライダー、それ以外は色ピッカー */}
      {sel.kind === 'opacity' && mode !== 'solid' ? (
        <div style={{ padding: '10px 0' }}>
          <div className="sp-row">
            <span className="sp-label">不透明度</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(opStops[sel.i]?.opacity ?? 100)}
              onChange={(e) => setOp(sel.i, { opacity: Number(e.target.value) })}
              style={{ flex: 1 }}
            />
            <span className="sp-val">{Math.round(opStops[sel.i]?.opacity ?? 100)}%</span>
          </div>
        </div>
      ) : (
        <ColorArea color={curColor} onChange={applyColor} />
      )}
    </FloatingPicker>
  )
}
