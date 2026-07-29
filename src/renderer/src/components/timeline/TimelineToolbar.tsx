// タイムラインの上に並ぶ道具立て。
//
// 並べる順は「よく使う物ほど左」。カットと磁石は押し間違えると影響が大きいので、
// 絵柄だけでなく**文字も付ける**（実際に「⎇」「↔」が何か分からなかった、という
// 声があったため）。
//
// 右端の説明は、いま何ができるかで変わる。掴んでいる最中は
// 「Alt=複製 / Ctrl=割り込み」のように、その場で使える物だけを出す。

import type { JSX } from 'react'

export type TimelineTool = 'select' | 'razor' | 'trackFwd' | 'trackBack'

export function TimelineToolbar({
  tool,
  onTool,
  snap,
  onToggleSnap,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSplit,
  onSilenceCut,
  zoom,
  onZoom,
  onFit,
  hint,
  keyHint
}: {
  tool: TimelineTool
  onTool: (t: TimelineTool) => void
  snap: boolean
  onToggleSnap: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onSplit: () => void
  onSilenceCut: () => void
  zoom: number
  onZoom: (v: number) => void
  onFit: () => void
  /** 右端に出す説明 */
  hint: string
  keyHint: {
    select: string
    razor: string
    snap: string
    undo: string
    redo: string
    split: string
  }
}): JSX.Element {
  return (
    <div className="tl-toolbar">
      <button
        className={`tool ${tool === 'select' ? 'tool-on' : ''}`}
        title={`選択ツール (${keyHint.select})`}
        onClick={() => onTool('select')}
      >
        ▤
      </button>
      <button
        className={`tool ${tool === 'razor' ? 'tool-on' : ''}`}
        title={`レザー / カット (${keyHint.razor})`}
        onClick={() => onTool('razor')}
      >
        ✂ <span className="tool-text">カット</span>
      </button>
      <button
        className={`tool ${snap ? 'tool-on' : ''}`}
        title={`スナップ (${keyHint.snap})`}
        onClick={onToggleSnap}
      >
        🧲 <span className="tool-text">磁石</span>
      </button>
      <button
        className={`tool ${tool === 'trackBack' ? 'tool-on' : ''}`}
        title="トラック選択（左）: クリック位置から左を全選択 / Shiftでそのレーンだけ"
        onClick={() => onTool(tool === 'trackBack' ? 'select' : 'trackBack')}
      >
        ⇤
      </button>
      <button
        className={`tool ${tool === 'trackFwd' ? 'tool-on' : ''}`}
        title="トラック選択（右）: クリック位置から右を全選択 / Shiftでそのレーンだけ"
        onClick={() => onTool(tool === 'trackFwd' ? 'select' : 'trackFwd')}
      >
        ⇥
      </button>
      <span className="tl-sep" />
      <button className="tool" title={`元に戻す (${keyHint.undo})`} onClick={onUndo} disabled={!canUndo}>
        ↶
      </button>
      <button className="tool" title={`やり直す (${keyHint.redo})`} onClick={onRedo} disabled={!canRedo}>
        ↷
      </button>
      <button className="tool" title={`再生ヘッドで分割 (${keyHint.split})`} onClick={onSplit}>
        ⎇ <span className="tool-text">分割</span>
      </button>
      {/* 喋っていない所をまとめて切る。切り抜きでは毎回やる作業なので、
          メニューの奥ではなくタイムラインの手元に置く */}
      <button className="tool tool-wide" title="喋っていない所をまとめて切る" onClick={onSilenceCut}>
        🔇 無音カット
      </button>
      <div className="tl-zoom">
        <button className="tool tool-sm" title="タイムライン全体を表示（フィット）" onClick={onFit}>
          ↔
        </button>
        <span>拡大</span>
        <input
          type="range"
          min={6}
          max={120}
          value={zoom}
          onChange={(e) => onZoom(Number(e.target.value))}
          title="タイムラインの拡大率（Ctrl+ホイールでも操作可）"
        />
      </div>
      <span className="tl-hint">{hint}</span>
    </div>
  )
}
