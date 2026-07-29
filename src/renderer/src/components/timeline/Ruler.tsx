// タイムラインの上に重なる「時間の物差し」まわり。
//
//   TimeRuler   … 目盛り（ドラッグで再生位置を動かす）
//   HoverGuide  … マウスの位置に出る縦線と時刻
//   Marquee     … 範囲選択の四角
//   MarkerFlags … めじるし（旗＋縦線・名前の変更）
//   Playhead    … 再生ヘッド
//
// どれも「時間 × 拡大率 = 横位置」で置くだけの物。位置の決め方を1か所に
// 集めておくと、拡大率を変えたときにズレるのがここだけで済む。

import type { JSX } from 'react'

export function TimeRuler({
  ticks,
  onScrub
}: {
  ticks: { left: number; major: boolean; label?: string }[]
  onScrub: (e: React.PointerEvent) => void
}): JSX.Element {
  return (
    <div className="ruler" onPointerDown={onScrub}>
      {ticks.map((t, i) => (
        <div
          key={i}
          className={`tick ${t.major ? 'tick-major' : 'tick-minor'}`}
          style={{ left: t.left }}
        >
          {t.label && <span>{t.label}</span>}
        </div>
      ))}
    </div>
  )
}

export function HoverGuide({ x, label }: { x: number; label: string }): JSX.Element {
  return (
    <div className="hover-line" style={{ left: x }}>
      <span className="hover-time">{label}</span>
    </div>
  )
}

export function Marquee({
  x0,
  y0,
  x1,
  y1
}: {
  x0: number
  y0: number
  x1: number
  y1: number
}): JSX.Element {
  return (
    <div
      className="marquee"
      style={{
        left: Math.min(x0, x1),
        top: Math.min(y0, y1),
        width: Math.abs(x1 - x0),
        height: Math.abs(y1 - y0)
      }}
    />
  )
}

export function Playhead({ x, onScrub }: { x: number; onScrub: (e: React.PointerEvent) => void }): JSX.Element {
  return (
    <div className="playhead" style={{ left: x }}>
      <div className="playhead-handle" onPointerDown={onScrub} />
    </div>
  )
}

export interface Marker {
  id: number
  t: number
  label: string
}

export function MarkerFlags({
  markers,
  zoom,
  selectedId,
  editingId,
  timeLabel,
  onPointerDown,
  onStartRename,
  onRename,
  onCancelRename
}: {
  markers: Marker[]
  zoom: number
  selectedId: number | null
  editingId: number | null
  /** 旗の説明に出す時刻の文字 */
  timeLabel: (t: number) => string
  onPointerDown: (mk: Marker, e: React.PointerEvent) => void
  onStartRename: (id: number) => void
  onRename: (id: number, label: string) => void
  onCancelRename: () => void
}): JSX.Element {
  return (
    <>
      {markers.map((mk) => (
        <div
          key={mk.id}
          className={`marker ${selectedId === mk.id ? 'marker-sel' : ''}`}
          style={{ left: mk.t * zoom }}
        >
          <div className="marker-line" />
          <div
            className="marker-flag"
            title={`${timeLabel(mk.t)}${mk.label ? '：' + mk.label : ''}（クリックで頭出し / ドラッグで移動 / ダブルクリックで名前 / Delete で削除）`}
            onPointerDown={(e) => onPointerDown(mk, e)}
            onDoubleClick={(e) => {
              e.stopPropagation()
              onStartRename(mk.id)
            }}
          >
            🚩
          </div>
          {mk.label && editingId !== mk.id && <span className="marker-label">{mk.label}</span>}
          {editingId === mk.id && (
            <input
              className="marker-input"
              autoFocus
              defaultValue={mk.label}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={(e) => onRename(mk.id, e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                else if (e.key === 'Escape') onCancelRename()
                // タイムライン側のキー操作（削除など）まで届かせない
                e.stopPropagation()
              }}
            />
          )}
        </div>
      ))}
    </>
  )
}
