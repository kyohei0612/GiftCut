import { useState } from 'react'
import {
  FONT_OPTIONS,
  type StrokeLayer,
  type StrokePosition,
  type TelopStyle
} from '../lib/telopStyle'
import { FillPicker, ColorField } from './FillPicker'

export interface StylePreset {
  name: string
  style: TelopStyle
}
export interface IconLibItem {
  id: number
  name: string
  image: string
}

interface Props {
  style: TelopStyle
  onChange: (next: TelopStyle) => void
  presets: StylePreset[]
  onSavePreset: (name: string) => void
  onApplyPreset: (style: TelopStyle) => void
  label: string
  iconOn: boolean // コラボアイコン表示ON
  onToggleIcon: (on: boolean) => void
  currentIconImage?: string // 現在の実効アイコン画像（プレビュー用）
  onOpenIconSettings: () => void
  iconScale: number // アイコンサイズ倍率
  onIconScaleChange: (v: number) => void
  iconAuto: boolean // 自動調整（テロップ高さに追従・左固定）
  onIconAutoChange: (v: boolean) => void
  iconSide: 'left' | 'right' | 'top' | 'bottom'
  onIconSideChange: (s: 'left' | 'right' | 'top' | 'bottom') => void
  iconOffset: { x: number; y: number }
  onIconOffsetChange: (o: { x: number; y: number }) => void
  onAlign: (hx: 'l' | 'c' | 'r', vy: 't' | 'm' | 'b') => void // フレーム内の配置
  onBoxAnchor: (hx: 'l' | 'c' | 'r', vy: 't' | 'm' | 'b') => void // 固定ボックス内の寄せ
  onClearBox: () => void // 固定ボックス解除
}

export default function StylePanel({
  style,
  onChange,
  presets,
  onSavePreset,
  onApplyPreset,
  label,
  iconOn,
  onToggleIcon,
  currentIconImage,
  onOpenIconSettings,
  iconScale,
  onIconScaleChange,
  iconAuto,
  onIconAutoChange,
  iconSide,
  onIconSideChange,
  iconOffset,
  onIconOffsetChange,
  onAlign,
  onBoxAnchor,
  onClearBox
}: Props): JSX.Element {
  const [presetName, setPresetName] = useState('')
  const [fillPickerOpen, setFillPickerOpen] = useState(false)
  // セクション開閉（Premiere風に見出しクリックで畳める）。既定: スタイル/アイコンは閉じる
  const [closed, setClosed] = useState<Record<string, boolean>>({ style: true, icon: true })
  const toggle = (k: string): void => setClosed((p) => ({ ...p, [k]: !p[k] }))
  // sp-sec-{k}: CSS flex order で表示順を制御（整列→スタイル→テキスト→アピアランス→アイコン）
  const secCls = (k: string): string => `sp-section sp-sec-${k} ${closed[k] ? 'sec-closed' : ''}`
  const set = (patch: Partial<TelopStyle>): void => onChange({ ...style, ...patch })
  // フォントサイズ変更は縁・影・ベベル・箱もすべて同率でスケール＝相似形を保つ。
  // fontSizeだけ変えると小サイズで縁/影が相対的に肥大して文字が潰れるため。
  const setFontSize = (nf: number): void => {
    const k = nf / style.fontSize
    if (!isFinite(k) || k <= 0) return
    const r1 = (n: number): number => Math.round(n * 10) / 10
    const scSh = <T extends { distance: number; blur: number; spread?: number }>(sd: T): T => ({
      ...sd,
      distance: r1(sd.distance * k),
      blur: r1(sd.blur * k),
      ...(sd.spread != null ? { spread: r1(sd.spread * k) } : {})
    })
    set({
      fontSize: nf,
      strokes: style.strokes.map((st) => ({ ...st, width: r1(st.width * k) })),
      shadow: scSh(style.shadow),
      ...(style.shadows ? { shadows: style.shadows.map(scSh) } : {}),
      ...(style.bevel ? { bevel: { ...style.bevel, size: r1(style.bevel.size * k) } } : {}),
      ...(style.box
        ? { box: { w: Math.round(style.box.w * k), h: Math.round(style.box.h * k) } }
        : {})
    })
  }
  const setStroke = (i: number, patch: Partial<StrokeLayer>): void =>
    set({ strokes: style.strokes.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) })
  const addStroke = (): void =>
    set({
      strokes: [...style.strokes, { enabled: true, color: '#000000', width: 4, position: 'center' }]
    })
  const removeStroke = (i: number): void =>
    set({ strokes: style.strokes.filter((_, idx) => idx !== i) })

  return (
    <div className="sp">
      {/* ===== 整列と変形（Premiere: 最上段）===== */}
      <div className={secCls('align')}>
        <div className="sp-head sp-head-btn" onClick={() => toggle('align')}>
          {closed.align ? '▶' : '▼'} 整列と変形
        </div>
        <div className="sp-row">
          <span className="sp-label">位置</span>
          <div className="align-grid" title="フレーム内の配置（Excel風）">
            {(['t', 'm', 'b'] as const).map((vy) =>
              (['l', 'c', 'r'] as const).map((hx) => (
                <button
                  key={`${vy}${hx}`}
                  className="align-cell"
                  title="この位置へ揃える"
                  onClick={() => onAlign(hx, vy)}
                >
                  <span className={`align-dot align-${vy}${hx}`} />
                </button>
              ))
            )}
          </div>
          <span className="sp-label" style={{ marginLeft: 8 }}>
            枠内
          </span>
          <div className="align-grid" title="固定ボックスの中でテキストを寄せる（上下左右）">
            {(['t', 'm', 'b'] as const).map((vy) =>
              (['l', 'c', 'r'] as const).map((hx) => {
                const a = style.anchor ?? { h: 'c', v: 'm' }
                const on = !!style.box && a.h === hx && a.v === vy
                return (
                  <button
                    key={`${vy}${hx}`}
                    className={`align-cell ${on ? 'align-on' : ''}`}
                    title="固定ボックスの中でこの位置にテキストを寄せる（初回は箱を作成）"
                    onClick={() => onBoxAnchor(hx, vy)}
                  >
                    <span className={`align-dot align-${vy}${hx}`} />
                  </button>
                )
              })
            )}
          </div>
          {style.box && (
            <button className="sp-del" title="固定ボックスを解除" onClick={onClearBox}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ===== スタイル（プリセット）===== */}
      <div className={secCls('style')}>
        <div className="sp-head sp-head-btn" onClick={() => toggle('style')}>
          {closed.style ? '▶' : '▼'} スタイル（プリセット）
        </div>
        <div className="preset-chips">
          {presets.length ? (
            presets.map((p, i) => (
              <button
                key={i}
                className="preset-chip"
                onClick={() => onApplyPreset(p.style)}
                title="このスタイルを適用"
              >
                {p.name}
              </button>
            ))
          ) : (
            <span className="sp-label">保存したスタイルはまだありません</span>
          )}
        </div>
        <div className="sp-row">
          <input
            className="sp-preset-name"
            value={presetName}
            placeholder="プリセット名"
            onChange={(e) => setPresetName(e.target.value)}
          />
          <button
            className="btn small"
            onClick={() => {
              onSavePreset(presetName)
              setPresetName('')
            }}
          >
            現在のスタイルを保存
          </button>
        </div>
      </div>

      {/* ===== コラボアイコン（GiftCut固有。CSS orderで最下段に表示）===== */}
      <div className={secCls('icon')}>
        <div className="sp-head sp-head-btn" onClick={() => toggle('icon')}>
          {closed.icon ? '▶' : '▼'} コラボアイコン（テロップ前に表示）
        </div>
        <div className="sp-row">
          <input
            type="checkbox"
            checked={iconOn}
            onChange={(e) => onToggleIcon(e.target.checked)}
          />
          <span className="sp-label">この色のテロップに表示（単体はD&amp;Dで）</span>
          {iconOn && currentIconImage ? (
            <img
              src={currentIconImage}
              alt=""
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                objectFit: 'cover',
                border: `2px solid ${label}`
              }}
            />
          ) : iconOn ? (
            <span className="sp-label" style={{ opacity: 0.7 }}>
              この色に画像未割当
            </span>
          ) : null}
        </div>
        <div className="sp-row">
          <input
            type="checkbox"
            checked={iconAuto}
            onChange={(e) => onIconAutoChange(e.target.checked)}
          />
          <span className="sp-label">自動調整（テロップの行/大きさに合わせる・左固定）</span>
        </div>
        <div className="sp-row">
          <span className="sp-label">位置</span>
          <div className="seg" style={iconAuto ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
            {(
              [
                ['left', '左'],
                ['right', '右'],
                ['top', '上'],
                ['bottom', '下']
              ] as const
            ).map(([s, lb]) => (
              <button
                key={s}
                className={`seg-btn ${(iconAuto ? 'left' : iconSide) === s ? 'seg-on' : ''}`}
                onClick={() => onIconSideChange(s)}
              >
                {lb}
              </button>
            ))}
          </div>
        </div>
        <div className="sp-row">
          <span className="sp-label">サイズ</span>
          <input
            type="range"
            min={20}
            max={300}
            step={5}
            value={Math.round(iconScale * 100)}
            onChange={(e) => onIconScaleChange(Number(e.target.value) / 100)}
          />
          <span className="sp-val">{Math.round(iconScale * 100)}%</span>
        </div>
        <div className="sp-row">
          <span className="sp-label">X調整</span>
          <input
            type="range"
            min={-200}
            max={200}
            step={2}
            value={iconOffset.x}
            onChange={(e) => onIconOffsetChange({ ...iconOffset, x: Number(e.target.value) })}
          />
          <span className="sp-val">{Math.round(iconOffset.x)}</span>
        </div>
        <div className="sp-row">
          <span className="sp-label">Y調整</span>
          <input
            type="range"
            min={-200}
            max={200}
            step={2}
            value={iconOffset.y}
            onChange={(e) => onIconOffsetChange({ ...iconOffset, y: Number(e.target.value) })}
          />
          <span className="sp-val">{Math.round(iconOffset.y)}</span>
        </div>
        <div className="sp-row">
          <button
            className="btn small"
            onClick={() => {
              onIconScaleChange(1)
              onIconOffsetChange({ x: 0, y: 0 })
            }}
          >
            サイズ・位置をリセット
          </button>
        </div>
        <button className="btn small" onClick={onOpenIconSettings}>
          アイコン設定（色ごとに画像を割当）…
        </button>
      </div>

      {/* ===== テキスト ===== */}
      <div className={secCls('text')}>
        <div className="sp-head sp-head-btn" onClick={() => toggle('text')}>
          {closed.text ? '▶' : '▼'} テキスト
        </div>

        <select
          className="sp-select"
          value={style.fontFamily}
          onChange={(e) => set({ fontFamily: e.target.value })}
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f.family} value={f.family}>
              {f.label}
            </option>
          ))}
        </select>

        <div className="sp-row">
          <span className="sp-label">サイズ</span>
          <input
            type="range"
            min={12}
            max={300}
            value={style.fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
          />
          <ScrubNumber
            className="sp-num"
            value={style.fontSize}
            min={8}
            max={400}
            onChange={(v) => setFontSize(v)}
          />
        </div>

        <div className="sp-row">
          <span className="sp-label">配置</span>
          <div className="seg">
            {(['left', 'center', 'right'] as const).map((a) => (
              <button
                key={a}
                className={`seg-btn ${style.align === a ? 'seg-on' : ''}`}
                onClick={() => set({ align: a })}
              >
                {a === 'left' ? '⬅' : a === 'center' ? '☰' : '➡'}
              </button>
            ))}
          </div>
          <button
            className={`seg-btn ${style.bold ? 'seg-on' : ''}`}
            onClick={() => set({ bold: !style.bold })}
            title="太字"
          >
            <b>B</b>
          </button>
          <button
            className={`seg-btn ${style.italic ? 'seg-on' : ''}`}
            onClick={() => set({ italic: !style.italic })}
            title="斜体"
          >
            <i>I</i>
          </button>
        </div>

        <div className="sp-row">
          <span className="sp-label">字間</span>
          <ScrubNumber
            className="sp-num wide"
            value={style.tracking}
            min={-200}
            max={800}
            onChange={(v) => set({ tracking: v })}
          />
          <span className="sp-label">行間</span>
          <ScrubNumber
            className="sp-num wide"
            value={style.leading}
            min={-50}
            max={300}
            onChange={(v) => set({ leading: v })}
          />
        </div>
      </div>

      {/* ===== アピアランス ===== */}
      <div className={secCls('app')}>
        <div
          className="sp-head sp-head-btn"
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          onClick={() => toggle('app')}
        >
          <span>{closed.app ? '▶' : '▼'} アピアランス</span>
          <select
            className="sp-select mini"
            style={{ marginLeft: 'auto' }}
            title="角の結合（フォント全体：縁・輪郭に共通）マイター＝尖る / ラウンド＝丸い"
            value={style.join ?? 'miter'}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => set({ join: e.target.value as 'miter' | 'round' })}
          >
            <option value="miter">🔧マイター</option>
            <option value="round">🔧ラウンド</option>
          </select>
        </div>

        {/* 塗り（Premiere風：スウォッチをクリックでカラーピッカー） */}
        <div className="sp-row">
          <input
            type="checkbox"
            checked={style.fill.enabled}
            onChange={(e) => set({ fill: { ...style.fill, enabled: e.target.checked } })}
          />
          <span className="sp-label">塗り</span>
          <button
            onClick={() => setFillPickerOpen((v) => !v)}
            title="クリックでカラーピッカー"
            style={{
              marginLeft: 'auto',
              width: 64,
              height: 22,
              borderRadius: 4,
              border: '1px solid #ffffff44',
              cursor: 'pointer',
              padding: 0,
              background: `${
                style.fill.gradient
                  ? `linear-gradient(to right, ${[...style.fill.gradient.stops]
                      .sort((a, b) => a.pos - b.pos)
                      .map((s) => `${s.color} ${Math.round(s.pos * 100)}%`)
                      .join(', ')})`
                  : style.fill.color
              }, repeating-conic-gradient(#888 0% 25%, #bbb 0% 50%) 0/10px 10px`
            }}
          />
        </div>
        {fillPickerOpen && (
          <FillPicker
            fill={style.fill}
            onChange={(f) => set({ fill: f })}
            onClose={() => setFillPickerOpen(false)}
          />
        )}

        {/* ストローク（複数） */}
        <div className="sp-subhead">
          <span>ストローク</span>
          <button className="sp-add" onClick={addStroke} title="ストロークを追加">
            ＋
          </button>
        </div>
        {style.strokes.map((st, i) => (
          <div className="sp-row" key={i}>
            <input
              type="checkbox"
              checked={st.enabled}
              onChange={(e) => setStroke(i, { enabled: e.target.checked })}
            />
            <ColorField color={st.color} onChange={(hex) => setStroke(i, { color: hex })} title="縁の色" />
            <ScrubNumber
              className="sp-num"
              value={st.width}
              min={0}
              max={100}
              step={0.5}
              sensitivity={5}
              onChange={(v) => setStroke(i, { width: v })}
            />
            <select
              className="sp-select mini"
              value={st.position}
              onChange={(e) => setStroke(i, { position: e.target.value as StrokePosition })}
            >
              <option value="outside">外側</option>
              <option value="center">中央</option>
              <option value="inside">内側</option>
            </select>
            <button className="sp-del" onClick={() => removeStroke(i)} title="削除">
              ✕
            </button>
          </div>
        ))}

        {/* 背景 */}
        <div className="sp-subhead">
          <span>背景</span>
        </div>
        <div className="sp-row">
          <input
            type="checkbox"
            checked={style.background.enabled}
            onChange={(e) =>
              set({ background: { ...style.background, enabled: e.target.checked } })
            }
          />
          <ColorField
            color={style.background.color}
            onChange={(hex) => set({ background: { ...style.background, color: hex } })}
            title="背景の色"
          />
          <span className="sp-label">不透明度</span>
          <input
            type="range"
            min={0}
            max={100}
            value={style.background.opacity}
            onChange={(e) =>
              set({ background: { ...style.background, opacity: Number(e.target.value) } })
            }
          />
          <span className="sp-val">{style.background.opacity}</span>
        </div>
        {style.background.enabled && (
          <div className="sp-row">
            <span className="sp-label">サイズ</span>
            <input
              type="range"
              min={0}
              max={60}
              step={0.1}
              value={style.background.size ?? Math.round(style.fontSize * 0.12)}
              onChange={(e) =>
                set({ background: { ...style.background, size: Number(e.target.value) } })
              }
            />
            <span className="sp-val">{(style.background.size ?? Math.round(style.fontSize * 0.12)).toFixed(1)}</span>
            <span className="sp-label">角丸</span>
            <input
              type="range"
              min={0}
              max={60}
              step={0.1}
              value={style.background.corner ?? Math.round(style.fontSize * 0.1)}
              onChange={(e) =>
                set({ background: { ...style.background, corner: Number(e.target.value) } })
              }
            />
            <span className="sp-val">{(style.background.corner ?? Math.round(style.fontSize * 0.1)).toFixed(1)}</span>
          </div>
        )}

        {/* シャドウ（複数対応・Premiere準拠） */}
        <div className="sp-subhead">
          <span>シャドウ（{1 + (style.shadows?.length ?? 0)}）</span>
          <button
            className="sp-add"
            title="シャドウを追加"
            onClick={() =>
              set({
                shadows: [
                  ...(style.shadows ?? []),
                  { color: '#000000', opacity: 70, angle: 90, distance: 5, blur: 5, spread: 0 }
                ]
              })
            }
          >
            ＋
          </button>
        </div>
        {/* 表示はデータ順＝blob順(master埋込→ベクタ)＝Premiere一覧の上→下。影1(先頭)=最前面 */}
        {[style.shadow, ...(style.shadows ?? [])].map((sh, i) => {
          const displayIdx = i
          const isPrimary = i === 0
          const upd = (patch: Partial<typeof sh>): void => {
            if (isPrimary) set({ shadow: { ...style.shadow, ...patch } })
            else
              set({
                shadows: (style.shadows ?? []).map((s, k) => (k === i - 1 ? { ...s, ...patch } : s))
              })
          }
          return (
            <div key={i} className="sp-shadow">
              <div className="sp-row">
                {isPrimary ? (
                  <input
                    type="checkbox"
                    checked={style.shadow.enabled}
                    onChange={(e) => set({ shadow: { ...style.shadow, enabled: e.target.checked } })}
                  />
                ) : (
                  <input
                    type="checkbox"
                    checked={(sh as { enabled?: boolean }).enabled !== false}
                    onChange={(e) => upd({ enabled: e.target.checked } as Partial<typeof sh>)}
                  />
                )}
                <ColorField color={sh.color} onChange={(hex) => upd({ color: hex })} title="影の色" />
                <span className="sp-label">影{displayIdx + 1}</span>
                {!isPrimary && (
                  <button
                    className="sp-add"
                    title="この影を削除"
                    style={{ marginLeft: 'auto' }}
                    onClick={() =>
                      set({ shadows: (style.shadows ?? []).filter((_, k) => k !== i - 1) })
                    }
                  >
                    −
                  </button>
                )}
              </div>
              <Slider unit="%" label="不透明度" min={0} max={100} value={sh.opacity} onChange={(v) => upd({ opacity: v })} />
              <Slider unit="°" label="角度" min={0} max={360} value={sh.angle} onChange={(v) => upd({ angle: v })} />
              <Slider label="距離" min={0} max={100} value={sh.distance} onChange={(v) => upd({ distance: v })} />
              <Slider label="サイズ" min={0} max={100} value={sh.spread ?? 0} onChange={(v) => upd({ spread: v })} />
              <Slider label="ぼかし" min={0} max={250} value={sh.blur} onChange={(v) => upd({ blur: v })} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Adobe風スクラブ数値入力: クリックで打ち込み、押し込んで左右ドラッグで数値を増減。
function ScrubNumber({
  value,
  onChange,
  min,
  max,
  step = 1,
  sensitivity = 3,
  className
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  sensitivity?: number // 何pxで1ステップ動かすか
  className?: string
}): JSX.Element {
  const clampV = (v: number): number => Math.min(max, Math.max(min, v))
  const onPointerDown = (e: React.PointerEvent<HTMLInputElement>): void => {
    if (e.button !== 0) return
    const input = e.currentTarget
    const startVal = Number(value) || 0
    // movementX を積算するので、画面端に当たってもポインタロック中は動き続ける（Adobe同様）
    let acc = 0
    let scrubbing = false
    const onMove = (ev: PointerEvent): void => {
      acc += ev.movementX || 0
      if (!scrubbing) {
        if (Math.abs(acc) < 4) return // ここまではクリック扱い（打ち込みできる）
        scrubbing = true
        input.blur() // スクラブ中はキャレット/選択を出さない
        // ポインタロックで画面端を越えても movementX が来続ける
        try {
          void input.requestPointerLock?.()
        } catch {
          /* 失敗しても端まではスクラブ可能 */
        }
      }
      ev.preventDefault()
      const v = clampV(startVal + Math.trunc(acc / sensitivity) * step)
      onChange(Number(v.toFixed(2)))
      window.getSelection()?.removeAllRanges()
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (document.pointerLockElement === input) document.exitPointerLock?.()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // 中断時も必ず解除（残すとマウスを動かすだけで数値が変わり続ける）
    window.addEventListener('pointercancel', onUp)
  }
  return (
    <input
      type="number"
      className={`scrub ${className ?? ''}`}
      value={value}
      step={step}
      onPointerDown={onPointerDown}
      onChange={(e) => onChange(clampV(Number(e.target.value) || 0))}
    />
  )
}

// unit: 数値の単位。同じ「不透明度」なのに映像レイヤーでは 70% でテロップでは 70、
// 同じ「角度」なのにグラデでは 45 度表記で影では 45、と単位の有無がバラバラだった。
function Slider(props: {
  label: string
  min: number
  max: number
  value: number
  unit?: string
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <div className="sp-row">
      <span className="sp-label indent">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <span className="sp-val">
        {props.value}
        {props.unit ?? ''}
      </span>
    </div>
  )
}
