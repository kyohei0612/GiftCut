// 右パネルの「プロジェクト」タブ＝素材の置き場（ビン）。
//
// 読み込んだ動画・音・画像を種類ごとに並べる。タイムラインへはドラッグで置く。
// 読み込んだ SRT と、使っている色ラベルの一覧もここに出す
// （「今このプロジェクトに何があるか」を1か所で見せるため）。

import type { JSX, RefObject } from 'react'
import { VirtualBlock } from '../VirtualBlock'
import { useViewport } from '../useVirtual'

export interface MediaItem {
  id: number
  path: string
  name: string
  kind: 'video' | 'audio' | 'image'
  folder?: string
  thumb?: string
}

const KIND_LABEL = { video: '動画', audio: 'SE / 音声', image: '画像' } as const
const KIND_ICO = { video: '🎬', audio: '🔊', image: '🖼' } as const
const KIND_HINT = {
  video: 'タイムラインへドラッグ=置いた位置に配置（Ctrl=挿入）/ ダブルクリック=読み込み',
  audio: 'タイムラインにドラッグでSE/BGM配置',
  image: 'タイムラインの映像トラック(V2/V3)へドラッグで画像を配置'
} as const

export function ProjectBinTab({
  bodyRef,
  accSec,
  items,
  /** いま読み込んでいる動画（印を付ける） */
  activePath,
  selectedId,
  srtName,
  cueCount,
  labelGroups,
  onAddFiles,
  onAddFolder,
  onImportSrt,
  onSelect,
  onOpenVideo,
  onRemove,
  onDragStart,
  onDragEnd,
  onPickLabel,
  onVisible
}: {
  bodyRef: RefObject<HTMLDivElement>
  accSec: (
    tab: string,
    key: string,
    label: string,
    count: number | null,
    body: JSX.Element
  ) => JSX.Element
  items: MediaItem[]
  activePath: string | null
  selectedId: number | null
  srtName: string | null
  cueCount: number
  labelGroups: { color: string; name: string; count: number }[]
  onAddFiles: () => void
  onAddFolder: () => void
  onImportSrt: () => void
  onSelect: (id: number) => void
  /** 動画のダブルクリック（読み込み or 案内） */
  onOpenVideo: (item: MediaItem) => void
  onRemove: (id: number) => void
  onDragStart: (item: MediaItem, e: React.DragEvent) => void
  onDragEnd: () => void
  onPickLabel: (color: string) => void
  /** いま見えている素材（サムネと波形は見えている物だけ用意する） */
  onVisible?: (items: MediaItem[]) => void
}): JSX.Element {
  // 素材が何百件あっても、作るのは見えている行だけ。
  // 全部作っていた頃は、別ファイル500件で1操作が 94.5ms まで落ちた。
  const vp = useViewport(bodyRef)
  return (
    <div className="panel-body" ref={bodyRef} onDoubleClick={onAddFiles}>
      <div className="bin-toolbar">
        <button className="btn small" onClick={onAddFiles} title="ファイルを追加">
          ＋ ファイル追加
        </button>
        <button className="btn small" onClick={onAddFolder} title="フォルダごと追加（SE等）">
          📂 フォルダから一括追加
        </button>
        <button className="btn small" onClick={onImportSrt} title="SRT（テロップ）を読み込む">
          🗒 SRT
        </button>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          ダブルクリックでファイル追加
          <br />
          📁ボタンでフォルダ丸ごと追加（SE等）
        </div>
      ) : (
        <div className="media-lib">
          {(['video', 'audio', 'image'] as const).map((kind) => {
            const list = items.filter((m) => m.kind === kind)
            if (!list.length) return null
            return accSec(
              'project',
              kind,
              `${KIND_ICO[kind]} ${KIND_LABEL[kind]}`,
              list.length,
              <VirtualBlock
                items={list}
                viewport={vp}
                className="media-grid"
                grid={{ minWidth: 96, gap: 8 }}
                onVisible={onVisible}
              >
                {(m) => (
                  <div
                    key={m.id}
                    className={`media-card ${m.path === activePath ? 'media-active' : ''} ${
                      selectedId === m.id ? 'media-sel' : ''
                    }`}
                    title={KIND_HINT[m.kind]}
                    draggable={true}
                    onDragStart={(e) => onDragStart(m, e)}
                    onDragEnd={onDragEnd}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(m.id)
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      if (m.kind === 'video') onOpenVideo(m)
                    }}
                  >
                    <button
                      className="media-del"
                      title="プロジェクトから削除"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemove(m.id)
                      }}
                    >
                      ✕
                    </button>
                    <div className="media-thumb">
                      {m.thumb ? (
                        <img src={m.thumb} alt="" />
                      ) : (
                        <span className="media-thumb-ico">{KIND_ICO[m.kind]}</span>
                      )}
                    </div>
                    <div className="media-card-name">{m.name}</div>
                    {/* フォルダ名は空でも場所を取る。高さが揃っていないと、
                        見えていない行ぶんの空きと中身がずれる */}
                    <div className="media-card-sub">{m.folder ? `📁 ${m.folder}` : ''}</div>
                  </div>
                )}
              </VirtualBlock>
            )
          })}
        </div>
      )}

      {srtName && (
        <div className="bin" style={{ marginTop: 8 }}>
          <div className="bin-row">
            <span className="bin-ico">🗒</span>
            <span className="bin-name">{srtName}</span>
            <span className="bin-meta">{cueCount}項目</span>
          </div>
        </div>
      )}

      {labelGroups.length > 0 && (
        <div className="label-groups">
          <div className="lg-head">カラーラベル（クリックでまとめて選択）</div>
          {labelGroups.map((g) => (
            <div
              key={g.color}
              className="lg-row"
              onClick={() => onPickLabel(g.color)}
              title={`${g.name} を全て選択`}
            >
              <span className="lg-swatch" style={{ background: g.color }} />
              <span className="lg-name">{g.name}</span>
              <span className="lg-count">{g.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
