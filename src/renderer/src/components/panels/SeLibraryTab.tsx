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
  onImport,
  onImportFolder,
  onDropPaths,
  onPreview,
  onMoveTo,
  onToggleFav,
  onDragStart,
  onAddAtPlayhead,
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
  /** 音のファイルを選んで入れる */
  onImport: () => void
  /** フォルダを選んで、そのフォルダごと分類として入れる */
  onImportFolder: () => void
  /** 掴んで落とされた物（ファイル・フォルダのパス）を入れる */
  onDropPaths: (paths: string[]) => void
  onPreview: (path: string) => void
  /** null = もとのフォルダへ戻す */
  onMoveTo: (path: string, folder: string | null) => void
  onToggleFav: (path: string) => void
  onDragStart: (item: SeItem, e: React.DragEvent) => void
  /** ダブルクリックで再生ヘッドの位置へ足す */
  onAddAtPlayhead: (item: SeItem) => void
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
      // 置き場所を指したいときだけドラッグ。**とりあえず今いる所に足す**のは
      // ダブルクリックで済ませる（試聴は1クリックのまま残す）
      onDoubleClick={() => onAddAtPlayhead(s)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(s, effective(s), e)
      }}
      title="ドラッグでタイムラインに配置 / ダブルクリックで再生ヘッドへ / クリックで試聴 / 右クリックでフォルダ移動"
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
    <div
      className="panel-body"
      ref={bodyRef}
      // **掴んで落とせる。** 一覧に「ここへ入れて」と書くだけでは入口にならない。
      // ファイルはそのまま、フォルダは名前ごと（畳んだ分類として）入る。
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        // Electron では File にファイルの場所が入っている
        const paths = [...e.dataTransfer.files]
          .map((f) => (f as File & { path?: string }).path ?? '')
          .filter(Boolean)
        if (paths.length) onDropPaths(paths)
      }}
    >
      {/* **入れる口を先頭に置く。**
          物が1つも無いのに「フォルダ作成」（＝分類する箱）が先頭に居ると、
          最初にやりたいこと（入れる）へ辿り着けない。並びはプロジェクトに揃える。 */}
      <div className="bin-toolbar">
        <button className="btn small" title="音のファイルを選んで入れる" onClick={onImport}>
          ＋ 音を追加
        </button>
        <button
          className="btn small"
          title="フォルダを選ぶと、そのフォルダごと分類として入ります"
          onClick={onImportFolder}
        >
          📂 フォルダごと追加
        </button>
        <button className="btn small" title="分類（アプリの中だけの箱）を作る" onClick={onAddFolder}>
          📁＋ フォルダ作成
        </button>
        <button
          className="btn small"
          title="置き場を読み直す"
          style={{ marginLeft: 'auto' }}
          onClick={onRefresh}
        >
          ↻ 更新
        </button>
      </div>
      {library.length === 0 ? (
        <div className="empty">
          まだ音がありません。
          <br />
          <b>ここへ掴んで落とす</b>か、上の「＋ 音を追加」から入れてください。
          <br />
          フォルダごと落とせば、そのまま分類になります。
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
