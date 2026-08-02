import { useEffect, useRef, useState } from 'react'
import type { FillGradient } from '../lib/telopStyle'
import { clamp } from '../../../shared/timeline'

// ===== 色変換 =====
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = (hex || '#000000').replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16) || 0
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')
}
function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255
  g /= 255
  b /= 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  let h = 0
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: mx ? d / mx : 0, v: mx }
}
function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}
function alphaAt(ops: { opacity: number; pos: number }[], pos: number): number {
  if (!ops.length) return 1
  const s = [...ops].sort((a, b) => a.pos - b.pos)
  if (pos <= s[0].pos) return s[0].opacity / 100
  if (pos >= s[s.length - 1].pos) return s[s.length - 1].opacity / 100
  for (let i = 0; i < s.length - 1; i++) {
    if (pos >= s[i].pos && pos <= s[i + 1].pos) {
      const t = (pos - s[i].pos) / (s[i + 1].pos - s[i].pos || 1)
      return (s[i].opacity + (s[i + 1].opacity - s[i].opacity) * t) / 100
    }
  }
  return 1
}

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

function SVSquare({
  hue,
  s,
  v,
  onChange
}: {
  hue: number
  s: number
  v: number
  onChange: (s: number, v: number) => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const start = (e: React.PointerEvent): void => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const move = (ev: PointerEvent): void => {
      onChange(
        clamp((ev.clientX - rect.left) / rect.width, 0, 1),
        1 - clamp((ev.clientY - rect.top) / rect.height, 0, 1)
      )
    }
    move(e.nativeEvent)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up) // 中断時も必ず解除（残すとマウス移動で値が動き続ける）
  }
  const hueRgb = hsvToRgb(hue, 1, 1)
  return (
    <div
      ref={ref}
      onPointerDown={start}
      style={{
        position: 'relative',
        width: '100%',
        height: 120,
        borderRadius: 4,
        cursor: 'crosshair',
        background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${rgbToHex(
          hueRgb.r,
          hueRgb.g,
          hueRgb.b
        )})`
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: `${s * 100}%`,
          top: `${(1 - v) * 100}%`,
          width: 12,
          height: 12,
          transform: 'translate(-50%,-50%)',
          borderRadius: '50%',
          border: '2px solid #fff',
          boxShadow: '0 0 0 1px #0008',
          pointerEvents: 'none'
        }}
      />
    </div>
  )
}

// SB四角＋縦色相バー＋プレビュー＋RGB/HSB/#（Premiereレイアウト準拠）。色編集の共通部品。
function ColorArea({ color, onChange }: { color: string; onChange: (hex: string) => void }): JSX.Element {
  const rgb = hexToRgb(color)
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
  const [hue, setHue] = useState(hsv.h)
  useEffect(() => {
    if (hsv.s > 0.01 && hsv.v > 0.01) setHue(hsv.h)
  }, [color]) // eslint-disable-line react-hooks/exhaustive-deps
  const setHSV = (h: number, s: number, v: number): void => {
    const c = hsvToRgb(h, s, v)
    onChange(rgbToHex(c.r, c.g, c.b))
  }
  const hueRef = useRef<HTMLDivElement>(null)
  const startHue = (e: React.PointerEvent): void => {
    const el = hueRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const move = (ev: PointerEvent): void => {
      const h = clamp((ev.clientY - rect.top) / rect.height, 0, 1) * 360
      setHue(h)
      setHSV(h, hsv.s || 1, hsv.v || 1)
    }
    move(e.nativeEvent)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up) // 中断時も必ず解除（残すとマウス移動で値が動き続ける）
  }
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <div style={{ flex: 1 }}>
          <SVSquare hue={hue} s={hsv.s} v={hsv.v} onChange={(s, v) => setHSV(hue, s, v)} />
        </div>
        <div
          ref={hueRef}
          onPointerDown={startHue}
          style={{
            width: 16,
            height: 120,
            borderRadius: 3,
            position: 'relative',
            cursor: 'pointer',
            background: 'linear-gradient(to bottom,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)'
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: -2,
              right: -2,
              top: `${(hue / 360) * 100}%`,
              height: 3,
              transform: 'translateY(-50%)',
              background: '#fff',
              border: '1px solid #0008',
              pointerEvents: 'none'
            }}
          />
        </div>
        <div style={{ width: 34, height: 120, borderRadius: 4, background: color, border: '1px solid #fff5' }} />
      </div>
      <div className="sp-row" style={{ marginTop: 8, gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
          <label style={rowLbl}><span>R</span><input type="number" className="sp-num" min={0} max={255} value={Math.round(rgb.r)} onChange={(e) => onChange(rgbToHex(Number(e.target.value), rgb.g, rgb.b))} /></label>
          <label style={rowLbl}><span>G</span><input type="number" className="sp-num" min={0} max={255} value={Math.round(rgb.g)} onChange={(e) => onChange(rgbToHex(rgb.r, Number(e.target.value), rgb.b))} /></label>
          <label style={rowLbl}><span>B</span><input type="number" className="sp-num" min={0} max={255} value={Math.round(rgb.b)} onChange={(e) => onChange(rgbToHex(rgb.r, rgb.g, Number(e.target.value)))} /></label>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
          <label style={rowLbl}><span>H</span><input type="number" className="sp-num" min={0} max={360} value={Math.round(hue)} onChange={(e) => { const h = Number(e.target.value); setHue(h); setHSV(h, hsv.s, hsv.v) }} /></label>
          <label style={rowLbl}><span>S</span><input type="number" className="sp-num" min={0} max={100} value={Math.round(hsv.s * 100)} onChange={(e) => setHSV(hue, clamp(Number(e.target.value) / 100, 0, 1), hsv.v)} /></label>
          <label style={rowLbl}><span>B</span><input type="number" className="sp-num" min={0} max={100} value={Math.round(hsv.v * 100)} onChange={(e) => setHSV(hue, hsv.s, clamp(Number(e.target.value) / 100, 0, 1))} /></label>
        </div>
      </div>
      <div className="sp-row" style={{ marginTop: 6, gap: 6 }}>
        <span className="sp-label">#</span>
        <input
          className="sp-num"
          style={{ width: 90 }}
          value={color.replace('#', '').toUpperCase()}
          onChange={(e) => {
            const h = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
            if (h.length === 6) onChange('#' + h)
          }}
        />
        <div style={{ width: 28, height: 20, borderRadius: 3, background: color, border: '1px solid #fff5' }} />
      </div>
    </>
  )
}

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

  // フローティング窓の位置
  const [posXY, setPosXY] = useState({ x: Math.max(20, window.innerWidth - 300), y: 90 })
  const startDrag = (e: React.PointerEvent): void => {
    const ox = e.clientX - posXY.x
    const oy = e.clientY - posXY.y
    const move = (ev: PointerEvent): void =>
      setPosXY({
        x: clamp(ev.clientX - ox, 0, window.innerWidth - 120),
        y: clamp(ev.clientY - oy, 0, window.innerHeight - 40)
      })
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up) // 中断時も必ず解除（残すとマウス移動で値が動き続ける）
  }

  return (
    <div className="fill-picker" style={{ ...pickerBox, left: posXY.x, top: posXY.y }}>
      <div
        onPointerDown={startDrag}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          margin: '-10px -10px 8px',
          padding: '5px 8px',
          background: '#2b2b2e',
          borderRadius: '8px 8px 0 0',
          cursor: 'move',
          userSelect: 'none',
          fontSize: 12
        }}
      >
        <span>カラーピッカー</span>
        <button className="btn small" onPointerDown={(e) => e.stopPropagation()} onClick={onClose} title="閉じる">
          ✕
        </button>
      </div>

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
    </div>
  )
}

// ===== 単色用ピッカー（縁・影・背景など） =====
function ColorPopup({
  color,
  onChange,
  onClose
}: {
  color: string
  onChange: (hex: string) => void
  onClose: () => void
}): JSX.Element {
  const [posXY, setPosXY] = useState({ x: Math.max(20, window.innerWidth - 300), y: 120 })
  const startDrag = (e: React.PointerEvent): void => {
    const ox = e.clientX - posXY.x
    const oy = e.clientY - posXY.y
    const move = (ev: PointerEvent): void =>
      setPosXY({
        x: clamp(ev.clientX - ox, 0, window.innerWidth - 120),
        y: clamp(ev.clientY - oy, 0, window.innerHeight - 40)
      })
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up) // 中断時も必ず解除（残すとマウス移動で値が動き続ける）
  }
  return (
    <div className="fill-picker" style={{ ...pickerBox, left: posXY.x, top: posXY.y }}>
      <div
        onPointerDown={startDrag}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          margin: '-10px -10px 8px',
          padding: '5px 8px',
          background: '#2b2b2e',
          borderRadius: '8px 8px 0 0',
          cursor: 'move',
          userSelect: 'none',
          fontSize: 12
        }}
      >
        <span>カラーピッカー</span>
        <button className="btn small" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
          ✕
        </button>
      </div>
      <ColorArea color={color} onChange={onChange} />
    </div>
  )
}

export function ColorField({
  color,
  onChange,
  title
}: {
  color: string
  onChange: (hex: string) => void
  title?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        className="sp-color"
        title={title ?? 'クリックでカラーピッカー'}
        onClick={() => setOpen((v) => !v)}
        style={{ background: color, border: '1px solid #ffffff55', cursor: 'pointer', padding: 0 }}
      />
      {open && <ColorPopup color={color} onChange={onChange} onClose={() => setOpen(false)} />}
    </>
  )
}

const pickerBox: React.CSSProperties = {
  position: 'fixed',
  zIndex: 9999,
  background: '#1c1c1e',
  border: '1px solid #ffffff22',
  borderRadius: 8,
  padding: 10,
  width: 260,
  boxShadow: '0 8px 24px #000a'
}
const rowLbl: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }
