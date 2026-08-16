// 右パネルの「プロジェクト」タブ＝素材の置き場（ビン）。
//
// 読み込んだ動画・音・画像を種類ごとに並べる。タイムラインへはドラッグで置く。
// 読み込んだ SRT と、使っている色ラベルの一覧もここに出す
// （「今このプロジェクトに何があるか」を1か所で見せるため）。

import { useState } from 'react'
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

/** 素材ビンに並べる種類の順。**カードの並びはこの順**（範囲選択もこの順で入る） */
const KIND_ORDER = ['video', 'audio', 'image'] as const

/**
 * **囲って選ぶ**（ラバーバンド）。何も無い所から引いたときだけ始める。
 *
 * カードは掴んでタイムラインへ運ぶ物（`draggable`）なので、**カードの上から
 * 引き始めたら今までどおり「運ぶ」**。Explorer もプレミアも同じ流儀で、
 * ここを取り違えると「選ぼうとしたら置いてしまった」が起きる。
 *
 * 位置は画面座標（`position: fixed`）で持つ。パネルは縦に送れるので、
 * 中身の座標へ直すと送った瞬間に囲いがずれる——**測る物（カードの位置）も
 * 画面座標なので、同じ物差しのまま使う。**
 *
 * ※ **ただ押しただけでは選択を触らない**（4px 動いてから）。触ると
 *   「1つ選んで数値を直そうとしただけ」で選択が消える。
 */
function useBinMarquee(
  bodyRef: RefObject<HTMLDivElement>,
  selectedIds: number[],
  onSelectMany: (ids: number[], base: number[]) => void
): {
  band: { left: number; top: number; width: number; height: number } | null
  onPointerDown: (e: React.PointerEvent) => void
} {
  const [band, setBand] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    const el = e.target as HTMLElement
    // カード・ボタン・節の見出しの上から引き始めたら、それぞれの持ち場に任せる
    if (el.closest('.media-card, button, input')) return
    const x0 = e.clientX
    const y0 = e.clientY
    const base = e.ctrlKey || e.metaKey ? selectedIds : []
    let moved = false
    const onMove = (ev: PointerEvent): void => {
      const left = Math.min(x0, ev.clientX)
      const top = Math.min(y0, ev.clientY)
      const width = Math.abs(ev.clientX - x0)
      const height = Math.abs(ev.clientY - y0)
      if (!moved && width < 4 && height < 4) return
      moved = true
      setBand({ left, top, width, height })
      const root = bodyRef.current
      if (!root) return
      // **並ぶ順のまま拾う**（`querySelectorAll` は画面に出ている順で返す）。
      // 選んだ順＝置く順なので、若い番号から入る
      const ids: number[] = []
      root.querySelectorAll<HTMLElement>('.media-card[data-mid]').forEach((card) => {
        const r = card.getBoundingClientRect()
        const hit =
          r.left < left + width && r.right > left && r.top < top + height && r.bottom > top
        if (hit) ids.push(Number(card.dataset.mid))
      })
      onSelectMany(ids, base)
    }
    const onUp = (): void => {
      setBand(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
  return { band, onPointerDown }
}

export function ProjectBinTab({
  bodyRef,
  accSec,
  items,
  /** いま読み込んでいる動画（印を付ける） */
  activePath,
  selectedIds,
  srtName,
  cueCount,
  labelGroups,
  onAddFiles,
  onAddFolder,
  onImportSrt,
  onSelect,
  onSelectMany,
  onOpenVideo,
  onRemove,
  onDragStart,
  onContextMenu,
  onAddAtPlayhead,
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
  /** 選んでいる素材（**押した順**）。まとめて置くときの並びになる */
  selectedIds: number[]
  srtName: string | null
  cueCount: number
  labelGroups: { color: string; name: string; count: number }[]
  onAddFiles: () => void
  onAddFolder: () => void
  onImportSrt: () => void
  /**
   * 押した。`mode` は Ctrl＝足し引き / Shift＝範囲 / それ以外＝1つだけ。
   * `shown` は**いま並んでいる順**（範囲で選んだときの並びに使う）。
   */
  onSelect: (id: number, mode: 'one' | 'toggle' | 'range', shown: number[]) => void
  /**
   * 囲って選んだ（何も無い所からドラッグ）。`base` は掴み始めた時点の選択
   *（Ctrl のときだけ中身が入る＝足す）。
   */
  onSelectMany: (ids: number[], base: number[]) => void
  /** 動画のダブルクリック（読み込み or 案内） */
  onOpenVideo: (item: MediaItem) => void
  onRemove: (id: number) => void
  onDragStart: (item: MediaItem, e: React.DragEvent) => void
  /** 右クリック（SEへ送る等）。渡さなければ何も出ない */
  onContextMenu?: (item: MediaItem, e: React.MouseEvent) => void
  /** ダブルクリックで再生ヘッドの位置へ足す（音・画像） */
  onAddAtPlayhead: (item: MediaItem) => void
  onDragEnd: () => void
  onPickLabel: (color: string) => void
  /** いま見えている素材（サムネと波形は見えている物だけ用意する） */
  onVisible?: (items: MediaItem[]) => void
}): JSX.Element {
  // 素材が何百件あっても、作るのは見えている行だけ。
  // 全部作っていた頃は、別ファイル500件で1操作が 94.5ms まで落ちた。
  const vp = useViewport(bodyRef)
  const marquee = useBinMarquee(bodyRef, selectedIds, onSelectMany)
  return (
    <div
      className="panel-body"
      ref={bodyRef}
      onDoubleClick={onAddFiles}
      onPointerDown={marquee.onPointerDown}
    >
      {marquee.band && <div className="bin-marquee" style={marquee.band} />}
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
        // **できないことを書かない。**
        // 以前は「フォルダ丸ごと追加（SE等）」と書いてあったが、ここへ入れても
        // SE の一覧には出てこない（SE は SE タブが置き場）。
        // 案内どおりにやったのに使えない、が一番たちが悪い。
        <div className="empty">
          まだ素材がありません。
          <br />
          <b>ここへ掴んで落とす</b>か、上の「＋ ファイル追加」から入れてください。
          <br />
          効果音は右の <b>SE タブ</b>へ入れると、一覧から使えます。
        </div>
      ) : (
        <div className="media-lib">
          {/* **使い方の案内は、物がある時だけ1行。**
              他のタブには出ているのにここだけ無く、
              「置いたあと何ができるのか」がどこにも書いていなかった。 */}
          <div className="tpl-hint">
            タイムラインへドラッグで配置／ダブルクリックで再生ヘッドへ／右クリックで送り先
          </div>
          {KIND_ORDER.map((kind) => {
            const list = items.filter((m) => m.kind === kind)
            // **範囲で選ぶときの並びは「画面に出ている順」。**
            // 素材は種類ごとに section へ分けて並べているので、
            // 渡された順（items のまま）ではカードの並びと一致しない
            // ＝Shift で選んだ範囲が見た目とずれる。ここで組み直す。
            const shownOrder = KIND_ORDER.flatMap((k) =>
              items.filter((m) => m.kind === k).map((m) => m.id)
            )
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
                    // 囲って選ぶときに、ここから id を読む（`useBinMarquee`）
                    data-mid={m.id}
                    className={`media-card ${m.path === activePath ? 'media-active' : ''} ${
                      selectedIds.includes(m.id) ? 'media-sel' : ''
                    }`}
                    title={KIND_HINT[m.kind]}
                    draggable={true}
                    onDragStart={(e) => onDragStart(m, e)}
                    onDragEnd={onDragEnd}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(
                        m.id,
                        e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'range' : 'one',
                        shownOrder
                      )
                    }}
                    // **右クリックで先へ送れるようにする。**
                    // 音をここへ入れても SE の一覧には出てこないので、
                    // 「入れたのに使えない」で手が止まっていた
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onContextMenu?.(m, e)
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      // 動画のダブルクリックは前からある「開く」のまま（意味を変えない）。
                      // 音・画像は置き場所を指す必要が無いので、再生ヘッドへ足す。
                      // ドラッグしないと置けないのは、ただの手間だった。
                      if (m.kind === 'video') onOpenVideo(m)
                      else onAddAtPlayhead(m)
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
