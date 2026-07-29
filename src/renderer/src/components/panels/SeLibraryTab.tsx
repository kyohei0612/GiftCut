// 右パネルの「SE」タブ。GiftCut/SE フォルダにある効果音の一覧。
//
// できること: タイムラインへドラッグで配置 / クリックで試聴 /
//             右クリックでフォルダ移動 / ★お気に入り
//
// フォルダは2種類ある。
//   もとのフォルダ（SE/ の中の実際のフォルダ名）
//   自分で作ったフォルダ（アプリの中だけの分類。ファイルは動かさない）
// 移動先が消えていたら、もとのフォルダに戻して見せる（行方不明にしない）。

import type { JSX, RefObject } from 'react'
import { VirtualBlock } from '../VirtualBlock'
import { useViewport } from '../useVirtual'

export interface SeItem {
  category: string
  name: string
  path: string
}

export function SeLibraryTab({
  library,
  /** 自分で作ったフォルダ */
  folders,
  /** 素材ごとの移動先（path → フォルダkey） */
  moved,
  favorites,
  bodyRef,
  accSec,
  onAddFolder,
  onDeleteFolder,
  onRefresh,
  onPreview,
  onMoveTo,
  onToggleFav,
  onDragStart,
  onDragEnd,
  onContextMenu
}: {
  library: SeItem[]
  folders: { key: string; label: string }[]
  moved: Record<string, string>
  favorites: string[]
  bodyRef: RefObject<HTMLDivElement>
  accSec: (
    tab: string,
    key: string,
    label: string,
    count: number | null,
    body: JSX.Element,
    onDelete?: () => void
  ) => JSX.Element
  onAddFolder: () => void
  onDeleteFolder: (key: string) => void
  onRefresh: () => void
  onPreview: (path: string) => void
  /** null = もとのフォルダへ戻す */
  onMoveTo: (path: string, folder: string | null) => void
  onToggleFav: (path: string) => void
  onDragStart: (item: SeItem, e: React.DragEvent) => void
  onDragEnd: () => void
  /** 右クリックで出すメニューの中身は App 側が組む（移動先の一覧＋お気に入り） */
  onContextMenu: (item: SeItem, current: string, e: React.MouseEvent) => void
}): JSX.Element {
  // 効果音は「フォルダ丸ごと」で数百件になる。作るのは見えている行だけ。
  const vp = useViewport(bodyRef)
  const list = (items: SeItem[]): JSX.Element => (
    <VirtualBlock items={items} viewport={vp} className="se-list" grid={{ minWidth: 100000, gap: 3 }}>
      {(s) => row(s)}
    </VirtualBlock>
  )
  const cats = Array.from(new Set(library.map((s) => s.category)))
  // 実効フォルダ（移動先が消えていたら元カテゴリへ）
  const effective = (s: SeItem): string => {
    const ov = moved[s.path]
    return ov && (folders.some((f) => f.key === ov) || cats.includes(ov)) ? ov : s.category
  }
  const row = (s: SeItem): JSX.Element => (
    <div
      key={s.path}
      className="se-item"
      draggable
      onDragStart={(e) => onDragStart(s, e)}
      onDragEnd={onDragEnd}
      onClick={() => onPreview(s.path)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(s, effective(s), e)
      }}
      title="ドラッグでタイムラインに配置 / クリックで試聴 / 右クリックでフォルダ移動"
    >
      <span className="se-play">🔊</span>
      <span className="se-name">{s.name}</span>
      <button
        className={`item-fav ${favorites.includes(s.path) ? 'on' : ''}`}
        title="お気に入り"
        onClick={(e) => {
          e.stopPropagation()
          onToggleFav(s.path)
        }}
      >
        {favorites.includes(s.path) ? '★' : '☆'}
      </button>
    </div>
  )
  const favList = library.filter((s) => favorites.includes(s.path))
  return (
    <div className="panel-body" ref={bodyRef}>
      <div className="bin-toolbar">
        <button className="btn small" title="新しいフォルダを作成" onClick={onAddFolder}>
          📁＋ フォルダ作成
        </button>
        <button
          className="btn small"
          title="GiftCut/SE フォルダを再読み込み"
          style={{ marginLeft: 'auto' }}
          onClick={onRefresh}
        >
          ↻ 更新
        </button>
      </div>
      {library.length === 0 ? (
        <div className="empty">
          SEが見つかりません。
          <br />
          GiftCut/SE フォルダに mp3 を入れてください。
        </div>
      ) : (
        <>
          <div className="tpl-hint">
            タイムラインへドラッグで配置 / クリックで試聴 / 右クリックでフォルダ移動
          </div>
          {favList.length > 0 && accSec('se', 'fav', '★ お気に入り', favList.length, list(favList))}
          {folders.map((f) => {
            const inFolder = library.filter((s) => effective(s) === f.key)
            return accSec(
              'se',
              f.key,
              `📁 ${f.label}`,
              inFolder.length,
              inFolder.length ? (
                list(inFolder)
              ) : (
                <div className="tpl-hint" style={{ padding: '6px 2px' }}>
                  空のフォルダです。SEを右クリック→このフォルダを選ぶと入ります。
                </div>
              ),
              () => onDeleteFolder(f.key)
            )
          })}
          {cats.map((cat) => {
            const inCat = library.filter((s) => effective(s) === cat)
            if (!inCat.length) return null
            return accSec('se', cat, `📁 ${cat}`, inCat.length, list(inCat))
          })}
        </>
      )}
    </div>
  )
}

/** onMoveTo をそのまま使うと「もとのフォルダ＝解除」の判断を毎回書くので、ここに寄せる */
export function seMoveTarget(item: SeItem, folderKey: string): string | null {
  return folderKey === item.category ? null : folderKey
}
