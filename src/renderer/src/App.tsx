



// 取り込んで置いてある動きの見本帳（motion-presets/*.json の1件ぶん）




import { defaultTelopStyle } from './lib/telopStyle'
import {
  loadUserTemplates,
  loadFavorites,
  loadCatOverrides,
  loadCustomCats
} from './lib/telopTemplates'




import {  loadIconAssign,   } from './lib/iconLibrary'

import type {} from '../../preload/index.d'







import { StatusBar } from './components/StatusBar'



















// 時間計算はすべて shared/timeline に集約（ズレの一元管理）。
// ここに同じ計算を書き直さないこと。不変条件は timeline.test.ts が守っている。
import { formatTimecode } from '../../shared/timeline'


// キーフレーム（時間で変わる値）。プレビューも書き出しも同じ計算を使う





import { LayoutProvider,  } from './state/layoutContext'

import type { PaneId } from './state/usePanelLayout'

import { SelectionProvider,  } from './state/selectionContext'

import { ContentProvider,  } from './state/contentContext'

import { useTracks } from './state/useTracks'

import { useView } from './state/useView'

import { useToast } from './state/useToast'

import { TracksProvider,  } from './state/tracksContext'

import { ViewProvider,  } from './state/viewContext'





















import type {  } from './state/useExportSettings'

import { LeftPanelProvider,   } from './state/leftPanelContext'
import { Workspace } from './components/panels/Workspace'
import { MenusProvider,   } from './state/menusContext'
import { HeaderProvider } from './state/headerContext'
import { TimelineOpsProvider } from './state/timelineOpsContext'
import { TimelineViewProvider } from './state/timelineViewContext'
import { useAppWiring } from './state/useAppWiring'


import { FPS, RECENT_KEY, RECENT_MAX,   } from './lib/appConst'


import type {  } from './components/panels/ProjectBinTab'










import { AppMenus } from './components/AppMenus'














import { PreviewProvider,   } from './state/previewContext'


import { RightPanelProvider,   } from './state/rightPanelContext'


import { AppHeader } from './components/panels/AppHeader'

import { DialogsProvider,   } from './state/dialogsContext'

import { AppDialogs } from './components/panels/AppDialogs'

// 寄れる限界。バー・ホイール・フィットで同じ物を使う

import { ToasterProvider,  } from './state/toastContext'


import { IconsProvider,  } from './state/iconsContext'

import { ExportProvider,  } from './state/exportContext'

import { MediaProvider,  } from './state/mediaContext'





import { loadJson, loadRecentProjects, useProjectState } from './state/useProjectState'

import { ProjectStateProvider,  } from './state/projectStateContext'

import { DEFAULT_TRACKS,  initTrackStates } from './lib/trackState'


import { useDragPreview } from './state/useDragPreview'

import { DragPreviewProvider,  } from './state/dragPreviewContext'



import { ClipboardProvider,  } from './state/clipboardContext'



import { usePlayback } from './state/usePlayback'

import { PlaybackProvider,  } from './state/playbackContext'













import type {  } from './components/timeline/ClipBand'
















// 書き出しに渡す中身の組み立て（画面に依らない・単体で確かめてある）

// 押されたキーをどの操作に割り当てるか（受ける/受けないの判断もこちら）

// テンプレートを開いたとき、いまの設定とどう混ぜるか（置き換えない）

// ビンの素材が使用中か（＝クリップが残っているか）の判定



// 初期トラック（映像は先頭に連続、音声はその後に連続）。+ボタンで増やせる。
// 既定で用意する追加音声トラック（クイック追加ボタンの対象・旧プロジェクト補完先）

// キーボードの割り当て表は shared/shortcuts.ts（既定・一覧・見やすい表記）



/**
 * 画面の中身。
 *
 * **囲い（App）と分けてあるのは、配置を context から見に行くため。**
 * 同じ部品の中で囲いを作ると、その部品自身は中を見に行けない。
 */
function AppInner(): JSX.Element {
  // **配線は state/useAppWiring。** ここは「画面は何でできているか」だけを持つ。
  const {
    PANE_LABEL, appVersion, autosaveNg, cues, dialogs, dragTip, header, isPopped, leftPanel,
    menus, paneGeom, playRateUI, previewCtx, ratio, rightPanel, startResize, timelineOps,
    timelineView, tool, unpopPane, selectedIds, selectedVideoIds, selectedAudioIds, selectedSeIds,
    selectedImgIds, selectedVClipIds, selectedTrans, selectedTelopTrans, selectedMarkerId,
    selectedTrackId, currentTime, fps
  } = useAppWiring()

  return (
    <TimelineOpsProvider value={timelineOps}>
    <TimelineViewProvider value={timelineView}>
    <PreviewProvider value={previewCtx}>
    <LeftPanelProvider value={leftPanel}>
    <RightPanelProvider value={rightPanel}>
    <HeaderProvider value={header}>
    <MenusProvider value={menus}>
    <DialogsProvider value={dialogs}>
    <div
      className="app"
      // 素材をドラッグしている間は、アプリのどこにいても受け付ける。
      // 受け付けない場所があると、そこだけ 🚫（駐禁）が出て「置けない場所」に見える。
    >
      {/* 画面のいちばん上（更新の帯とメニューバー）は components/panels/AppHeader.tsx */}
      <AppHeader />

      {/* 作業する所（左・プレビュー・右・タイムライン）の並べ方は
          components/panels/Workspace.tsx。中身は各区画が心臓から自分で見に行く */}
      <Workspace
        PANE_LABEL={PANE_LABEL} isPopped={isPopped} paneGeom={paneGeom}
        unpopPane={unpopPane} startResize={startResize}
      />

      {/* 一番下の帯は components/StatusBar.tsx */}
      <StatusBar
        telopCount={cues.length}
        selection={{
          telop: selectedIds.length,
          video: selectedVideoIds.length,
          audio: selectedAudioIds.length,
          se: selectedSeIds.length,
          image: selectedImgIds.length,
          vclip: selectedVClipIds.length,
          trans: !!selectedTrans,
          telopTrans: !!selectedTelopTrans,
          marker: selectedMarkerId != null,
          track: selectedTrackId
        }}
        tool={tool}
        ratio={ratio}
        playhead={formatTimecode(currentTime, fps)}
        shuttleRate={playRateUI}
        poppedPanes={(['left', 'preview', 'right', 'timeline'] as PaneId[])
          .filter((id) => isPopped(id))
          .map((id) => ({ id, label: PANE_LABEL[id] }))}
        autosaveNg={autosaveNg}
        appVersion={appVersion}
        onDock={(id) => unpopPane(id as PaneId)}
      />

      {/* ===== ドラッグ中の時間ツールチップ ===== */}
      {dragTip && (
        <div className="drag-tip" style={{ left: dragTip.x + 14, top: dragTip.y - 28 }}>
          {dragTip.text}
        </div>
      )}

      {/* 画面に覆いかぶさる物は components/panels/AppDialogs.tsx */}
      <AppDialogs />

      {/* 右クリックで出る品書き（何を並べるか）は components/AppMenus.tsx。
          出す入れ物そのものは components/ContextMenu.tsx に1つだけ置いてある。 */}
      <AppMenus />
    </div>
    </DialogsProvider>
    </MenusProvider>
    </HeaderProvider>
    </RightPanelProvider>
    </LeftPanelProvider>
    </PreviewProvider>
    </TimelineViewProvider>
    </TimelineOpsProvider>
  )
}

/**
 * 入口。**中身を囲うだけ**で、ここには処理を書かない。
 *
 * 区画（左パネル・プレビュー・タイムライン…）を切り出していくと、
 * それぞれが `useLayout()` などで必要な物を自分で見に行く形になる。
 * その囲いをここに並べる。
 */
export default function App(): React.JSX.Element {
  // **中身はここで作る。** 囲いの中で作ると、描き直すたびに作り直されて
  // 持っていた値が消える（段の鍵や拡大率が勝手に戻る形で出る）
  const tracks = useTracks(DEFAULT_TRACKS, initTrackStates)
  const view = useView()
  const toast = useToast()
  const playback = usePlayback(FPS)
  const dragPreview = useDragPreview()
  const projectState = useProjectState({
    favorites: loadFavorites(),
    catOverrides: loadCatOverrides(),
    customCats: loadCustomCats(),
    userTemplates: loadUserTemplates(),
    iconAssign: loadIconAssign(),
    laneIconAssign: loadJson<Record<string, string>>('giftcut.laneIconAssign', {}),
    recentProjects: loadRecentProjects(RECENT_KEY, RECENT_MAX),
    newTelopStyle: defaultTelopStyle()
  })
  return (
    <LayoutProvider>
      <SelectionProvider>
        <ContentProvider>
          <TracksProvider value={tracks}>
            <ViewProvider value={view}>
              <ToasterProvider value={toast}>
                <IconsProvider>
                  <PlaybackProvider value={playback}>
                    <ExportProvider>
                      <MediaProvider>
                        <ProjectStateProvider value={projectState}>
                          <ClipboardProvider>
                            <DragPreviewProvider value={dragPreview}>
                              <AppInner />
                            </DragPreviewProvider>
                          </ClipboardProvider>
                        </ProjectStateProvider>
                      </MediaProvider>
                    </ExportProvider>
                  </PlaybackProvider>
                </IconsProvider>
              </ToasterProvider>
            </ViewProvider>
          </TracksProvider>
        </ContentProvider>
      </SelectionProvider>
    </LayoutProvider>
  )
}
