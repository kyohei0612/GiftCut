// テロップの**見た目の装飾**——塗り・縁（ストローク）・背景・影。
//
// ## なぜスタイル欄から出したか
//
// 元は `StylePanel.tsx`（679行・**冒頭コメントが1行も無かった**）の中。
// あちらは「整列／プリセット／アイコン／テキスト／アピアランス」の5節で、
// **アピアランスだけで 225行**＝全体の3分の1を占めていた。
// しかも縁の足し引き（`setStroke`/`addStroke`/`removeStroke`）と `Slider` は
// **この節でしか使われていない**（2026-08-03 に出した）。
//
// またぐ名前は5つだけ（`style` `set` `open` `onToggle` `cls`）。
// 塗りのピッカーを開いているかは**この中の持ち物**にした（外は知らなくてよい）。
//
// ## 角の結合は「フォント全体」に掛かる
//
// マイター＝尖る／ラウンド＝丸い。縁と輪郭に共通で効くので、
// 個々のストロークではなく節の見出しに置いてある。
//
// ## 影はデータ順に並べる
//
// 表示順＝blob順（master埋込→ベクタ）＝Premiere の一覧の上→下。
// **影1（先頭）が最前面。** 並べ替えると Premiere から持ってきた見た目が変わる。
//
// ## 中身
//
// - `StyleAppearance` … 節まるごと
// - `Slider` … ラベル＋つまみ＋数値の1行（単位つき）
import { useState, type JSX } from 'react'
import type { StrokeLayer, StrokePosition, TelopStyle } from '../lib/telopStyle'
import { FillPicker } from './FillPicker'
import { ColorField } from './ColorArea'
import { ScrubNumber } from './ScrubNumber'

export function StyleAppearance({
  style,
  set,
  open,
  onToggle,
  cls
}: {
  style: TelopStyle
  set: (patch: Partial<TelopStyle>) => void
  /** 節が開いているか */
  open: boolean
  onToggle: () => void
  /** 節の外枠に付けるクラス（開閉と並び順は CSS が持っている） */
  cls: string
}): JSX.Element {
  const [fillPickerOpen, setFillPickerOpen] = useState(false)
  const setStroke = (i: number, patch: Partial<StrokeLayer>): void =>
    set({ strokes: style.strokes.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) })
  const addStroke = (): void =>
    set({
      strokes: [...style.strokes, { enabled: true, color: '#000000', width: 4, position: 'center' }]
    })
  const removeStroke = (i: number): void =>
    set({ strokes: style.strokes.filter((_, idx) => idx !== i) })
  return (
    <div className={cls}>
        <div
          className="sp-head sp-head-btn"
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        onClick={onToggle}
        >
          <span>{open ? '▼' : '▶'} アピアランス</span>
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
