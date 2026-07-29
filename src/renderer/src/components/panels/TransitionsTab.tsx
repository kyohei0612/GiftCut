// 右パネルの「トランジション」タブ。
//
// 上半分 … タイムラインで帯を選んでいるとき、その1つを編集・削除する
// 下半分 … 置ける物の一覧（タイムラインへドラッグして置く）
//
// 動画クリップとテロップで**同じ扱い**にしてある。どちらも
// 頭（始まり）・間（隣との切替）・尻（終わり）のどこにでも置けて、
// 置いた帯をクリックすれば長さと種類を変えられる。
// 片方だけ別の操作にすると、置き方を2つ覚えることになる。

import type { JSX } from 'react'

export interface TransKind {
  type: string
  label: string
  ico: string
}

/** 選んでいる帯（動画側／テロップ側で共通の形にして渡す） */
export interface SelectedBand {
  /** 見出しに出す場所の名前（頭・間・尻） */
  place: string
  /** 見出しの絵文字 */
  ico: string
  type: string
  dur: number
  kinds: TransKind[]
  onType: (type: string) => void
  onDur: (dur: number) => void
  onDelete: () => void
  onDeselect: () => void
}

function BandEditor({ band }: { band: SelectedBand }): JSX.Element {
  return (
    <div className="sel-trans">
      <div className="sel-trans-head">
        <span className="sel-trans-title">
          {band.ico} {band.place}
        </span>
        <button
          className="btn small danger"
          onClick={band.onDelete}
          title="これを削除（Delete）"
        >
          削除
        </button>
      </div>
      <div className="sp-row">
        <span className="sp-label">種類</span>
        <div className="seg seg-wrap">
          {band.kinds.map((x) => (
            <button
              key={x.type}
              className={`seg-btn ${band.type === x.type ? 'seg-on' : ''}`}
              onClick={() => band.onType(x.type)}
              title={x.label}
            >
              {x.ico}
            </button>
          ))}
        </div>
      </div>
      <div className="sp-row">
        <span className="sp-label">長さ</span>
        <input
          type="range"
          min={0.05}
          max={2}
          step={0.05}
          value={band.dur}
          onChange={(e) => band.onDur(Number(e.target.value))}
        />
        <span className="sp-val">{band.dur.toFixed(2)}s</span>
      </div>
      <button className="btn small" onClick={band.onDeselect}>
        選択を解除
      </button>
      <div className="tpl-divider" />
    </div>
  )
}

export function TransitionsTab({
  bodyRef,
  accSec,
  selectedVideoBand,
  selectedTelopBand,
  newDur,
  onNewDur,
  videoKinds,
  telopKinds,
  onDragStartVideo,
  onDragEndVideo,
  onDragStartTelop,
  onDragEndTelop,
  onToggleEmphasis
}: {
  bodyRef: React.Ref<HTMLDivElement>
  accSec: (
    tab: string,
    key: string,
    label: string,
    count: number | null,
    body: JSX.Element
  ) => JSX.Element
  /** 動画クリップ側で選んでいる帯（無ければ null） */
  selectedVideoBand: SelectedBand | null
  /** テロップ側で選んでいる帯（無ければ null） */
  selectedTelopBand: SelectedBand | null
  /** これから置く物の長さ */
  newDur: number
  onNewDur: (v: number) => void
  videoKinds: TransKind[]
  telopKinds: TransKind[]
  onDragStartVideo: (kind: TransKind, e: React.DragEvent) => void
  onDragEndVideo: () => void
  onDragStartTelop: (kind: TransKind, e: React.DragEvent) => void
  onDragEndTelop: () => void
  onToggleEmphasis: (kind: 'shake' | 'pulse') => void
}): JSX.Element {
  const list = (
    kinds: TransKind[],
    onStart: (k: TransKind, e: React.DragEvent) => void,
    onEnd: () => void,
    hint: string
  ): JSX.Element => (
    <div className="fx-list">
      {kinds.map((x) => (
        <button
          key={x.type}
          className="fx-item fx-draggable"
          draggable
          onDragStart={(e) => onStart(x, e)}
          onDragEnd={onEnd}
          title={`${x.label}。${hint}`}
        >
          <span className="fx-ico">{x.ico}</span>
          <span className="fx-name">{x.label}</span>
          <span className="fx-drag-hint">⠿</span>
        </button>
      ))}
    </div>
  )
  return (
    <div className="panel-body" ref={bodyRef}>
      {selectedVideoBand && <BandEditor band={selectedVideoBand} />}
      {selectedTelopBand && <BandEditor band={selectedTelopBand} />}
      {!selectedVideoBand && !selectedTelopBand && (
        <div className="tpl-hint">
          下のトランジションを<b>タイムラインへドラッグ</b>。落とす<b>マウス位置</b>で置き場所が決まります。
          置いた<b>帯をクリック</b>で長さ・種類の変更／削除、<b>帯の端をドラッグ</b>で長さ変更。
        </div>
      )}
      <div className="sp-row">
        <span className="sp-label">新規の長さ</span>
        <input
          type="range"
          min={0.05}
          max={2}
          step={0.05}
          value={newDur}
          onChange={(e) => onNewDur(Number(e.target.value))}
        />
        <span className="sp-val">{newDur.toFixed(2)}s</span>
      </div>
      {accSec('transition', 'video', '🎬 動画クリップ', null, (
        <>
          <div className="tpl-hint">
            どの種類も<b>頭・間・尻のどこにでも</b>置けます。
            <b>カットの境目＝間</b>／クリップ本体の<b>前半＝頭・後半＝尻</b>。
          </div>
          {list(videoKinds, onDragStartVideo, onDragEndVideo, 'クリップの頭/間/尻へドラッグ')}
        </>
      ))}
      {accSec('transition', 'telop', '💬 テロップ', null, (
        <>
          <div className="tpl-hint">
            テロップの<b>頭＝出現 / 尻＝消失 / 間＝隣のテロップとの切替</b>。
          </div>
          {list(telopKinds, onDragStartTelop, onDragEndTelop, 'テロップの頭/尻/間へドラッグ')}
        </>
      ))}
      {accSec('transition', 'effect', '✨ エフェクト（テロップ強調）', null, (
        <>
          <div className="tpl-hint">
            選択中のテロップに<b>クリックでON/OFF</b>（クリップ全体にかかる動き）。
          </div>
          <div className="fx-list">
            <button className="fx-item" onClick={() => onToggleEmphasis('shake')}>
              <span className="fx-ico">〰️</span>
              <span className="fx-name">揺れ</span>
            </button>
            <button className="fx-item" onClick={() => onToggleEmphasis('pulse')}>
              <span className="fx-ico">❤️</span>
              <span className="fx-name">脈動</span>
            </button>
          </div>
        </>
      ))}
    </div>
  )
}
