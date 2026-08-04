// 右パネル「SE（効果音）」タブの配線。**画面（SeLibraryTab）が要る形にして渡す。**
//
// なぜ画面から出したか・`useAppWiring` が太らない理由は `state/useIconTab` の冒頭に
// 1つだけ書いてある（同じ話を5回書かない）。
//
// ※ **効果音は「素材」として掴ませる。** 掴む・置くの入口は素材ビンと同じ物を通す
//   （`beginMediaDrag` / `addMediaAtPlayhead`）。別の道を作ると、
//   置ける段の決まりが2つになる。
import { useLibraryCtx } from './libraryContext'
import { seMoveTarget, type SeItem } from '../components/panels/SeLibraryTab'
import { useRightPanel } from './rightPanelContext'
import { useDragPreviewCtx } from './dragPreviewContext'

export function useSeTab() {
  const {
    rightBodyRef, previewSE, beginMediaDrag, addMediaAtPlayhead, draggingMediaRef
  } = useRightPanel()
  // 置き場（★・フォルダ・畳み）は**配線を通さず、直に見に行く**
  //（2026-08-04。往復していた34個を state/libraryContext へ寄せた）
  const {
    seLibrary, seFolders, seOv, seFavs, accSec, addSeFolder, deleteSeFolder, refreshSE,
    importSeInto, setSeFolderOf, toggleSeFav, setOrgMenu
  } = useLibraryCtx()
  const { setSeGhost } = useDragPreviewCtx()

  /** 効果音を「素材」として扱うときの形（掴む・置くは素材ビンと同じ道を通る） */
  const asMedia = (s: SeItem): { id: number; path: string; name: string; kind: 'audio' } => ({
    id: -1,
    path: s.path,
    name: s.name,
    kind: 'audio'
  })

  return {
    library: seLibrary,
    folders: seFolders,
    moved: seOv,
    favorites: seFavs,
    bodyRef: rightBodyRef,
    accSec,
    onAddFolder: addSeFolder,
    onDeleteFolder: deleteSeFolder,
    onRefresh: refreshSE,
    onImport: (): void => void importSeInto(),
    onImportFolder: (): void => void importSeInto('folder'),
    onDropPaths: (paths: string[]): void => void importSeInto(paths),
    onPreview: previewSE,
    onMoveTo: setSeFolderOf,
    onToggleFav: toggleSeFav,
    onDragStart: (s: SeItem, e: React.DragEvent): void => beginMediaDrag(asMedia(s), e),
    onAddAtPlayhead: (s: SeItem): void => addMediaAtPlayhead(asMedia(s)),
    onDragEnd: (): void => {
      draggingMediaRef.current = null
      setSeGhost(null)
    },
    /** 右クリックの品書き。移動先＝もとのフォルダ（SE/ の中の名前）＋自分で作った物 */
    onContextMenu: (s: SeItem, cur: string, e: React.MouseEvent): void => {
      const dests = [
        ...Array.from(new Set(seLibrary.map((x: { category: string }) => x.category))).map((c) => ({
          key: c,
          label: c,
          custom: false
        })),
        ...seFolders.map((f: { key: string; label: string }) => ({
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
            act: (): void => setSeFolderOf(s.path, seMoveTarget(s, d.key))
          })),
          {
            label: seFavs.includes(s.path) ? '★ お気に入り解除' : '☆ お気に入りに追加',
            act: (): void => toggleSeFav(s.path)
          }
        ]
      })
    }
  }
}
