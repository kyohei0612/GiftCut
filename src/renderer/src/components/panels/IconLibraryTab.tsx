// 右パネルの「アイコン」タブ。テロップの前に出す画像の置き場。
//
// できること: テロップへドラッグして付ける / クリックで選択中のテロップに付ける /
//             右クリックでフォルダ移動 / ★お気に入り / 削除
//
// フォルダは自分で作る物だけ（画像はアプリの中に持っているので、元の場所は無い）。
// 移動先が消えていたら既定の置き場（アイコン画像）に戻して見せる。

import type { JSX } from 'react'
// カーソルに何も握らせないための透明な1px。**消し方はここに1つだけ置いてある**
import { EMPTY_DRAG_IMG } from '../../lib/dragChip'

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
  onDropFiles,
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
  /** 掴んで落とされた画像。ボタンから足すのと同じ流れ（切り抜き）へ送る */
  onDropFiles: (files: File[]) => void
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
        // 見本帳のカードと同じ理由でカーソルの絵を消す（置き先は帯で見せている）。
        // 消し方は lib/dragChip の EMPTY_DRAG_IMG に1つだけ置いてある
        onDragStart={(e) => {
          if (EMPTY_DRAG_IMG) e.dataTransfer.setDragImage(EMPTY_DRAG_IMG, 0, 0)
          onDragStart(it.image)
        }}
        onDragEnd={onDragEnd}
        onClick={() => onApplyToSelection(it.image)}
        // 1クリックで付くが、**ダブルクリックでも同じ結果**にしておく。
        // 「素材はダブルクリックで足せる」を全部の置き場で同じにするため
        onDoubleClick={() => onApplyToSelection(it.image)}
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
    <div
      className="panel-body"
      ref={bodyRef}
      // 「ここへ掴んで落とす」と書く以上、本当に落とせること。
      // 案内どおりにやったのに何も起きない、が一番たちが悪い
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
        if (files.length) onDropFiles(files)
      }}
    >
      <div className="bin-toolbar">
        <button className="btn small" onClick={onAddImages} title="画像を追加">
          ＋ 画像追加
        </button>
        <button className="btn small" title="新しいフォルダを作成" onClick={onAddFolder}>
          📁＋ フォルダ作成
        </button>
      </div>
      {/* **使い方の案内は、物がある時だけ。**
          1枚も無い状態で「テロップにドラッグして…」と読ませても、
          ドラッグする物がまだ無い。まず入れる、次に使う、の順にする。 */}
      {library.length > 0 && (
        <div className="tpl-hint">
          テロップにドラッグ＆ドロップで前にアイコン表示。右クリックでフォルダ移動。
        </div>
      )}
      {library.length === 0 ? (
        // 空のときの言い方は、プロジェクト・SE と同じ作法に揃える
        //（片方は「画面で落とす」、片方は「エクスプローラで入れる」だと、
        //  同じパネルの中で作法が割れて、毎回どちらか考えることになる）
        <div className="empty">
          まだアイコンがありません。
          <br />
          <b>ここへ掴んで落とす</b>か、上の「＋ 画像追加」から入れてください。
          <br />
          入れた画像は、テロップの前に付けられます。
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
