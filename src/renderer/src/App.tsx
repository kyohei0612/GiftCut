import { defaultTelopStyle } from './lib/telopStyle'
import {
  loadUserTemplates,
  loadFavorites,
  loadCatOverrides,
  loadCustomCats
} from './lib/telopTemplates'
import { loadIconAssign } from './lib/iconLibrary'
import { loadJson, loadRecentProjects, useProjectState } from './state/useProjectState'
import { DEFAULT_TRACKS, initTrackStates } from './lib/trackState'
import { RECENT_KEY, RECENT_MAX } from './lib/appConst'


import { useTracks } from './state/useTracks'
import { useView } from './state/useView'
import { useToast } from './state/useToast'
import { useDragPreview } from './state/useDragPreview'
import { useAppWiring } from './state/useAppWiring'

import { PANE_LABEL } from './state/usePanelLayout'
import type { PaneId } from './state/usePanelLayout'
import { LayoutProvider } from './state/layoutContext'
import { SelectionProvider } from './state/selectionContext'
import { ContentProvider } from './state/contentContext'
import { SelectedCueProvider } from './state/selectedCueContext'
import { CueIconProvider } from './state/cueIconContext'
import { ContentShiftProvider } from './state/contentShiftContext'
import { TracksProvider } from './state/tracksContext'
import { ViewProvider } from './state/viewContext'
import { ToasterProvider } from './state/toastContext'
// 人に聞く物と、置き場（★・フォルダ）。**配線を通さず、使う側が直に見に行く**
import { AskProvider } from './state/askContext'
import { LibraryProvider } from './state/libraryContext'
// 引数ゼロの葉。**配線を通さず、使う側が直に見に行く**（npm run passthrough）
import { AppChromeProvider } from './state/appChromeContext'
import { BandDragProvider } from './state/bandDragContext'
import { SubtitlePrefsProvider } from './state/subtitlePrefsContext'
import { ShortcutPrefsProvider } from './state/shortcutPrefsContext'
import { LaneHeightsProvider } from './state/laneHeightsContext'
import { LaneGeometryProvider } from './state/laneGeometryContext'
import { SegLayoutProvider } from './state/segLayoutContext'
import { TrackGeomProvider } from './state/trackGeomContext'
import { IconsProvider } from './state/iconsContext'
import { PlaybackProvider } from './state/playbackContext'
import { ExportProvider } from './state/exportContext'
import { MediaProvider } from './state/mediaContext'
import { ProjectStateProvider } from './state/projectStateContext'
import { ClipboardProvider } from './state/clipboardContext'
import { DragPreviewProvider } from './state/dragPreviewContext'
import { TimelineOpsProvider } from './state/timelineOpsContext'
import { TimelineViewProvider } from './state/timelineViewContext'
import { PreviewProvider } from './state/previewContext'
import { LeftPanelProvider } from './state/leftPanelContext'
import { RightPanelProvider } from './state/rightPanelContext'
import { HeaderProvider } from './state/headerContext'
import { MenusProvider } from './state/menusContext'
import { DialogsProvider } from './state/dialogsContext'
import { TimelineBoxProvider } from './state/timelineBoxContext'
import { VideoElsProvider } from './state/videoElsContext'
import { SeAudioProvider } from './state/seAudioContext'
import { TracksAdminProvider } from './state/tracksAdminContext'
import { TimelineSpanProvider } from './state/timelineSpanContext'
import { ProxyProvider } from './state/proxyContext'
import { SnapProvider } from './state/snapContext'
import { SegOpsProvider } from './state/segOpsContext'
import { NowShowingProvider } from './state/nowShowingContext'
import { EditProvider } from './state/editContext'
import { TelopLookProvider } from './state/telopLookContext'
import { LabelsPresetsProvider } from './state/labelsPresetsContext'
import { SilenceDuckProvider } from './state/silenceDuckContext'
import { VClipElsProvider } from './state/vClipElsContext'
import { TemplateShelfProvider } from './state/templateShelfContext'
import { TelopEditProvider } from './state/telopEditContext'
import { AttrCopyProvider } from './state/attrCopyContext'
import { LaneResizeProvider } from './state/laneResizeContext'
import { CurrentLookProvider } from './state/currentLookContext'
import { HistoryProvider } from './state/historyContext'
// 履歴の控えを見るので、**History の内側**に置く（理由は mediaMetaContext.tsx）
import { MediaMetaProvider } from './state/mediaMetaContext'
import { PreviewFrameProvider } from './state/previewFrameContext'
import { AppLayoutProvider } from './state/appLayoutContext'
import { TransitionsProvider } from './state/transitionsContext'
import { TelopAnimProvider } from './state/telopAnimContext'
import { PlaybackEngineProvider } from './state/playbackEngineContext'
import { ViewNavProvider } from './state/viewNavContext'
import { MotionProvider } from './state/motionContext'
import { MarkersProvider } from './state/markersContext'
import { TelopBoxProvider } from './state/telopBoxContext'
import { SubtitlesProvider } from './state/subtitlesContext'
import { MediaOpsProvider } from './state/mediaOpsContext'
import { TimelineDragProvider } from './state/timelineDragContext'
import { CopyPasteProvider } from './state/copyPasteContext'
import { ScreenshotProvider } from './state/screenshotContext'
import { SegmentPlaceProvider } from './state/segmentPlaceContext'
import { AutosaveMarkProvider } from './state/autosaveMarkContext'
import { TelopTemplateProvider } from './state/telopTemplateContext'
import { ExportRunProvider } from './state/exportRunContext'
import { ProjectGuardProvider } from './state/projectGuardContext'
import { MediaDropProvider } from './state/mediaDropContext'
import { TimelineEditProvider } from './state/timelineEditContext'
import { ProjectFileProvider } from './state/projectFileContext'
import { ProjectIOProvider } from './state/projectIOContext'
import { SegmentDragProvider } from './state/segmentDragContext'
import { IconLibraryProvider } from './state/iconLibraryContext'
import { PreviewManipProvider } from './state/previewManipContext'
import { ProjectTemplatesProvider } from './state/projectTemplatesContext'

import { AppHeader } from './components/panels/AppHeader'
import { Workspace } from './components/panels/Workspace'
import { StatusBar } from './components/StatusBar'
import { AppDialogs } from './components/panels/AppDialogs'
import { AppMenus } from './components/AppMenus'

/**
 * 画面の中身。
 *
 * **囲い（App）と分けてあるのは、配置を context から見に行くため。**
 * 同じ部品の中で囲いを作ると、その部品自身は中を見に行けない。
 */
function AppInner(): JSX.Element {
  // **配線は state/useAppWiring。** ここは「画面は何でできているか」だけを持つ。
  const {
    appVersion, autosaveNg, cues, dialogs, dragTip, header, isPopped, leftPanel,
    menus, paneGeom, playRateUI, previewCtx, rightPanel, startResize, timelineOps,
    timelineView, tool, unpopPane, selectedIds, selectedVideoIds, selectedAudioIds, selectedSeIds,
    selectedImgIds, selectedVClipIds, selectedTrans, selectedTelopTrans, selectedMarkerId,
    selectedTrackId
  } = useAppWiring()
  // **`currentTime` / `fps` / `ratio` はここでは受け取らない。**
  // 下の帯から時刻と比率を外した（重複表示。理由は StatusBar.tsx）ので要らなくなった。
  // 特に `currentTime` は**再生中こコマ変わる**ので、受け取ると
  // 画面の骨格ごと描き直されることになる。要る所（モニタ）が自分で見に行く。

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
        isPopped={isPopped} paneGeom={paneGeom}
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
 * 囲いを**縦に並べる**（入れ子で書かない）。
 *
 * ## なぜ（2026-08-04）
 *
 * 配線を剥がすたびに囲いが1本増える。入れ子で書くと**1本足すだけで
 * 中の全行がずれる**ので、差分が読めなくなり、閉じ忘れも起きる。
 * 40段を超えたあたりで行が右端に張り付いて折り返しも始まった。
 *
 * **並びの意味は入れ子と同じ**——`layers` の**先に書いた物が外側**で、
 * 先に作られる。効果（useEffect）は**内側が先**に走る。この順は
 * 事故を1度起こしている（起動直後にセッションを空で上書き）ので、
 * 並べ替えるときは e2e を通すこと。
 *
 * **1行1本を、普通の JSX のまま書く。** `React.cloneElement` で children を
 * 後から差し込む形も試したが、`children` が必須の囲いが型で全部落ちる
 * （その回避に `any` が要る）ので採らなかった。値を渡す囲いも同じ1行で書ける。
 */
function nest(layers: Wrap[], leaf: React.JSX.Element): React.JSX.Element {
  return layers.reduceRight((inner, wrap) => wrap(inner), leaf)
}

/** 中身を1枚くるむ物。`(c) => <XProvider>{c}</XProvider>` と書く */
type Wrap = (children: React.JSX.Element) => React.JSX.Element

/**
 * 入口。**中身を囲うだけ**で、ここには処理を書かない。
 *
 * 区画（左パネル・プレビュー・タイムライン…）は、それぞれが `useLayout()` などで
 * 必要な物を自分で見に行く。その囲いをここに並べる。
 */
export default function App(): React.JSX.Element {
  // **中身はここで作る。** 囲いの中で作ると、描き直すたびに作り直されて
  // 持っていた値が消える（段の鍵や拡大率が勝手に戻る形で出る）
  const tracks = useTracks(DEFAULT_TRACKS, initTrackStates)
  const view = useView()
  const toast = useToast()
  const dragPreview = useDragPreview()
  // **読むのは起動時の1回だけ。** 出来上がった値を渡すと、画面が描き直される
  // たびに localStorage から8つ読んで JSON を解析することになる（使うのは初回だけ）。
  // 実データではアイコンの割り当てだけで 0.6MB あり、再生ヘッドを掴んでいる間の
  // 計測で `loadIconAssign` が上位に出てきた（2026-08-03）。
  const projectState = useProjectState({
    favorites: loadFavorites,
    catOverrides: loadCatOverrides,
    customCats: loadCustomCats,
    userTemplates: loadUserTemplates,
    iconAssign: loadIconAssign,
    laneIconAssign: () => loadJson<Record<string, string>>('giftcut.laneIconAssign', {}),
    // 人物ごとの縁色・見た目。**アイコンの割り当てと同じ置き方**にしてある
    //（localStorage に覚え、プロジェクトにも保存する）
    iconRing: () => loadJson<Record<string, string>>('giftcut.iconRing', {}),
    iconTemplate: () => loadJson<Record<string, string>>('giftcut.iconTemplate', {}),
    recentProjects: () => loadRecentProjects(RECENT_KEY, RECENT_MAX),
    newTelopStyle: defaultTelopStyle
  })
  // **先に書いた物が外側**（＝先に作られる）。下の物は上の物を見に行ける。
  // 効果（useEffect）は逆に**下から**走ることに注意（`nest` の説明）。
  return nest(
    [
      (c) => <LayoutProvider>{c}</LayoutProvider>,
      (c) => <SelectionProvider>{c}</SelectionProvider>,
      (c) => <ContentProvider>{c}</ContentProvider>,
      // 選んだ物と中身の**両方**を見るので、この2つより内側
      (c) => <SelectedCueProvider>{c}</SelectedCueProvider>,
      (c) => <TracksProvider value={tracks}>{c}</TracksProvider>,
      (c) => <ViewProvider value={view}>{c}</ViewProvider>,
      (c) => <ToasterProvider value={toast}>{c}</ToasterProvider>,
      (c) => <IconsProvider>{c}</IconsProvider>,
      (c) => <PlaybackProvider>{c}</PlaybackProvider>,
      (c) => <ExportProvider>{c}</ExportProvider>,
      (c) => <MediaProvider>{c}</MediaProvider>,
      (c) => <ProjectStateProvider value={projectState}>{c}</ProjectStateProvider>,
      (c) => <ClipboardProvider>{c}</ClipboardProvider>,
      (c) => <DragPreviewProvider value={dragPreview}>{c}</DragPreviewProvider>,
      (c) => <AskProvider>{c}</AskProvider>,
      (c) => <LibraryProvider>{c}</LibraryProvider>,
      (c) => <AppChromeProvider>{c}</AppChromeProvider>,
      (c) => <BandDragProvider>{c}</BandDragProvider>,
      (c) => <SubtitlePrefsProvider>{c}</SubtitlePrefsProvider>,
      (c) => <ShortcutPrefsProvider>{c}</ShortcutPrefsProvider>,
      (c) => <LaneHeightsProvider>{c}</LaneHeightsProvider>,
      (c) => <LaneGeometryProvider>{c}</LaneGeometryProvider>,
      (c) => <SegLayoutProvider>{c}</SegLayoutProvider>,
      (c) => <TrackGeomProvider>{c}</TrackGeomProvider>,
      // 絵の決まり・割り当ての控え・段の3つを見るので、それより内側
      (c) => <CueIconProvider>{c}</CueIconProvider>,
      (c) => <ContentShiftProvider>{c}</ContentShiftProvider>,
      (c) => <TimelineBoxProvider>{c}</TimelineBoxProvider>,
      (c) => <VideoElsProvider>{c}</VideoElsProvider>,
      (c) => <SeAudioProvider>{c}</SeAudioProvider>,
      (c) => <TracksAdminProvider>{c}</TracksAdminProvider>,
      (c) => <TimelineSpanProvider>{c}</TimelineSpanProvider>,
      (c) => <ProxyProvider>{c}</ProxyProvider>,
      (c) => <SnapProvider>{c}</SnapProvider>,
      (c) => <SegOpsProvider>{c}</SegOpsProvider>,
      (c) => <NowShowingProvider>{c}</NowShowingProvider>,
      (c) => <EditProvider>{c}</EditProvider>,
      (c) => <TelopLookProvider>{c}</TelopLookProvider>,
      (c) => <LabelsPresetsProvider>{c}</LabelsPresetsProvider>,
      (c) => <SilenceDuckProvider>{c}</SilenceDuckProvider>,
      (c) => <VClipElsProvider>{c}</VClipElsProvider>,
      (c) => <TemplateShelfProvider>{c}</TemplateShelfProvider>,
      (c) => <TelopEditProvider>{c}</TelopEditProvider>,
      (c) => <AttrCopyProvider>{c}</AttrCopyProvider>,
      (c) => <LaneResizeProvider>{c}</LaneResizeProvider>,
      (c) => <CurrentLookProvider>{c}</CurrentLookProvider>,
      (c) => <HistoryProvider>{c}</HistoryProvider>,
      (c) => <MediaMetaProvider>{c}</MediaMetaProvider>,
      (c) => <PreviewFrameProvider>{c}</PreviewFrameProvider>,
      (c) => <AppLayoutProvider>{c}</AppLayoutProvider>,
      (c) => <TransitionsProvider>{c}</TransitionsProvider>,
      (c) => <TelopAnimProvider>{c}</TelopAnimProvider>,
      (c) => <PlaybackEngineProvider>{c}</PlaybackEngineProvider>,
      (c) => <ViewNavProvider>{c}</ViewNavProvider>,
      (c) => <MotionProvider>{c}</MotionProvider>,
      (c) => <MarkersProvider>{c}</MarkersProvider>,
      (c) => <TelopBoxProvider>{c}</TelopBoxProvider>,
      (c) => <SubtitlesProvider>{c}</SubtitlesProvider>,
      (c) => <MediaOpsProvider>{c}</MediaOpsProvider>,
      (c) => <TimelineDragProvider>{c}</TimelineDragProvider>,
      (c) => <CopyPasteProvider>{c}</CopyPasteProvider>,
      (c) => <ScreenshotProvider>{c}</ScreenshotProvider>,
      (c) => <SegmentPlaceProvider>{c}</SegmentPlaceProvider>,
      (c) => <AutosaveMarkProvider>{c}</AutosaveMarkProvider>,
      (c) => <TelopTemplateProvider>{c}</TelopTemplateProvider>,
      (c) => <ExportRunProvider>{c}</ExportRunProvider>,
      (c) => <ProjectGuardProvider>{c}</ProjectGuardProvider>,
      (c) => <MediaDropProvider>{c}</MediaDropProvider>,
      (c) => <TimelineEditProvider>{c}</TimelineEditProvider>,
      (c) => <ProjectFileProvider>{c}</ProjectFileProvider>,
      (c) => <ProjectIOProvider>{c}</ProjectIOProvider>,
      (c) => <SegmentDragProvider>{c}</SegmentDragProvider>,
      (c) => <IconLibraryProvider>{c}</IconLibraryProvider>,
      (c) => <PreviewManipProvider>{c}</PreviewManipProvider>,
      (c) => <ProjectTemplatesProvider>{c}</ProjectTemplatesProvider>
    ],
    <AppInner />
  )
}
