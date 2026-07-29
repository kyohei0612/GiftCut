// 右パネルの「アイコン」タブ。テロップの前に出す画像の置き場。
//
// できること: テロップへドラッグして付ける / クリックで選択中のテロップに付ける /
//             右クリックでフォルダ移動 / ★お気に入り / 削除
//
// フォルダは自分で作る物だけ（画像はアプリの中に持っているので、元の場所は無い）。
// 移動先が消えていたら既定の置き場（アイコン画像）に戻して見せる。

import type { JSX } from 'react'

export interface IconItem {
  id: number
  name: string
  image: string
}

/** 既定の置き場のキー */
export const ICON_LIB = 'lib'

export function IconLibraryTab({
  library,
  folders,
  moved,
  favorites,
  bodyRef,
  accSec,
  onAddImages,
  onAddFolder,
  onDeleteFolder,
  onDelete,
  onToggleFav,
  onApplyToSelection,
  onDragStart,
  onDragEnd,
  onContextMenu
}: {
  library: IconItem[]
  folders: { key: string; label: string }[]
  /** 画像ごとの移動先（id → フォルダkey） */
  moved: Record<string, string>
  favorites: string[]
  bodyRef: React.Ref<HTMLDivElement>
  accSec: (
    tab: string,
    key: string,
    label: string,
    count: number | null,
    body: JSX.Element,
    onDelete?: () => void
  ) => JSX.Element
  onAddImages: () => void
  onAddFolder: () => void
  onDeleteFolder: (key: string) => void
  onDelete: (id: number) => void
  onToggleFav: (id: string) => void
  /** クリック＝選んでいるテロップに付ける */
  onApplyToSelection: (image: string) => void
  onDragStart: (image: string) => void
  onDragEnd: () => void
  onContextMenu: (item: IconItem, current: string, e: React.MouseEvent) => void
}): JSX.Element {
  // 実効フォルダ（移動先が消えていたら既定の置き場へ）
  const effective = (id: number): string => {
    const ov = moved[String(id)]
    return ov && folders.some((f) => f.key === ov) ? ov : ICON_LIB
  }
  const card = (it: IconItem): JSX.Element => {
    const fav = favorites.includes(String(it.id))
    return (
      <div
        key={it.id}
        className="icon-item"
        title={
          it.name +
          ' — テロップにドラッグ / クリックで選択テロップに適用 / 右クリックでフォルダ移動'
        }
        draggable
        onDragStart={() => onDragStart(it.image)}
        onDragEnd={onDragEnd}
        onClick={() => onApplyToSelection(it.image)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onContextMenu(it, effective(it.id), e)
        }}
      >
        <button
          className={`icon-fav ${fav ? 'on' : ''}`}
          title="お気に入り"
          onClick={(e) => {
            e.stopPropagation()
            onToggleFav(String(it.id))
          }}
        >
          {fav ? '★' : '☆'}
        </button>
        <button
          className="icon-del"
          title="ライブラリから削除"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(it.id)
          }}
        >
          ✕
        </button>
        <img src={it.image} alt="" />
      </div>
    )
  }
  const favList = library.filter((it) => favorites.includes(String(it.id)))
  const libList = library.filter((it) => effective(it.id) === ICON_LIB)
  return (
    <div className="panel-body" ref={bodyRef}>
      <div className="bin-toolbar">
        <button className="btn small" onClick={onAddImages} title="画像を追加">
          ＋ 画像追加
        </button>
        <button className="btn small" title="新しいフォルダを作成" onClick={onAddFolder}>
          📁＋ フォルダ作成
        </button>
      </div>
      <div className="tpl-hint">
        テロップにドラッグ＆ドロップで前にアイコン表示。右クリックでフォルダ移動。
      </div>
      {library.length === 0 ? (
        <div className="empty">
          ＋画像追加で
          <br />
          アイコン画像を登録
        </div>
      ) : (
        <>
          {favList.length > 0 &&
            accSec('icon', 'fav', '★ お気に入り', favList.length, (
              <div className="icon-grid">{favList.map(card)}</div>
            ))}
          {folders.map((f) => {
            const list = library.filter((it) => effective(it.id) === f.key)
            return accSec(
              'icon',
              f.key,
              `📁 ${f.label}`,
              list.length,
              list.length ? (
                <div className="icon-grid">{list.map(card)}</div>
              ) : (
                <div className="tpl-hint" style={{ padding: '6px 2px' }}>
                  空のフォルダです。アイコンを右クリック→このフォルダを選ぶと入ります。
                </div>
              ),
              () => onDeleteFolder(f.key)
            )
          })}
          {libList.length > 0 &&
            accSec('icon', ICON_LIB, '🖼 アイコン画像', libList.length, (
              <div className="icon-grid">{libList.map(card)}</div>
            ))}
        </>
      )}
    </div>
  )
}
