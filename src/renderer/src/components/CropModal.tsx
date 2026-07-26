import { useEffect, useRef, useState } from 'react'

interface Props {
  src: string
  ringColor?: string
  onCancel: () => void
  onConfirm: (dataUrl: string) => void
}

const V = 280 // クロップ表示ビューポート（正方px）
const OUT = 256 // 出力サイズ

// 画像をドラッグ(位置)＋スライダー(拡大)で丸くクロップするモーダル
export default function CropModal({ src, ringColor = '#fff', onCancel, onConfirm }: Props): JSX.Element {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [ready, setReady] = useState(false)
  const [scale, setScale] = useState(1)
  const [minScale, setMinScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)

  useEffect(() => {
    const im = new Image()
    im.onload = (): void => {
      imgRef.current = im
      const ms = V / Math.min(im.width, im.height) // ビューポートを覆う最小倍率
      setMinScale(ms)
      setScale(ms)
      setTx((V - im.width * ms) / 2)
      setTy((V - im.height * ms) / 2)
      setReady(true)
    }
    im.src = src
  }, [src])

  function clampOffset(nx: number, ny: number, sc: number): { x: number; y: number } {
    const im = imgRef.current
    if (!im) return { x: nx, y: ny }
    const w = im.width * sc
    const h = im.height * sc
    return {
      x: Math.min(0, Math.max(V - w, nx)),
      y: Math.min(0, Math.max(V - h, ny))
    }
  }

  function onDown(e: React.PointerEvent): void {
    e.preventDefault()
    e.stopPropagation()
    // ポインタキャプチャで画面外に出てもドラッグが途切れないように
    const el = e.currentTarget as HTMLElement
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
    const sx = e.clientX
    const sy = e.clientY
    const ox = tx
    const oy = ty
    const move = (ev: PointerEvent): void => {
      const { x, y } = clampOffset(ox + (ev.clientX - sx), oy + (ev.clientY - sy), scale)
      setTx(x)
      setTy(y)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  function applyZoom(ns: number): void {
    const cx = V / 2
    const cy = V / 2
    const ix = (cx - tx) / scale
    const iy = (cy - ty) / scale
    const { x, y } = clampOffset(cx - ix * ns, cy - iy * ns, ns)
    setScale(ns)
    setTx(x)
    setTy(y)
  }

  function confirm(): void {
    const im = imgRef.current
    if (!im) return
    const canvas = document.createElement('canvas')
    canvas.width = OUT
    canvas.height = OUT
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // ビューポートに映っているソース範囲を出力へ描画
    ctx.drawImage(im, -tx / scale, -ty / scale, V / scale, V / scale, 0, 0, OUT, OUT)
    onConfirm(canvas.toDataURL('image/png'))
  }

  return (
    <div
      className="prefs-overlay"
      onPointerDown={(e) => {
        // 背景そのものを直接押し下げた時だけ閉じる（クロップのドラッグを画面外で離しても閉じない）
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="crop-box" onPointerDown={(e) => e.stopPropagation()}>
        <div className="prefs-head">
          <span>アイコンをクロップ</span>
          <button className="prefs-close" onClick={onCancel}>
            ✕
          </button>
        </div>
        <div className="crop-stage">
          <div className="crop-viewport" style={{ width: V, height: V }} onPointerDown={onDown}>
            {ready && imgRef.current && (
              <img
                src={src}
                draggable={false}
                alt=""
                style={{
                  position: 'absolute',
                  width: imgRef.current.width * scale,
                  left: tx,
                  top: ty,
                  userSelect: 'none',
                  pointerEvents: 'none'
                }}
              />
            )}
            <div
              className="crop-circle"
              style={{ boxShadow: `0 0 0 2px ${ringColor} inset, 0 0 0 4000px rgba(0,0,0,0.5)` }}
            />
          </div>
        </div>
        <div className="crop-controls">
          <span className="sp-label">ズーム</span>
          <input
            type="range"
            min={minScale}
            max={minScale * 5}
            step={0.001}
            value={scale}
            onChange={(e) => applyZoom(Number(e.target.value))}
          />
        </div>
        <div className="prefs-foot">
          <span className="prefs-hint">ドラッグで位置調整 / スライダーで拡大。丸の内側が切り抜かれます</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onCancel}>
              キャンセル
            </button>
            <button className="btn btn-primary" onClick={confirm}>
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
