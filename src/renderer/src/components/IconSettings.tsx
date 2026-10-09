// 左パネルに**常に**出す、アイコン（テロップの前に出す顔）の設定。
//
// ## なぜテロップを選んだときの設定（StylePanel）から出したか
//
// 出す側・位置・大きさ・自動調整は**プロジェクト全体の設定**（`state/useIcons`）なのに、
// テロップを1つ選ばないと触れない所にあった。編集者（本人の妻）の指定で、
// 何も選んでいなくても左のプロパティに出す（2026-10-09）。
//
// ## 既定は「切」
//
// 色（ラベル）や段への割り当ては**利用者の設定**として残る（localStorage →
// ユーザー設定.json）ので、一度でも割り当てると、新しいプロジェクトで
// テロップを足した瞬間から顔が付く。「何も設定していないのにアイコンが付く」の正体。
// そこで全体のスイッチを置き、新しいプロジェクトは**切**から始める。
// テロップに直に落とした1枚は、このスイッチに関係なく出る（落としたのに出ないと
// 壊れて見える）。決まりは `useIcons.iconForCue` が持つ。
//
// ## 受け取らない
//
// 区画と同じく、囲い（iconsContext / leftPanelContext / useEdit）から自分で見に行く。
//
// ## 中身
//
// - `IconSettings` … 節そのもの（畳める。畳んだかは localStorage に覚える）
import { useState, type JSX } from 'react'
import { useIconsCtx, } from '../state/iconsContext'
import { useLeftPanel } from '../state/leftPanelContext'
import { useEdit } from '../state/useEdit'

const CLOSED_KEY = 'giftcut.iconSecClosed'

export function IconSettings(): JSX.Element {
  const {
    iconEnabled, setIconEnabled, iconAuto, iconSide, setIconSide,
    iconScale, setIconScale, iconOffset, setIconOffset, setIconSettingsOpen
  } = useIconsCtx()
  const { changeIconAuto, setPersonIconForSelected, iconForCue } = useLeftPanel()
  const { selected } = useEdit()
  // 畳んだかは覚える（StylePanel の節と同じ。開き直すたびに戻ると触るたびに開く羽目になる）
  const [closed, setClosed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CLOSED_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggle = (): void =>
    setClosed((p) => {
      try {
        localStorage.setItem(CLOSED_KEY, p ? '0' : '1')
      } catch {
        /* 覚えられなくても操作は続けられる */
      }
      return !p
    })
  // 全体が切のときは、下の細かい設定は触っても見えないので薄くする
  const dim = iconEnabled ? undefined : { opacity: 0.4, pointerEvents: 'none' as const }
  const cur = selected ? iconForCue(selected) : undefined
  return (
    <div className={`sp-section icon-settings ${closed ? 'sec-closed' : ''}`}>
      <div className="sp-head sp-head-btn" onClick={toggle}>
        {closed ? '▶' : '▼'} コラボアイコン（テロップの前に表示・全体の設定）
      </div>
      <div className="sp-row">
        <input
          type="checkbox"
          checked={iconEnabled}
          onChange={(e) => setIconEnabled(e.target.checked)}
        />
        <span className="sp-label">アイコンを出す（色・段の割り当てで付く物。既定は切）</span>
      </div>
      {/* テロップを選んでいるときだけ、その色の割り当ての入切と、いま出る絵を見せる */}
      {selected && (
        <div className="sp-row" style={dim}>
          <input
            type="checkbox"
            checked={cur !== undefined}
            onChange={(e) => setPersonIconForSelected(e.target.checked)}
          />
          <span className="sp-label">この色のテロップに表示（単体はD&amp;Dで）</span>
          {cur ? (
            <img
              src={cur}
              alt=""
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                objectFit: 'cover',
                border: `2px solid ${selected.label}`
              }}
            />
          ) : (
            <span className="sp-label" style={{ opacity: 0.7 }}>
              この色に画像未割当
            </span>
          )}
        </div>
      )}
      <div className="sp-row" style={dim}>
        <input
          type="checkbox"
          checked={iconAuto}
          onChange={(e) => changeIconAuto(e.target.checked)}
        />
        <span className="sp-label">自動調整（テロップの行/大きさに合わせる・左固定）</span>
      </div>
      <div className="sp-row" style={dim}>
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
              onClick={() => setIconSide(s)}
            >
              {lb}
            </button>
          ))}
        </div>
      </div>
      <div className="sp-row" style={dim}>
        <span className="sp-label">サイズ</span>
        <input
          type="range"
          min={20}
          max={300}
          step={5}
          value={Math.round(iconScale * 100)}
          onChange={(e) => setIconScale(Number(e.target.value) / 100)}
        />
        <span className="sp-val">{Math.round(iconScale * 100)}%</span>
      </div>
      <div className="sp-row" style={dim}>
        <span className="sp-label">X調整</span>
        <input
          type="range"
          min={-200}
          max={200}
          step={2}
          value={iconOffset.x}
          onChange={(e) => setIconOffset({ ...iconOffset, x: Number(e.target.value) })}
        />
        <span className="sp-val">{Math.round(iconOffset.x)}</span>
      </div>
      <div className="sp-row" style={dim}>
        <span className="sp-label">Y調整</span>
        <input
          type="range"
          min={-200}
          max={200}
          step={2}
          value={iconOffset.y}
          onChange={(e) => setIconOffset({ ...iconOffset, y: Number(e.target.value) })}
        />
        <span className="sp-val">{Math.round(iconOffset.y)}</span>
      </div>
      <div className="sp-row" style={dim}>
        <button
          className="btn small"
          onClick={() => {
            setIconScale(1)
            setIconOffset({ x: 0, y: 0 })
          }}
        >
          サイズ・位置をリセット
        </button>
      </div>
      <button className="btn small" onClick={() => setIconSettingsOpen(true)}>
        アイコン設定（色ごとに画像を割当）…
      </button>
    </div>
  )
}
