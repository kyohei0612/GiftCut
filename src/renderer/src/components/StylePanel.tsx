// テロップのスタイル欄（Premiere の「エッセンシャルグラフィックス」に当たる所）。
//
// ## 節は4つ＋1
//
//   整列と変形 … フレームのどこへ置くか・固定ボックスの中でどう寄せるか
//   スタイル   … 名前を付けて保存した見た目（プリセット）
//   コラボアイコン … **GiftCut 固有**。テロップの横に顔を出す
//   テキスト   … フォント・大きさ・行間・字間
//   アピアランス … 塗り・縁・背景・影 → **`./StyleAppearance`（別ファイル）**
//
// 並び順は CSS の flex order（`sp-sec-{名前}`）が持っている。
// **書いてある順と、画面に出る順は違う。**
//
// ## 節の開け閉ては覚えておく
//
// 前は組み立て直すたびに既定へ戻っていたので、選ぶ物を変えるたびに開き直す
// 羽目になっていた。**触っていない所は畳んだまま、開いた所は開いたまま。**
//
// ## 大きさを変えると、縁も影も同率で動く
//
// `fontSize` だけ変えると、小さくしたとき縁や影が相対的に肥大して文字が潰れる。
// **相似形を保つ**のが決まり（`setFontSize` を見ること）。
//
// ## 2026-08-03 まで冒頭コメントが1行も無かった
//
// 679行あって、何のファイルかがどこにも書いていなかった。**冒頭コメントが
// 無いファイルほど話題が多い**という関係の実例で、実際いちばん大きい節
// （アピアランス225行）は他の節と何も共有していなかった。
//
// （425行なので取説は付けていない。500 を超えたら
//   `shared/readability.test.ts` が「割るか取説を付けろ」と言ってくる）
import { useState } from 'react'
import { FONT_OPTIONS, type TelopStyle } from '../lib/telopStyle'
import { ScrubNumber } from './ScrubNumber'
import { StyleAppearance } from './StyleAppearance'

export interface StylePreset {
  name: string
  style: TelopStyle
}
// ※ ここにあった IconLibItem は消した。export されていたが参照が0だった
//    （export した型は noUnusedLocals が見ない）

/** 節の開け閉めの覚え先。画面の都合なのでプロジェクトには入れない */
const SP_CLOSED_KEY = 'gc.stylePanelClosed'

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
  // ※ 塗りのピッカーを開いているかは ./StyleAppearance の中の持ち物になった
  //   （開けるのも閉じるのもあの節だけ。外が知る必要が無い）
  /**
   * 節の開け閉め（見出しを押すと畳める）。既定はスタイル／アイコンを閉じておく。
   *
   * **覚えておく。** 前は組み立て直すたびに既定へ戻っていたので、
   * 選ぶ物を変えるたびに開き直す羽目になっていた（＝触った所も畳まれる）。
   * **触っていない所は畳んだまま、開いた所は開いたまま**にする。
   * 画面の都合なのでプロジェクトには入れない（localStorage）。
   */
  const [closed, setClosed] = useState<Record<string, boolean>>(() => {
    try {
      const s = localStorage.getItem(SP_CLOSED_KEY)
      const v = s ? JSON.parse(s) : null
      if (v && typeof v === 'object') return v as Record<string, boolean>
    } catch {
      /* 読めなければ既定で始める */
    }
    return { style: true, icon: true }
  })
  const toggle = (k: string): void =>
    setClosed((p) => {
      const next = { ...p, [k]: !p[k] }
      try {
        localStorage.setItem(SP_CLOSED_KEY, JSON.stringify(next))
      } catch {
        /* 覚えられなくても操作は続けられる */
      }
      return next
    })
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


      {/* ===== アピアランス（塗り・縁・背景・影）は ./StyleAppearance ===== */}
      <StyleAppearance
        style={style}
        set={set}
        open={!closed.app}
        onToggle={() => toggle('app')}
        cls={secCls('app')}
      />
    </div>
  )
}
