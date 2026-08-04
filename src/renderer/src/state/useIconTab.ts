// 右パネル「アイコン」タブの配線。**画面（IconLibraryTab）が要る形にして渡す。**
//
// ## なぜ画面から出したか（2026-08-04）
//
// この配線は `components/panels/RightPanelArea.tsx` の JSX の中に直書きされていた。
// あの区画は5つのタブぶんを1つの心臓（81個）から取り出して配る役で、
// **配るだけでなく、タブごとの糊まで抱えていた**——アイコンタブだけで52行のうち
// 35行が `onApplyToSelection` と `onContextMenu` の中身だった。
//
// 困るのは行数ではなく、**「アイコンタブに何が要るか」がどこにも書いていない**こと。
// 81個の束から必要な物を拾う所と、糊と、JSX が同じ場所で混ざっていた。
//
// → タブ1つにつきフック1つ。**受け取る物の一覧＝画面が要る物の一覧**になり、
//   区画の側は `<IconLibraryTab {...useIconTab()} />` だけになる。
//
// ## `useAppWiring` は1行も増えない
//
// このフックは**自分で心臓を見に行く**（`useRightPanel` / `useDoc` / `useSel`）。
// 配線の大元を経由しないので、あちらは太らない。
//
// ※ **名前の付け替えはここでやる。** 画面側は `library` / `folders` / `moved` と
//   自分の言葉で受けており、配線側の `iconLibrary` / `iconOv` とは別の語彙。
//   混ぜると、どちらかの都合でもう片方の名前が変わる。
import { useBandDragCtx } from './bandDragContext'
import { useLibraryCtx } from './libraryContext'
import { ICON_LIB, type IconItem } from '../components/panels/IconLibraryTab'
import { useRightPanel } from './rightPanelContext'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'

export function useIconTab() {
  const {
    iconLibrary, rightBodyRef, addIconImages, addIconFiles, removeIconImage
  } = useRightPanel()
  const { draggingIconRef } = useBandDragCtx()
  // 置き場（★・フォルダ・畳み）は**配線を通さず、直に見に行く**
  //（2026-08-04。往復していた34個を state/libraryContext へ寄せた）
  const {
    iconFolders, iconOv, iconFavs, accSec, addIconFolder, deleteIconFolder, toggleIconFav,
    setOrgMenu, setIconFolderOf
  } = useLibraryCtx()
  const { setCues } = useDoc()
  const { selectedIds, isSelected } = useSel()

  return {
    library: iconLibrary,
    folders: iconFolders,
    moved: iconOv,
    favorites: iconFavs,
    bodyRef: rightBodyRef,
    accSec,
    onAddImages: addIconImages,
    onDropFiles: addIconFiles,
    onAddFolder: addIconFolder,
    onDeleteFolder: deleteIconFolder,
    onDelete: removeIconImage,
    onToggleFav: toggleIconFav,
    /** 選んでいるテロップ全部に付ける。**人物アイコンは外す**（両方は出せない） */
    onApplyToSelection: (image: string): void => {
      if (!selectedIds.length) return
      setCues((prev) =>
        prev.map((c) => (isSelected(c.id) ? { ...c, iconImage: image, personIcon: undefined } : c))
      )
    },
    onDragStart: (image: string): void => {
      draggingIconRef.current = image
    },
    onDragEnd: (): void => {
      draggingIconRef.current = null
    },
    /** 右クリックの品書き。移動先の一覧＋お気に入りの切り替え */
    onContextMenu: (it: IconItem, cur: string, e: React.MouseEvent): void => {
      const dests = [
        { key: ICON_LIB, label: 'アイコン画像', custom: false },
        ...iconFolders.map((f: { key: string; label: string }) => ({
          key: f.key,
          label: f.label,
          custom: true
        }))
      ]
      setOrgMenu({
        x: e.clientX,
        y: e.clientY,
        options: [
          ...dests.map((d) => ({
            label: `${cur === d.key ? '✓ ' : ''}${d.custom ? '📁 ' : ''}${d.label}`,
            checked: cur === d.key,
            act: (): void => setIconFolderOf(String(it.id), d.key === ICON_LIB ? null : d.key)
          })),
          {
            label: iconFavs.includes(String(it.id)) ? '★ お気に入り解除' : '☆ お気に入りに追加',
            act: (): void => toggleIconFav(String(it.id))
          }
        ]
      })
    }
  }
}
