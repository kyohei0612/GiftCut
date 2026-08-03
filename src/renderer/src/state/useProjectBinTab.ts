// 右パネル「プロジェクト（素材の置き場）」タブの配線。
// **画面（ProjectBinTab）が要る形にして渡す。**
//
// なぜ画面から出したか・`useAppWiring` が太らない理由は `state/useIconTab` の冒頭に
// 1つだけ書いてある（同じ話を5回書かない）。
//
// ## まとめ選択は「押した順」を覚える
//
// そのままの順でタイムラインへ並べるため。範囲（Shift）と全部は
// **画面に並んでいる順**＝名前順で若い方から入れる。
import { toggleSelect } from '../../../shared/clipEdit'
import type { MediaItem } from '../components/panels/ProjectBinTab'
import { useRightPanel } from './rightPanelContext'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useMediaCtx } from './mediaContext'
import { useToastCtx } from './toastContext'
import { useDragPreviewCtx } from './dragPreviewContext'

export function useProjectBinTab() {
  const {
    rightBodyRef, accSec, srtPath, labelGroups, addFilesToProject, addFolderToProject,
    handleImportSrt, addMediaAtPlayhead, loadVideo, removeMedia, importSeInto,
    beginMediaDrag, draggingMediaRef, selectByLabel, genThumbFor, prepareMediaMeta, setOrgMenu
  } = useRightPanel()
  const { cues } = useDoc()
  const { selectedMediaIds, setSelectedMediaIds } = useSel()
  const { videoPath, mediaItems } = useMediaCtx()
  const { showToast } = useToastCtx()
  const { setSeGhost, setVideoGhost, setImgGhost } = useDragPreviewCtx()

  return {
    bodyRef: rightBodyRef,
    accSec,
    items: mediaItems,
    activePath: videoPath,
    selectedIds: selectedMediaIds,
    srtName: srtPath ? (srtPath.split(/[\\/]/).pop() ?? null) : null,
    cueCount: cues.length,
    labelGroups,
    onAddFiles: addFilesToProject,
    onAddFolder: addFolderToProject,
    onImportSrt: handleImportSrt,
    onAddAtPlayhead: addMediaAtPlayhead,
    onSelect: (id: number, mode: 'toggle' | 'range' | 'one', shown: number[]): void =>
      setSelectedMediaIds((prev) => {
        if (mode === 'toggle') return toggleSelect(prev, id)
        if (mode !== 'range' || !prev.length) return [id]
        const from = shown.indexOf(prev[prev.length - 1])
        const to = shown.indexOf(id)
        if (from < 0 || to < 0) return [id]
        const [a, b] = from <= to ? [from, to] : [to, from]
        return shown.slice(a, b + 1)
      }),
    /**
     * ダブルクリック。**何も読み込んでいなければ読み込む。**
     * 既に編集中なら**タイムラインを壊さない**（ダブルクリックで全消しは事故になる）
     */
    onOpenVideo: (m: MediaItem): void => {
      if (!videoPath) void loadVideo(m.path)
      else showToast('タイムラインへドラッグして配置してください（Ctrl+ドロップで挿入）。')
    },
    onRemove: removeMedia,
    /**
     * 右クリックの品書き。**音はここから SE へ送れるようにしてある**——
     * プロジェクトに入れても SE の一覧には出てこないので、
     * 「入れたのに使えない」で止まっていた（案内文も SE を指していた）
     */
    onContextMenu: (m: MediaItem, e: React.MouseEvent): void => {
      const opts: { label: string; act: () => void }[] = []
      if (m.kind === 'audio')
        opts.push({
          label: '🔊 SE へ入れる（右の SE タブに並びます）',
          act: (): void => void importSeInto([m.path])
        })
      opts.push({ label: '▶ 再生ヘッドの位置へ置く', act: (): void => addMediaAtPlayhead(m) })
      opts.push({ label: '✕ プロジェクトから削除', act: (): void => removeMedia(m.id) })
      setOrgMenu({ x: e.clientX, y: e.clientY, options: opts })
    },
    onDragStart: beginMediaDrag,
    onDragEnd: (): void => {
      draggingMediaRef.current = null
      setSeGhost(null)
      setVideoGhost(null)
      setImgGhost(null)
    },
    onPickLabel: selectByLabel,
    /** 見えた物のサムネと波形を用意する。**どちらも「同じ物は1回だけ」**なので増えない */
    onVisible: (vis: MediaItem[]): void => {
      for (const m of vis) {
        if (m.kind === 'video') genThumbFor(m.id, m.path)
        prepareMediaMeta(m.path, m.kind)
      }
    }
  }
}
