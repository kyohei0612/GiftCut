// 画像の背景を透過する窓。**素材ビンの画像ごと**に開く（ProjectBinTab の「✂ 透過」）。
//
// 左に絵（市松の上に透過済みの見た目）、右に設定。設定を触ると絵がその場で変わる。
//
// ## 見せる絵は縮めて計算する
//
// 大きい写真（4000×3000）を設定のたびに全画素で整えると、つまみを動かすたびに
// 1秒近く止まる。見せる絵は長辺 1024 までに縮めた物で計算し、**適用のときだけ
// 元の大きさで作る**（state/useCutout の render）。縮めた分、ペンの座標と
// 境界の px は同じ比率で縮める（`scaledSettings`）。
//
// ## 中身
//
// - `CutoutDialog`     … 窓そのもの
// - `scaledSettings`   … 設定を見せる絵の比率に合わせる
// - `fitScale`         … 絵を枠に収める比率

import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useEscClose } from '../../lib/useEscClose'
import { useCutoutCtx } from '../../state/cutoutContext'
import type { MediaItem } from '../panels/ProjectBinTab'
import { DEFAULT_CUTOUT, type CutoutSettings, type CutoutStroke } from '../../lib/cutout/types'
import { alphaForSettings, resizeAlpha, resizeRgba, type RgbaImage } from '../../lib/cutout/render'
import { composeAlpha, type Alpha } from '../../lib/cutout/mask'

const PREVIEW_MAX = 1024

export function scaledSettings(s: CutoutSettings, k: number): CutoutSettings {
  if (k === 1) return s
  return {
    ...s,
    feather: s.feather * k,
    shift: s.shift * k,
    smooth: s.smooth * k,
    strokes: s.strokes.map((st) => ({
      ...st,
      size: st.size * k,
      pts: st.pts.map(([x, y]) => [x * k, y * k] as [number, number])
    }))
  }
}

export const fitScale = (w: number, h: number, boxW: number, boxH: number): number =>
  Math.min(1, boxW / w, boxH / h)

type Tool = 'none' | 'keep' | 'drop' | 'pick'

export function CutoutDialog({ item, onClose }: { item: MediaItem; onClose: () => void }): JSX.Element {
  const { loadSource, computeMatte, render, saveSettings, modelState } = useCutoutCtx()
  const [settings, setSettings] = useState<CutoutSettings>(item.cutout ?? { ...DEFAULT_CUTOUT, enabled: false })
  const [src, setSrc] = useState<RgbaImage | null>(null)
  const [matte, setMatte] = useState<Alpha | null>(null)
  const [modelReady, setModelReady] = useState<boolean | null>(null)
  const [modelSizeMB, setModelSizeMB] = useState(0)
  const [tool, setTool] = useState<Tool>('none')
  const [brush, setBrush] = useState(24)
  const [smart, setSmart] = useState(true)
  const [applying, setApplying] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const drawing = useRef<CutoutStroke | null>(null)
  const busy = applying || modelState.phase === 'download' || modelState.phase === 'load' || modelState.phase === 'run'
  useEscClose(onClose, !busy)

  // 元画像と、模型の有無
  useEffect(() => {
    let alive = true
    loadSource(item.path)
      .then((s) => alive && setSrc(s))
      .catch((e) => alive && setErr(String(e)))
    void window.giftcut.cutoutStatus().then((st) => {
      if (!alive) return
      setModelReady(st.model)
      setModelSizeMB(st.sizeMB)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  // 見せる絵（縮めた物）
  const preview = useMemo(() => {
    if (!src) return null
    const k = Math.min(1, PREVIEW_MAX / Math.max(src.w, src.h))
    const pw = Math.max(1, Math.round(src.w * k))
    const ph = Math.max(1, Math.round(src.h * k))
    return { k, img: { rgba: k === 1 ? src.rgba : resizeRgba(src, pw, ph), w: pw, h: ph } }
  }, [src])
  const previewMatte = useMemo(
    () => (matte && src && preview ? resizeAlpha(matte, src.w, src.h, preview.img.w, preview.img.h) : null),
    [matte, src, preview]
  )

  /** 自動で背景を当てる（模型。無ければ落とす） */
  const runAuto = async (): Promise<void> => {
    if (!src) return
    const m = await computeMatte(item.path, src)
    if (m) {
      setMatte(m)
      setModelReady(true)
    }
  }
  // 自動の抜き方で、模型が手元にあれば開いた時点で当てる（落とすのは押してもらう）
  useEffect(() => {
    if (settings.enabled && settings.method === 'auto' && modelReady && src && !matte) void runAuto()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.enabled, settings.method, modelReady, src])

  // 絵を描く（設定が変わるたび。縮めた絵なので速い）
  useEffect(() => {
    const c = canvasRef.current
    if (!c || !preview) return
    const { img, k } = preview
    c.width = img.w
    c.height = img.h
    const ctx = c.getContext('2d')
    if (!ctx) return
    const rgba = settings.enabled
      ? composeAlpha(img.rgba, alphaForSettings(img, previewMatte, scaledSettings(settings, k)))
      : img.rgba
    ctx.putImageData(new ImageData(rgba as unknown as Uint8ClampedArray<ArrayBuffer>, img.w, img.h), 0, 0)
    // ペンの線を薄く重ねる（どこを塗ったか分かるように）
    for (const st of settings.strokes) {
      ctx.strokeStyle = st.mode === 'keep' ? 'rgba(80,220,120,0.45)' : 'rgba(255,80,80,0.45)'
      ctx.lineWidth = st.size * k
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      st.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)))
      if (st.pts.length === 1) ctx.lineTo(st.pts[0][0] * k + 0.01, st.pts[0][1] * k)
      ctx.stroke()
    }
  }, [preview, previewMatte, settings])

  /** 画面の座標 → 元画像の px */
  const toImage = (e: React.PointerEvent): [number, number] | null => {
    const c = canvasRef.current
    if (!c || !src) return null
    const r = c.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * src.w, ((e.clientY - r.top) / r.height) * src.h]
  }
  const onDown = (e: React.PointerEvent): void => {
    if (e.button !== 0 || !src || !settings.enabled) return
    const p = toImage(e)
    if (!p) return
    if (tool === 'pick') {
      const i = (Math.min(src.h - 1, Math.max(0, Math.round(p[1]))) * src.w + Math.min(src.w - 1, Math.max(0, Math.round(p[0])))) * 4
      setSettings((s) => ({ ...s, method: 'color', key: { r: src.rgba[i], g: src.rgba[i + 1], b: src.rgba[i + 2], tol: s.key?.tol ?? 30 } }))
      return
    }
    if (tool === 'none') return
    drawing.current = { mode: tool, size: brush, smart, pts: [p] }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setSettings((s) => ({ ...s, strokes: [...s.strokes, drawing.current!] }))
  }
  const onMove = (e: React.PointerEvent): void => {
    const d = drawing.current
    if (!d) return
    const p = toImage(e)
    if (!p) return
    const next = { ...d, pts: [...d.pts, p] }
    drawing.current = next
    setSettings((s) => ({ ...s, strokes: [...s.strokes.slice(0, -1), next] }))
  }
  const onUp = (): void => {
    drawing.current = null
  }

  const apply = async (): Promise<void> => {
    if (!settings.enabled) {
      saveSettings(item.id, settings, null)
      onClose()
      return
    }
    if (!src) return
    setApplying(true)
    setErr(null)
    try {
      const p = await render(item.path, settings, src, matte)
      if (p) {
        saveSettings(item.id, settings, p)
        onClose()
      }
    } catch (e) {
      setErr(String(e))
    } finally {
      setApplying(false)
    }
  }
  const set = <K extends keyof CutoutSettings>(k: K, v: CutoutSettings[K]): void =>
    setSettings((s) => ({ ...s, [k]: v }))
  const phaseLabel = (): string => {
    switch (modelState.phase) {
      case 'download':
        return `自動切り抜きの準備を落としています… ${modelState.percent}%`
      case 'load':
        return '模型を読み込んでいます…'
      case 'run':
        return '背景を当てています…'
      case 'error':
        return modelState.message
      default:
        return ''
    }
  }

  return (
    <div className="export-overlay">
      <div className="restore-box cutout-box">
        <div className="restore-title">背景を透過する — {item.name}</div>
        <div className="cutout-body">
          <div className="cutout-stage" ref={boxRef}>
            {src && preview ? (
              <canvas
                ref={canvasRef}
                className={`cutout-canvas tool-${tool}`}
                style={{ width: '100%', aspectRatio: `${src.w} / ${src.h}` }}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
              />
            ) : (
              <div className="tpl-hint">{err ?? '画像を読んでいます…'}</div>
            )}
          </div>
          <div className="cutout-side">
            <label className="mo-showall">
              <input
                type="checkbox"
                checked={settings.enabled}
                disabled={busy}
                onChange={(e) => set('enabled', e.target.checked)}
              />
              背景を透過する
            </label>
            {settings.enabled && (
              <>
                <div className="sp-row">
                  <span className="sp-label">抜き方</span>
                  <select
                    className="sp-num wide"
                    value={settings.method}
                    disabled={busy}
                    onChange={(e) => set('method', e.target.value as 'auto' | 'color')}
                  >
                    <option value="auto">自動（人物・物を残す）</option>
                    <option value="color">色で抜く（背景の色を拾う）</option>
                  </select>
                </div>
                {settings.method === 'auto' && modelReady === false && (
                  <div className="restore-warn">
                    初回だけ、自動切り抜きの準備（約{modelSizeMB}MB）を落とします。一度入れれば次からは要りません。
                    <div>
                      <button className="btn" disabled={busy} onClick={() => void runAuto()}>
                        落として始める
                      </button>
                    </div>
                  </div>
                )}
                {settings.method === 'auto' && modelReady && !matte && !busy && (
                  <button className="reframe-btn" onClick={() => void runAuto()}>
                    自動で背景を当てる
                  </button>
                )}
                {settings.method === 'color' && (
                  <>
                    <div className="sp-row">
                      <button
                        className={`reframe-btn${tool === 'pick' ? ' on' : ''}`}
                        onClick={() => setTool(tool === 'pick' ? 'none' : 'pick')}
                        title="絵の上で背景の色をクリック"
                      >
                        🎯 背景の色を拾う
                      </button>
                      {settings.key && (
                        <span
                          className="cutout-swatch"
                          style={{ background: `rgb(${settings.key.r},${settings.key.g},${settings.key.b})` }}
                        />
                      )}
                    </div>
                    <div className="sp-row">
                      <span className="sp-label">近い色まで</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={settings.key?.tol ?? 30}
                        disabled={!settings.key}
                        onChange={(e) => set('key', { ...(settings.key ?? { r: 0, g: 0, b: 0 }), tol: Number(e.target.value) })}
                      />
                    </div>
                  </>
                )}
                <div className="sp-row">
                  <span className="sp-label">どこまで透過</span>
                  <input type="range" min={0} max={100} value={settings.threshold} onChange={(e) => set('threshold', Number(e.target.value))} />
                  <span className="sp-val">{settings.threshold}</span>
                </div>
                <div className="cutout-head">ペンで直す</div>
                <div className="sp-row cutout-tools">
                  <button className={`reframe-btn${tool === 'keep' ? ' on' : ''}`} onClick={() => setTool(tool === 'keep' ? 'none' : 'keep')}>🟢 残す</button>
                  <button className={`reframe-btn${tool === 'drop' ? ' on' : ''}`} onClick={() => setTool(tool === 'drop' ? 'none' : 'drop')}>🔴 消す</button>
                  <button className="reframe-btn" disabled={!settings.strokes.length} onClick={() => set('strokes', settings.strokes.slice(0, -1))}>↶ 1つ戻す</button>
                  <button className="reframe-btn" disabled={!settings.strokes.length} onClick={() => set('strokes', [])}>全部消す</button>
                </div>
                <div className="sp-row">
                  <span className="sp-label">太さ</span>
                  <input type="range" min={4} max={200} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
                  <span className="sp-val">{brush}px</span>
                </div>
                <label className="mo-showall">
                  <input type="checkbox" checked={smart} onChange={(e) => setSmart(e.target.checked)} />
                  かしこく塗る（似た色の範囲ごと。雑に引いても境界を読む）
                </label>
                <div className="cutout-head">境界</div>
                <div className="sp-row">
                  <span className="sp-label">ぼかし</span>
                  <input type="range" min={0} max={30} value={settings.feather} onChange={(e) => set('feather', Number(e.target.value))} />
                  <span className="sp-val">{settings.feather}px</span>
                </div>
                <div className="sp-row">
                  <span className="sp-label">縮める／広げる</span>
                  <input type="range" min={-20} max={20} value={settings.shift} onChange={(e) => set('shift', Number(e.target.value))} />
                  <span className="sp-val">{settings.shift}px</span>
                </div>
                <div className="sp-row">
                  <span className="sp-label">なめらか</span>
                  <input type="range" min={0} max={20} value={settings.smooth} onChange={(e) => set('smooth', Number(e.target.value))} />
                  <span className="sp-val">{settings.smooth}px</span>
                </div>
              </>
            )}
            {(busy || modelState.phase === 'error') && (
              <div className={modelState.phase === 'error' ? 'restore-warn' : 'tpl-hint'} style={{ marginTop: 8 }}>
                {applying ? '透過した画像を作っています…' : phaseLabel()}
              </div>
            )}
            {err && <div className="restore-warn">{err}</div>}
            <div className="restore-btns" style={{ marginTop: 'auto' }}>
              <button className="btn" disabled={busy} onClick={onClose}>
                やめる
              </button>
              <button className="btn btn-primary" disabled={busy || (settings.enabled && !src)} onClick={() => void apply()}>
                適用
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
