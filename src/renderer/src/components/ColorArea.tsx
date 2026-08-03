// 色を1つ選ぶための部品——色相・彩度・明度の四角と、その浮かせ窓。
//
// ## なぜグラデの編集から出したか
//
// 元は `FillPicker.tsx` に同居していたが、**あのファイルには「何のファイルか」を
// 宣言する冒頭コメントが無く**、いきなり `// ===== 色変換 =====` から始まっていた。
// 実際には3つの話題（色の算数・色を1つ選ぶ・グラデを編集する）が入っていて、
// 中ほどのコメントが自分で「色編集の**共通部品**」と名乗っていた
// ＝別物だという自覚はあった形。
//
// 色の算数は shared/color へ、ここは「1つ選ぶ」を持つ。
// 残った FillPicker は「グラデを編集する」1つになる
// （2026-08-03。中身は1文字も変えていない。またぐ名前は 0 / 0）。
//
// ## 押している間は窓の外も追う
//
// 四角の中を掴んだまま外へ出ても色を追い続ける（掴み直しを強いない）。
// そのために pointerup を window で待つ。

import { useEffect, useRef, useState } from 'react'
import { clamp } from '../../../shared/timeline'
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from '../../../shared/color'

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
export function ColorArea({ color, onChange }: { color: string; onChange: (hex: string) => void }): JSX.Element {
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

/**
 * 浮かせた窓の枠——見出しを掴んで動かせる。
 *
 * **これは「割ったら出てきた」重複。** 元は同じ `FillPicker.tsx` の中に
 * まったく同じ25行が2つ（グラデ用と単色用）書かれていて、1ファイルの中に
 * 収まっていたせいで検査にも人目にも掛からなかった。
 * 分けた瞬間に `noDuplicate` が拾ったので、その場で1つにした（2026-08-03）。
 *
 * 掴んでいる間は窓の外もついていく。pointercancel でも必ず外す
 * （残すとマウスを動かすだけで窓が動き続ける）。
 */
export function FloatingPicker({
  initialY,
  onClose,
  children
}: {
  /** 開く高さ。グラデ用は少し上（下に中身が長いため） */
  initialY: number
  onClose: () => void
  children: React.ReactNode
}): JSX.Element {
  const [posXY, setPosXY] = useState({ x: Math.max(20, window.innerWidth - 300), y: initialY })
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
      {children}
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
  return (
    <FloatingPicker initialY={120} onClose={onClose}>
      <ColorArea color={color} onChange={onChange} />
    </FloatingPicker>
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

export const pickerBox: React.CSSProperties = {
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
