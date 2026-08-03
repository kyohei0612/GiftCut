// 画面の部品どうしの「配線」。
//
// ## App.tsx との分け方
//
// App.tsx は「画面は何でできているか」だけを持つ。ここは「それらをどうつなぐか」。
// 画面を直したい人が配線を読まずに済み、配線を直したい人が JSX を読まずに済む。
//
// ここに並んでいるのは**話題ではなく、つなぎ方**。どのフックにどれを渡すか、
// という組み立てそのもので、話題ごとの切り出しは state/use*.ts へ出し切ってある。
//
// ## 長いが、割らないこと（2026-08-02 に測って確定）
//
// 「話題ごとに割れるはず」と何度か言われてきたが、**割れない**。
// どこで境目を引いても、前半で生まれて後半で使われる名前が **106〜413個**
// またぐ（このプロジェクトの目安は40個）。末尾の8つの束を各グループへ
// 配ったと仮定しても 55〜204個。
//
// 理由は、配線が**最後に一点へ集まる形**をしているため。宣言される579個の
// 名前のほとんどが、末尾の束（timelineOps / previewCtx / rightPanel …）へ
// 流れ込む。フック単位で見ても、戻り値が他のフックへ渡らない「葉」は
// 65個中6個だけ。絡まりは輪ではなく**網**。
//
// 割ると 106個超の導管ができるだけで、「この値どこから来た？」が
// 1ホップ遠くなる。**読みやすさは下がる。**
//
// 短くしたいなら、先に**画面側の受け取り方**を変えること。束が小さくなれば
// 集める先が分かれて、配線も自然に分かれる。順序と実測は
// 引き継ぎ-App分割.md の「段階4・5」を読む。
//
// ## 呼ぶ順が全て
//
// 上から順に、下は上しか参照していない。**前方参照を逃げるための
// `(...a) => X(...a)` は 0 か所**（2026-08-02 に21か所すべて外した）。
// 増やす前にまず疑うこと——相手は本当にこちらを要るか、
// 輪の結び目が「置き場所を間違えた小さな物」ではないか。
// 4つの輪を解いて、4つともそれだった。
//
// ## 大きさは state/wiringSize.test.ts が見張っている
//
// 1回で読み切れる大きさ（1,250行）を超えると赤くなる。理由はそちらに書いてある。
import { useEffect, useRef, useState } from 'react'
import { type Cue } from '../lib/srt'
import { type TelopStyle } from '../lib/telopStyle'
import { loadIconLibrary, type IconItem } from '../lib/iconLibrary'
import type {} from '../../../preload/index.d'
import { TransportInfo } from '../components/panels/PreviewBars'
import { perf } from '../lib/perfMonitor'
import { useLayout } from './layoutContext'
import type { PaneId } from './usePanelLayout'
import { useSel } from './selectionContext'
import { useDoc } from './contentContext'
import { useTracksCtx } from './tracksContext'
import { useViewCtx } from './viewContext'
import { useTelopLook } from './useTelopLook'
import { useAsk } from './useAsk'
import { useMarkers } from './useMarkers'
import { useSnap } from './useSnap'
import { useShortcutPrefs } from './useShortcutPrefs'
import { useSeAudio } from './useSeAudio'
import { useVideoEls } from './useVideoEls'
import { useVClipEls } from './useVClipEls'
import { useMediaMeta } from './useMediaMeta'
import { useProxy } from './useProxy'
import { useSilenceDuck } from './useSilenceDuck'
import { useCurrentLook } from './useCurrentLook'
import { useWindowDrop } from './useWindowDrop'
import { useAutosaveMark } from './useAutosaveMark'
import { TELOP_MOTIONS, motionLabel, useLabelsPresets } from './useLabelsPresets'
import { useTrackGeom } from './useTrackGeom'
import { useMainEvents } from './useMainEvents'
import { useTimelineSpan } from './useTimelineSpan'
import { useBandDrag } from './useBandDrag'
import { useAppChrome } from './useAppChrome'
import type { Ratio } from './useExportSettings'
import { useSubtitlePrefs } from './useSubtitlePrefs'
import { useTimelineBox } from './useTimelineBox'
import { useTemplateShelf } from './useTemplateShelf'
import { useSegLayout } from './useSegLayout'
import { kindOf, useSegOps } from './useSegOps'
import { useNowShowing } from './useNowShowing'
import { type LeftPanelValue } from './leftPanelContext'
import { type MenusValue } from './menusContext'
import { type HeaderValue } from './headerContext'
import { useTimelineWheel } from './useTimelineWheel'
import { audioLaneFor } from '../../../shared/lanes'
import { useDismissOnOutside } from './useDismissOnOutside'
import { FPS, RECENT_KEY, RECENT_MAX, RULER_H, TRACK_PAD_ROWS } from '../lib/appConst'
import type { MediaItem } from '../components/panels/ProjectBinTab'
import { useViewNav } from './useViewNav'
import { useTransitions } from './useTransitions'
import { useMotion } from './useMotion'
import { useTimelineEdit } from './useTimelineEdit'
import { useTracksAdmin } from './useTracksAdmin'
import { useMediaDrop } from './useMediaDrop'
import { usePreviewManip } from './usePreviewManip'
import { useIconLibrary } from './useIconLibrary'
import { useProjectIO } from './useProjectIO'
import { usePlaybackEngine } from './usePlaybackEngine'
import { usePreviewFrame } from './usePreviewFrame'
import { useVideoSync } from './useVideoSync'
import { useSessionMemory, takeRestoredView } from './useSessionMemory'
import { useSelectionCleanup } from './useSelectionCleanup'
import { useNestSelectSync } from './useNest'
import { useDiagnostics } from './useDiagnostics'
import { useAppLayout } from './useAppLayout'
import { useLibraries } from './useLibraries'
import { useSegmentPlace } from './useSegmentPlace'
import { type TimelineOps } from './timelineOpsContext'
import { type TimelineView } from './timelineViewContext'
import { type PreviewCtxValue } from './previewContext'
import { type RightPanelValue } from './rightPanelContext'
import { type DialogsValue } from './dialogsContext'
import { ZOOM_MAX, ZOOM_MIN } from './useView'
import { useToastCtx } from './toastContext'
import { useEdit } from './useEdit'
import { useIconsCtx } from './iconsContext'
import { useExportCtx } from './exportContext'
import { useMediaCtx } from './mediaContext'
import { useHistory } from './useHistory'
import { useExport } from './useExport'
import { useSubtitles } from './useSubtitles'
import { useMediaOps } from './useMediaOps'
import { useProjectStateCtx } from './projectStateContext'
import { EXTRA_AUDIO_TRACK, } from '../lib/trackState'
import { useProjectFile } from './useProjectFile'
import { useProjectGuard } from './useProjectGuard'
import { useDragPreviewCtx } from './dragPreviewContext'
import { useCopyPaste } from './useCopyPaste'
import { useTelopEdit } from './useTelopEdit'
import { useTelopAnim } from './useTelopAnim'
import { useAttrCopy } from './useAttrCopy'
import { useLaneResize } from './useLaneResize'
import { startFader } from '../lib/faderDrag'
import { clipXform } from '../lib/clipXform'
import { useClipboardCtx } from './clipboardContext'
import { useLaneHeights } from './useLaneHeights'
import { usePlaybackCtx } from './playbackContext'
import { shiftRange, shiftStart } from '../../../shared/ripple'
import { useKeyboard } from './useKeyboard'
import type { MotionRow } from '../components/panels/MotionTab'
import { useTelopBox } from './useTelopBox'
import { useLaneGeometry } from './useLaneGeometry'
import { useTimelineDrag } from './useTimelineDrag'
import { useSegmentDrag } from './useSegmentDrag'
import type { OpenClipMenu } from '../components/timeline/ClipBand'
import { mediaQueue } from '../lib/schedule'
import { mediaInUse, staleSourceIds } from '../../../shared/mediaBin'

export function useAppWiring() {
  // 掴んでいる最中に出す物（影・吹き出し・吸い付きの線・囲い）と、コピーの控え
  const {
     setSeGhost, setVideoGhost, setImgGhost,
     setSnapLineX, dragTip, setDragTip, marquee, setMarquee,
     setOverwriteIds
  } = useDragPreviewCtx()
  const {
    copiedAttrs,
  } = useClipboardCtx()
  // プロジェクトの持ち物と設定（更新しても消えてはいけない物が多い）
  const {
    projectPath, srtPath, setSrtPath,
    recentProjects,
    customCats, userTemplates, newTelopStyle,
    transDur, iconAssign, setIconAssignState, laneIconAssign, setLaneIconAssign
  } = useProjectStateCtx()
  // 素材（取り込んだ物）と元動画（いま使っている物）。videoSrc は差し替わるが
  // videoPath は原本なので差し替えない（焼き直した粗い映像で書き出さないため）
  const {
    videoSrc, videoPath, videoName,
    videoDuration, proxyPct, setProxyPct,
    sources, sourcesRef, srcOfSeg,
    activeSrcId, mediaItems
  } = useMediaCtx()
  // 書き出しの設定と進み具合（設定はプロジェクトの一部、進み具合は画面の一部）
  const {
    ratio, setRatio, masterVolume, setMasterVolume,
    exportOpts, showExportDialog, setShowExportDialog,
    exportStatus, setExportStatus, exportPct, setExportPct
  } = useExportCtx()
  // 段の高さ（種類ごと＋段ごと）。state と ref を1か所で面倒を見る
  const {
    videoTrackH, setVideoTrackH, audioTrackH, setAudioTrackH,
    videoTrackHRef, audioTrackHRef, laneH, setLaneH, resetLaneH,
  } = useLaneHeights()
  // 再生の「今」（時刻・流しているか・速さ）。**追いかけの仕組みは動かしていない**
  const {
    currentTime, currentTimeRef, durationRef,
    playing, playRateUI, playRateRef,
    fps, fpsRef,
    // 追いかけの時計まわりも心臓が持っている。**App で別に宣言しないこと**
    //（同じ名前の入れ物が2つできて、「消す方」と「読む方」が食い違う）
    preparedRef,
  } = usePlaybackCtx()
  // アイコンの出し方（どちら側・ずらし・大きさ・揃えるか）
  const icons = useIconsCtx()
  const {
    iconAuto, setIconAnchorPos,
    iconSettingsOpen,
  } = icons
  // 選んでいる物を書き換える操作は state/useEdit（鍵を見る決まりも中にある）
  const {
    patchClipMotion,
    setSegZoom,
    setImgZoom,
    setVClipZoom,
  } = useEdit()
  // 見え方（拡大率）とお知らせ
  const { zoom, setZoom, zoomRef } = useViewCtx()
  const { toasts, showToast } = useToastCtx()
  // 段（トラック）と鍵。**鍵はあらゆる編集の手前で見る**ので心臓に置く
  const { tracks, setTracks, trackStates, toggleTrack } =
    useTracksCtx()
  // タイムラインの中身は state/useContent がまとめて持つ（配列と採番は一組）
  const {
    cues, setCues, segments, segIdCounter,
    seClips, setSeClips, imgClips, setImgClips,
    vClips, setVClips, markers, setMarkers,
     segsRef, vClipsRef,
  } = useDoc()
  // 選んでいる物は state/useSelection がまとめて持つ（解除の入口も1つ）
  const sel = useSel()
  const {
    selectedIds, selectedVideoIds, setSelectedVideoIds,
    selectedAudioIds, selectedSeIds, setSelectedSeIds,
    selectedImgIds, setSelectedImgIds, selectedVClipIds, setSelectedVClipIds,
    selectedTrans, selectedTelopTrans,
    selectedTrackId, selectedMarkerId,
        clearSegSel
  } = sel
  const clearAllSelections = sel.clearAll
  // ---- データ ----
  // プロジェクト(.gcproj)の保存先。srtPath とは必ず別に持つ
  // （兼用にすると「上書き保存」が読み込んだSRTファイルを壊す）。
  // 開いたプロジェクトで「見つからなかった素材」。保存時に書き戻して情報を失わないため。
  // 画面の枠まわりの小さな状態（品書き・道具・マグネット・進み具合・版）は
  // state/useAppChrome。**保存しない物**をまとめてある
  const {
    menu, setMenu, clipMenu, setClipMenu, idCounter, tool, setTool, snap, toggleSnap,
    perfOpen, setPerfOpen, perfStopped, setPerfStopped, packPct, setPackPct, packBusyRef,
    updateState, setUpdateState, proxyForPathRef, initializedForPathRef, appVersion
  } = useAppChrome()
  // 字幕づくりの設定と進み具合は state/useSubtitlePrefs
  const {
    subtitleOpen, setSubtitleOpen, subtitleState, setSubtitleState,
    subMaxChars, setSubMaxChars, subReplace, setSubReplace, subModel
  } = useSubtitlePrefs()

  // ---- 編集状態 ----
  // 比率を変更する。テロップの箱(box)と文字サイズは「フレーム高さ1080基準の絶対値」なので、
  // 比率が変わると幅に対する見た目の比率が崩れる（16:9で幅83%の箱が9:16では画面外へ）。
  // 幅の変化率で box.w とフォントサイズを補正して、見た目の収まりを保つ。
  function changeRatio(next: Ratio): void {
    const wOf = (r: Ratio): number => (r === '16:9' ? 1920 : 1080)
    if (next === ratio) return
    const k = wOf(next) / wOf(ratio)
    if (Math.abs(k - 1) > 1e-3) {
      setCues((prev) =>
        prev.map((c) => {
          const st = c.style
          const nb = st.box ? { ...st.box, w: st.box.w * k } : st.box
          return {
            ...c,
            style: { ...st, box: nb, fontSize: Math.max(8, Math.round(st.fontSize * k)) }
          }
        })
      )
    }
    setRatio(next)
  }
  // **毎レンダーここを通る。** 画面を作り直した回数がそのまま数になる
  perf.countRender()

  /** 再生中に最後に時刻を書いた瞬間（描き直しを間引くのに使う） */
  const lastPaintRef = useRef(0)
  /** 元動画を登録した時刻。掃除が「置く直前の物」を消す競合を防ぐ猶予に使う */
  const srcAddedAtRef = useRef<Map<number, number>>(new Map())
  useEffect(() => {
    sourcesRef.current = sources
  }, [sources])

  /** 掴んでいる最中の素材（指を離した時に確定するので ref） */
  const draggingMediaRef = useRef<MediaItem | null>(null)
  /** 掴んでいる最中の効果音の尺（影の幅に使う。掴んだ時に測って入れる） */
  const dragSeDurRef = useRef(2)

  // 効果音を鳴らす物（置いた物・試聴の物）は state/useSeAudio
  const { seAudioRefs, seRefCb, sePreviewRef, previewSE } = useSeAudio()

  useEffect(() => {
    vClipsRef.current = vClips
  }, [vClips])
  /** 縦に動かして移す先の段。**指を離した時にだけ**段を確保する */
  const pendingLaneRef = useRef<string | null>(null)

  // 映像を映す <video> の台帳（1本につきA面/B面を持つ理由も中に）は state/useVideoEls
  const { videoRef, videoBRef, videoElsRef, elKey, activeHalf, setActiveHalf, halfOf, elOf } =
    useVideoEls()

  // 段の数え方・太さ・どの段に居るかは state/useTrackGeom
  const {
    nVideoTracks, nAudioTracks, v1Index, a1Index,
    trackHOf, trackNum, pairedAudioOf, cueTrack, vcLen, anyAudioSolo
  } = useTrackGeom({ tracks, trackStates, laneH, videoTrackH, audioTrackH })

  // 段（トラック）の足す・消す・選ぶ・鍵・音量は state/useTracksAdmin
  const {
    trackFromEvent, mainLocked, fallbackTrack, insertTrackOrdered,
    reserveTrackPairForVideo, setClipLabel, addVideoTrack, addAudioTrack,
    telopLocked, deleteTrack, selectTrack, audioTrackGain, setTrackVolume
  } = useTracksAdmin({ anyAudioSolo, cueTrack, trackNum, nVideoTracks, nAudioTracks })
  // 段見出しの境目を掴んで高さを変えるのは state/useLaneResize
  const { startGroupResize } = useLaneResize({
    trackHOf, videoTrackHRef, audioTrackHRef, setVideoTrackH, setAudioTrackH, setLaneH
  })
  // 上下の余白。段の高さを変えたら一緒に変わる。
  // 上はゆったり、下は1段ぶん。下も同じだけ取ると、その分だけ段が画面から
  // はみ出して「下がかつかつ」になる（実際にそうなった）。
  const padTop = TRACK_PAD_ROWS * videoTrackH
  const padBottom = videoTrackH
  // 段の縦位置と落とし先の判定は state/useLaneGeometry（決まりは shared/lanes）
  const { laneAtY, dropLaneAt } = useLaneGeometry({
    videoTrackHRef,
    audioTrackHRef,
    topOffset: RULER_H + padTop
  })

  /** マウスの縦線を出す位置（タイムラインの上をなぞっている所） */
  const [hoverX, setHoverX] = useState<number | null>(null)
  /** マウスの印の間引き用（毎回描くと動かすだけで重くなる） */
  const lastHoverPaintRef = useRef(0)

  // 書き出す fps は 'source'＝素材と同じが既定。**素材が60fpsなのに黙って30へ
  // 落ちる**のを防ぐため、実数に決めるのは書き出す直前にする（main へは数値だけ渡す）。
  /** 素材の fps（取れていなければ既定）。29.97 のような小数もそのまま使う */
  const srcFpsForExport = (): number => (Number.isFinite(fps) && fps > 0 ? fps : FPS)
  /** 表示用。整数なら「60」、そうでなければ「29.97」 */
  const fpsLabel = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(2))
  /** 書き出しに実際に使う fps */
  const resolveExportFps = (): number =>
    exportOpts.fps === 'source' ? srcFpsForExport() : exportOpts.fps

  // 人に聞く（文字を入れてもらう・はい/いいえ）は state/useAsk
  const { promptState, setPromptState, confirmState, askText, askConfirm, closeConfirm } = useAsk()

  /** 切り離した窓の題（切り離す仕組みそのものは state/usePanelLayout） */
  const PANE_LABEL: Record<PaneId, string> = {
    left: 'プロパティ',
    right: 'プロジェクト',
    preview: 'プレビュー',
    timeline: 'タイムライン'
  }
  // 最近開いたプロジェクトの控え。**書けなくても動作には影響しない**ので握りつぶす
  useEffect(() => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recentProjects))
    } catch {
      /* 保存できなくても動作には影響しない */
    }
  }, [recentProjects])

  /** 右パネルのいま開いている見出し */
  const [rightTab, setRightTab] = useState<
    'project' | 'telop' | 'icon' | 'se' | 'transition'
  >('project')

  // 置き場（効果音・テロップの見本・動きの見本帳）と整理は state/useLibraries
  const {
    seLibrary, refreshSE, importSeInto, localTemplates, refreshPresets,
    motionPresets, refreshMotionPresets, importMotionPresets,
     myMotions, saveMyMotion, deleteMyMotion,
    isFav, toggleFav, setTplCat, openTplSec, toggleTplSec,
     setOpenAccSec, accSec, loadLS, saveLS,
    seFavs, seFolders, seOv,
    iconFavs, setIconFavs, iconFolders, iconOv, setIconOv,
    toggleSeFav, toggleIconFav, setSeFolderOf, setIconFolderOf,
    addSeFolder, deleteSeFolder, addIconFolder, deleteIconFolder,
    orgMenu, setOrgMenu, allCats, catOf, addCustomCat, deleteCustomCat
  } = useLibraries({ askText })
  // プレビューの画質と、焼き直した映像（プロキシ）は state/useProxy
  const { previewRes, setPreviewRes, previewResRef, lastPreviewResRef, proxyMap, previewUrl } =
    useProxy({ loadLS, saveLS, playRateRef, sources, vClips, proxyForPathRef, setProxyPct })
  // 見本帳の棚まわり（右クリックの品書き・開いたら先頭へ送る）は state/useTemplateShelf
  const { tplMenu, setTplMenu, tplSecRefs, rightBodyRef } = useTemplateShelf({
    openTplSec,
    refreshPresets
  })
  // 帯になる物（つなぎ目の演出・テロップの出入り・見本・色）を運んでいる最中の
  // 持ち物は state/useBandDrag（ref と state に分ける理由も中にある）
  const {
    draggingIconRef, draggingTransRef, transDrop, setTransDrop,
    draggingTelopAnimRef, telopDrop, setTelopDrop, draggingTemplateRef
  } = useBandDrag()

  // ---- アイコン画像ライブラリ（単純な画像置き場。追加時にクロップ）----
  const [iconLibrary, setIconLibrary] = useState<IconItem[]>(loadIconLibrary)
  const [cropSrc, setCropSrc] = useState<{ src: string; onDone: (img: string) => void } | null>(
    null
  )
  // テロップの実効アイコン画像。優先: 個別D&D(iconImage) → 色(ラベル)割当 → レーン(トラック)割当。
  // 何も割り当ててなければ非表示（デフォOFF）。personIcon===false のテロップだけ個別に非表示。
  // どの画像を出すかの決まりは state/useIcons（割り当ての優先順位も中にある）
  const iconForCue = (c: Cue): string | undefined =>
    icons.iconForCue(c, iconAssign, laneIconAssign, cueTrack)
  // ライブラリに画像を追加（ファイル選択 → 円形クロップ → 保存）

  // キーの割り当てと、環境設定・ファイルメニューの開け閉めは state/useShortcutPrefs
  const {
    shortcuts,
    resetShortcuts,
    prefsOpen,
    setPrefsOpen,
    fileMenuOpen,
    setFileMenuOpen,
    capturingId,
    setCapturingId
  } = useShortcutPrefs()

  // タイムラインの箱への参照と、追従（縦は「ついていく側3つ」、横は revealPlayhead）は
  // state/useTimelineBox
  const {
    screenRef, trackInnerRef, scrollRef, thBodyRef,
    syncTimelineVScroll, fitTimelineAroundVA, revealPlayhead, inView
  } = useTimelineBox()

  // 画面の配置は state/usePanelLayout が持つ（大きさの限界と、掴んで動かす所も一緒）
  const {
    leftW, rightW, timelineH, setLeftW, setRightW, setTimelineH, startResize,
    leftTab, monitorTab, setMonitorTab, tabOrder, setTabOrder,
    popped, setPopped, isPopped, unpopPane, paneGeom, setPaneGeom
  } = useLayout()

  // 画面の配置（切り離し・幅と高さ・タブ帯）と品書きの位置は state/useAppLayout
  const {
    popPane, layoutNow, applyLayout, orderedTabs, TAB_DEFS, pickTab, clampMenu,
    tabMenu, setTabMenu, tabOverflow, setTabOverflow
  } = useAppLayout({
    PANE_LABEL, popped, setPopped, paneGeom, setPaneGeom,
    leftW, setLeftW, rightW, setRightW, timelineH, setTimelineH,
    videoTrackH, setVideoTrackH, audioTrackH, setAudioTrackH,
    tabOrder, setTabOrder, rightTab, setRightTab, monitorTab, setMonitorTab
  })

  // プレビューとの境目を動かした＝タイムラインの高さが変わった。
  // 上と下が一緒に小さくなるよう、映像と音声の境目を残す。
  useEffect(() => {
    fitTimelineAroundVA()
  }, [timelineH, fitTimelineAroundVA])

  // 段の高さや本数が変わると、送れる量そのものが変わる（減れば、ブラウザが
  // scrollTop を勝手に切り詰める）。追従側は自分では気づけないので合わせ直す。
  // ここを抜くと、段を細くした瞬間に見出しだけ上へずれたまま残る。
  //
  // ※こちらは**送る位置を変えない**。段の高さを触っている最中に
  //   タイムラインが真ん中へ飛ぶと、掴んでいる境目が逃げる。
  useEffect(() => {
    syncTimelineVScroll()
  }, [videoTrackH, audioTrackH, tracks.length, syncTimelineVScroll])

  // 「いまこの瞬間」を見るための写し。指を離した時の処理が古い値を読まないように
  const videoDurationRef = useRef(0)
  const ratioRef = useRef<Ratio>('16:9')

  // 元に戻す・やり直す（控えと、時刻の入れ替え）は state/useHistory
  const {
    undoStackRef, redoStackRef, baselineRef, suppressHistoryRef, pendingTimerRef,
    bumpHist: setHistTick,
    setTime, paintTime, isDirty, snapNow, pushUndo, commitPending, undo, redo, resetHistory
  } = useHistory({
    preparedRef,
    previewResRef,
    lastPaintRef,
    ratioRef
  })

  // 素材の下ごしらえ（尺・波形の控え、二重解析よけ）は state/useMediaMeta。
  // **履歴より後で呼ぶ。** 使わなくなった控えを捨てる判断に、
  // 積んである控え（元に戻すと出てくる素材）を見る必要があるため。
  const { mediaMeta, setMediaMeta, mediaMetaRef, metaInFlightRef, thumbDoneRef } = useMediaMeta({
    historySnaps: () => [...undoStackRef.current, ...redoStackRef.current]
  })

  // 保存していない変更があるか（タイトルの「＊」用）。
  // 重いので毎レンダーではなく、下の一定間隔の判定でだけ更新する。
  const [unsaved, setUnsaved] = useState(false)

  /** 選んでいるテロップの先頭（設定パネルが見ている物） */
  const primaryId = selectedIds[0] ?? null
  const selected = cues.find((c) => c.id === primaryId) ?? null

  // 本編の切片の並びと、その「いまこの瞬間」用の写しは state/useSegLayout
  const { segLayout, videoTLen, segLayoutRef, videoTLenRef } = useSegLayout(segments)

  // 動きの計測と不具合の記録は state/useDiagnostics
  useDiagnostics({
    setPerfOpen, dragTip, marquee, segLayoutRef, previewResRef, videoRef
  })

  // タイムラインの長さ（出す長さ／本当の終わり）と、ものさしの目盛りは
  // state/useTimelineSpan（長さが2つある理由も中にある）
  const { seEnd, duration, contentEndRef, rulerTicks } =
    useTimelineSpan({ videoTLen, zoom, fps })

  // 再生の心臓（流す・止める・飛ぶ・コマ送り）は state/usePlaybackEngine。
  // **素材の読み込み（下）より先に呼ぶ。** 以前は逆で、読み込む側が「止める物」を
  // 要り、こちらが「切片の元動画を引く物」を要る、という輪になっていた。
  // 引くだけの srcOfSeg を素材の心臓へ移したので、いまは片道になっている。
  const {
    stopPlayback,
    togglePlay, shuttleForward, shuttleReverse, handleVideoEnded,
    seekTo, seekAndReveal, xfBStyle, skipSec, stepFrame
  } = usePlaybackEngine({
    videoRef, videoBRef, videoElsRef, setActiveHalf, halfOf, elKey, segLayoutRef,
    srcOfSeg, videoTLenRef, videoDurationRef, contentEndRef,
    seAudioRefs, sePreviewRef, paintTime, setTime, revealPlayhead
  })

  // 素材の読み込みと焼き直しは state/useMediaOps
  //（焼き直しはプレビュー用。書き出しは必ず原本を使う）
  const { updateSource, hydrateSource, loadVideo, registerSource, addMediaPaths } = useMediaOps({
    stopPlayback,
    setTime,
    kindOf,
    setOpenAccSec,
    videoElsRef,
    proxyForPathRef,
    srcAddedAtRef,
    initializedForPathRef,
    baselineRef,
    redoStackRef,
    pendingTimerRef,
    undoStackRef,
    suppressHistoryRef
  })

  // いま出ているテロップと、映す素材の一覧は state/useNowShowing
  // （先頭だけ特別扱いする理由・開始ちょうどから出す理由も中にある）
  const { activeCues, previewSources } = useNowShowing({
    cues, currentTime, tracks, cueTrack, sources, videoSrc, videoDuration, fps
  })

  // 「いまこの瞬間」を見る側のために、state を写しへ移す
  useEffect(() => {
    durationRef.current = duration
  }, [duration])
  useEffect(() => {
    videoDurationRef.current = videoDuration
  }, [videoDuration])
  useEffect(() => {
    fpsRef.current = fps
  }, [fps])

  // 選んだ物が「もう無い物」を指し続けないよう掃除するのは state/useSelectionCleanup
  useSelectionCleanup()
  // **「組」で選ぶ唯一の入口。** 選び方が何通りあっても、最後にここで組ごとに広げる
  useNestSelectSync()

  /** 本編の段が隠されているか（隠していたら書き出しにも出さない） */
  const v1Hidden = trackStates['V1']?.hidden ?? false

  // 重ねる動画の <video>（窓で区切って残す理由も中に）は state/useVClipEls
  const { windowVClips, vcElsRef, vcRefCb } = useVClipEls(vClips, currentTime, tracks)
  // 再生ヘッドの位置の見た目と、リフレーム枠の相手は state/useCurrentLook
  const {
    effActiveSrcId, curBlank, curAdjustCss, curSegZoom, curCropInset,
    reframeTarget, reframeTargetRef
  } = useCurrentLook({
    segLayout, segments, currentTime, previewSources, activeSrcId,
    selectedVideoIds, selectedImgIds, selectedVClipIds,
    imgClips, vClips, vcLen, srcOfSeg, videoName
  })
  // プレビューに出す「いまの絵」の組み立て（回転・拡大・つなぎ目の演出）は
  // state/usePreviewFrame
  const {
       transOverlay, videoMainStyle,
    xfPreview, xfNextBUrl, xfDipOverlay
  } = usePreviewFrame({ segLayout, srcOfSeg, curSegZoom, curCropInset, previewUrl })

  /** リセットが何個に効くか（ボタンの表示に使う。押す前に分かるように） */
  const resetCount = (): number => {
    const tgt = reframeTargetRef.current
    if (!tgt) return 0
    const n =
      (selectedVideoIds.length || (tgt.kind === 'video' ? 1 : 0)) +
      (selectedImgIds.length || (tgt.kind === 'img' ? 1 : 0)) +
      (selectedVClipIds.length || (tgt.kind === 'vclip' ? 1 : 0))
    return n
  }

  // 切片の切り方・空きの作り方（切り口に演出を残さない理由も中に）は state/useSegOps
  const { segSplit, makeGapSeg, segOps } = useSegOps({ segIdCounter })
  // 本編の切片をどこへ置くか（動かす・新しく置く・落とした所へ）は state/useSegmentPlace
  const { cutRangeFromSegs, moveSegmentTo, placeVideoAtDrop } = useSegmentPlace({
    mainLocked, segOps, segSplit, shiftAfter, loadVideo, registerSource
  })

  /** 何か作りかけの物があるか（捨てる前に聞くかどうかの判断に使う） */
  const hasProjectContent = (): boolean =>
    !!videoPath ||
    cues.length > 0 ||
    segments.length > 0 ||
    seClips.length > 0 ||
    imgClips.length > 0 ||
    markers.length > 0 ||
    vClips.length > 0 ||
    mediaItems.length > 0

  // 雛形を選ぶ窓（起動時と手動の両方）。**当てても原本は汚さない**＝新規扱いで開く
  const [templatePicker, setTemplatePicker] = useState<{
    items: { name: string; path: string }[]
    startup: boolean
  } | null>(null)

  // 未保存の「＊」と、下書きの土台は state/useAutosaveMark
  // （何と比べて決めるか・なぜ変わったときだけ見直すかも中にある）
  const {
    lastAutosaveRef, hasContentRef, savedJsonRef, restorePrompt, setRestorePrompt, projectJsonRef,
     currentJsonRef, markUnsavedRef, projectRevRef,
    autosavedRevRef, autosaveNgRef, autosaveNg, setAutosaveNg
  } = useAutosaveMark({
    hasProjectContent,
    setUnsaved,
    // 画面の配置は心臓ではなくフックが持っているので、ここから渡す
    layout: [popped, paneGeom, leftW, rightW, timelineH, videoTrackH, audioTrackH, tabOrder, rightTab, monitorTab]
  })

  // プロジェクトを切り替える瞬間の決まり（捨てる前に聞く・最近開いた物を覚える）は
  // state/useProjectGuard。**開く側と出し入れ側の両方が要る**ので、両方より先に作る
  const { confirmDiscard, rememberProject } = useProjectGuard({
    hasProjectContent, savedJsonRef, currentJsonRef, askConfirm, recentMax: RECENT_MAX
  })

  /** 見本や設定から「その色は何色か」を1つ決める（グラデなら端の色） */
  const runColorFromStyle = (st: TelopStyle): string | undefined => {
    const f = st.fill
    if (!f?.enabled) return undefined
    if (f.color) return f.color
    const stops = f.gradient?.stops
    return stops && stops.length ? stops[stops.length - 1].color : undefined
  }

  // テロップの見た目（全体に効かせるか、選んだ文字だけか）は state/useTelopLook
  const {
    updateSelectedText, panelStyleFor, updateSelectedStyle, applyRunRange,
    clearRunsInSelection, curSel, editorTextRef, setEditorSel
  } = useTelopLook()

  // 静かな所を切る・声の間だけ BGM を下げる（同じ解析結果を使う）は state/useSilenceDuck
  const {
    silenceCut, setSilenceCut, silenceOpen, setSilenceOpen,
    duckOpts, setDuckOpts, duckOpen, setDuckOpen, duckEnv, duckGainAt, silenceCuts
  } = useSilenceDuck(segments)

  // 動き（キーフレーム）を付ける・消す・配るのは state/useMotion
  const {
     removeKeyAtTime, resetClipChannel, clearClipMotions, toggleKeys, nudgeClips,
    applyMotionPreset
  } = useMotion({
    reframeTargetRef, askConfirm, showToast, segLayout,
    patchClipMotion, setSegZoom, setImgZoom, setVClipZoom, vcLen, seekTo
  })

  // 書き出しは state/useExport（やり直しが利かないので、道すじを1か所に）
  const { exportSrtFn, openExportDialog, exportProject } = useExport({
    stopPlayback,
    srcOfSeg,
    cueTrack,
    iconForCue,
    resolveExportFps,
    duckEnv,
    seEnd,
    v1Hidden
  })
  /**
   * 境目より後ろにある物を、まとめてずらす（＝詰まる）。
   *
   * 端を摘む・複製する・速さを変える——**長さが変わる操作の後に必ず要る**。
   * これが無いと「動画を短くしたら字幕が全部ズレた」になる。
   *
   * **ずらす相手は5種類ある。** 新しく置ける物を足したら、必ずここへも足すこと。
   * 1つ忘れると、そこだけ置き去りになって「切って詰めたのに文字だけ残る」になる。
   * ずらし方の決まり（境目の比べ方・前へはみ出させない）は shared/ripple。
   */
  function shiftAfter(boundaryT: number, delta: number): void {
    if (Math.abs(delta) < 1e-4) return
    setCues((prev) => prev.map((c) => ({ ...c, ...shiftRange(c, boundaryT, delta) })))
    setSeClips((prev) =>
      prev.map((c) => ({ ...c, tStart: shiftStart(c.tStart, boundaryT, delta) }))
    )
    setImgClips((prev) =>
      prev.map((c) => ({ ...c, tStart: shiftStart(c.tStart, boundaryT, delta) }))
    )
    setMarkers((prev) => prev.map((m) => ({ ...m, t: shiftStart(m.t, boundaryT, delta) })))
    setVClips((prev) =>
      prev.map((c) => ({ ...c, tStart: shiftStart(c.tStart, boundaryT, delta) }))
    )
  }

  // つなぎ目の演出（選ぶ・付ける・長さ・外す）は state/useTransitions
  const {
    selectTransition, updateSelectedTransDur, setSelectedTransType,
    deleteSelectedTrans, startTransResize, setVideoTransDur, resolveTransDrop,
    applyTransDrop, cleanupOrphanTrans
  } = useTransitions({
    segLayout, segLayoutRef, draggingTransRef, trackInnerRef, setRightTab,
    clearSegSel, mainLocked, showToast, transDur
  })

  /** 動きの表で選んでいる行（コピーする項目）。写す・貼るは state/useCopyPaste */
  const motionSelRef = useRef<string[]>([])
  /** いま出ているモーションの行。コピーが「印の無い項目」も写せるように使う */
  const motionRowsRef = useRef<MotionRow[]>([])
  // 色ラベルと見本の保存、出入りアニメの一覧は state/useLabelsPresets
  const { labelGroups, setLabelFor, selectByLabel, savePreset } = useLabelsPresets()

  // マグネット（吸着）は state/useSnap
  const { snapTime, snapClipStart } = useSnap({ snap, segLayoutRef })

  // 素材を掴んで落とす（どの段の、どこへ置くか）は state/useMediaDrop
  const {
    prepareMediaMeta, beginMediaDrag, placeImage, deleteSelectedImg,
    updateDropGhost, clearDropGhosts, dropMediaNearest, videoDropLane, placeVClip,
    deleteSelectedVClip, vcFadeGain, placeSE, addBgm, seFadeGain, removeMedia, imgLaneAt, placeDropped
  } = useMediaDrop({
    EXTRA_AUDIO_TRACK, dragSeDurRef, draggingMediaRef, dropLaneAt,
    fallbackTrack, cueTrack, insertTrackOrdered, mediaInUse, mediaMetaRef, mediaQueue,
    metaInFlightRef, pairedAudioOf, placeVideoAtDrop, reserveTrackPairForVideo,
    scrollRef, trackInnerRef, snapClipStart, staleSourceIds, trackFromEvent, trackNum,
    vcLen, setMediaMeta, setImgGhost, setSeGhost, setVideoGhost, setSnapLineX
  })

  /**
   * 素材を**再生ヘッドの位置へ置く**（素材をダブルクリックしたとき）。
   *
   * 置く場所をマウスで指す必要があるのはドラッグだけで、
   * 「とりあえず今いる所に足したい」ときにドラッグを強いるのは手間なだけ。
   * どの段に載せるかは、ドラッグで何も指さなかったときと同じ既定に合わせる。
   *
   * **ここに置いてあるのは、置き方が3種類とも揃うのがこの位置だから。**
   * 読み込む側（state/useMediaOps）に置いていた頃は、あちらが置く物を要り、
   * 置く物は読み込む物を要る、という輪になっていた。
   */
  function addMediaAtPlayhead(m: MediaItem): void {
    // 「いまこの瞬間」を見る（再生中は state の描き直しが遅れてずれる）
    const t = currentTimeRef.current
    if (m.kind === 'video') void placeVideoAtDrop(m.path, t, false)
    // **音の置き先を A2 に固定しない**（判定は shared/lanes の audioLaneFor）。
    // 掴んで落とすときは狙った段へ行くのに、ここだけ固定だった
    else if (m.kind === 'audio')
      void placeSE(m, t, audioLaneFor(tracks, seClips, t, sel.selectedTrackId))
    else placeImage(m, t, fallbackTrack('V3', 'video'))
  }

  // 画面の <video> / <audio> を「いま」に追従させるのは state/useVideoSync
  useVideoSync({
    videoRef, videoBRef, videoElsRef, halfOf, elKey, elOf, seAudioRefs, vcElsRef,
    xfPreview, segLayout, srcOfSeg, previewUrl, proxyMap, previewRes,
    lastPreviewResRef, srcAddedAtRef, audioTrackGain, duckGainAt, seFadeGain, vcFadeGain,
    trackNum, undoStackRef, redoStackRef
  })

  // 見ている場所を動かす（寄る・引く・連れてくる）は state/useViewNav
  const { fitTimelineZoom, scrubFromClientX } =
    useViewNav({ scrollRef, trackInnerRef, contentEndRef, seekTo })

  // タイムライン上の目印（頭出し・メモ）は state/useMarkers
  const { addMarkerAtPlayhead, deleteMarker, jumpMarker, onMarkerPointerDown } = useMarkers({
    stopPlayback, seekTo, seekAndReveal, snapTime
  })

  // ホイールの割り当てと、再生ヘッドの追いかけは state/useTimelineWheel
  useTimelineWheel({
    scrollRef, zoomRef, setZoom, ZOOM_MIN, ZOOM_MAX, playing, currentTime, zoom
  })

  // 品書きは、外を押す・Escape で閉じる（閉じ方は state/useDismissOnOutside に1つ）
  useDismissOnOutside(!!clipMenu, () => setClipMenu(null))
  useDismissOnOutside(!!menu, () => setMenu(null))
  // **テロップの打ち直しも、外を押したら完了。**
  // 以前はプレビューの余白を押したときしか閉じず、タイムライン・右パネル・
  // 再生では開いたままだった（＝Enter を押すまで終われない）。
  // クリップは pointerdown を自分で止めるので、**capture で拾って
  // 「打ち直しの中かどうか」を自分で見る**（決まりは useDismissOnOutside）。
  //
  // **左右のパネルは「外」に数えない**（`data-editor-safe`）。
  // 打っている最中に色やフォントを直しに行くのは同じ一続きの作業で、そこで
  // 閉じると**打ちかけの文字と、変えたかった選択そのものが消える**
  // （左パネルの「その文字だけ変える」は、まさにその選択を見ている）。
  // タイムライン・プレビュー・再生は今までどおり「外」＝押したら完了。
  useDismissOnOutside(sel.editingId != null, () => sel.setEditingId(null), {
    inside: '.telop-editor, [data-editor-safe]'
  })
  // 再生を始めたときも完了にする（押した先が無いので上の見張りには掛からない）
  useEffect(() => {
    if (playing && sel.editingId != null) sel.setEditingId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, sel.editingId])

  // 素材を読み込んだ直後に一度だけ全体表示にする。
  // 既定の拡大率のままだと、15秒の素材に対して目盛りが50秒まで伸びていて、
  // クリップが左端の小さな塊に見える。開いた瞬間から作業できる状態にする。
  const didFitForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!videoPath || videoDuration <= 0) return
    if (didFitForRef.current === videoPath) return
    didFitForRef.current = videoPath
    if (takeRestoredView()) return // 前回の見ていた場所を戻したなら、上書きしない
    // 切片のレイアウトが確定してから測る
    const t = window.setTimeout(fitTimelineZoom, 60)
    return () => window.clearTimeout(t)
  }, [videoPath, videoDuration])

  // 素材のドラッグはウィンドウ全体で受け取る（1pxでも取りこぼすと駐禁が出る）。
  // 実体と理由は state/useWindowDrop
  useWindowDrop({ draggingMediaRef, updateDropGhost, clearDropGhosts, dropMediaNearest })

  /**
   * 入力欄から手を離させる。
   *
   * スライダーや数値欄に居座られると、**矢印キーが再生ヘッドではなくその欄を動かし**、
   * Space も効かなくなる。しかも掴む処理で既定の動きを止めているので、
   * 押しても戻ってこない。タイムライン／プレビューを触った時点で外す。
   */
  function blurActiveInput(): void {
    const el = document.activeElement as HTMLElement | null
    if (!el) return
    const tag = el.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') el.blur()
  }
  // タイムラインの上で掴む（目盛りを擦る・段を選ぶ・空きを囲う・クリップを動かす・端を摘む）
  // は state/useTimelineDrag。プレビューの上で掴む話（useTelopBox）とは別物。
  const {
    startScrub, maybeTrackSelect, onTrackAreaPointerDown,
    onClipPointerDown, onClipContextMenu, onTrimStart,
    onSePointerDown, onImgPointerDown, onVClipPointerDown
  } = useTimelineDrag({
    tool, duration, laneAtY, blurActiveInput, stopPlayback,
    trackInnerRef, scrollRef, zoomRef, videoTrackHRef, audioTrackHRef,
    padTop, rulerH: RULER_H,
    segLayout, segLayoutRef, v1Index, a1Index,
    cueTrack, telopLocked, trackNum, vcLen, idCounter,
    setDragTip, setMarquee, setSnapLineX, snapClipStart, snapTime,
    scrubFromClientX, reserveTrackPairForVideo, addVideoTrack, pendingLaneRef, setMenu
  })

  // プレビューの上でテロップを掴む・拡げる・枠内に寄せるのは state/useTelopBox
  const {
    onTelopPointerDown, onTelopResizeStart, setBoxAnchor, applyIconAutoLeft,
    resetSelectedTelops, telopResetCount
  } = useTelopBox({
    screenRef,
    telopLocked,
    stopPlayback,
    seekTo,
    iconAuto,
    setIconAnchorPos
  })

  // アイコンの置き場と割り当て（段ごと・色ごと）は state/useIconLibrary
  const {
    setIconForLane, changeIconAuto, setIconForColor,
    addIconFiles, addIconImages, removeIconImage, setPersonIconForSelected
  } = useIconLibrary({
    iconLibrary, setIconLibrary, setCropSrc, setIconAssignState, setLaneIconAssign,
    setIconOv, setIconFavs, applyIconAutoLeft, setOpenAccSec, saveLS, screenRef,
    seekTo, stopPlayback, selected
  })

  /** プレビューの枠の形（比率の設定そのまま） */
  const monitorAspect = ratio === '16:9' ? '16 / 9' : ratio === '9:16' ? '9 / 16' : '1 / 1'

  // プレビューの見出し（タブ）行の右端に出す「状態」（画質・fps・全体の長さ）。
  //
  // **押す物ではないので、操作バーには置かない。** 同じ行に混ぜると
  // よく使う再生ボタンが端へ押しやられ、ここへ出すと操作バーが1段で済む
  // （プレビューの縦が約26px 広がる）。中身は components/panels/PreviewBars.tsx
  const transportInfo = (
    <TransportInfo
      previewRes={previewRes}
      onPreviewRes={setPreviewRes}
      hasVideo={!!videoSrc}
      fps={fps}
      playRate={playRateUI}
      duration={duration}
      master={masterVolume}
      onMaster={(v) => setMasterVolume(Math.min(1, Math.max(0, v)))}
    />
  )
  // テロップの足し引きは state/useTelopEdit
  const { applyIconToCue, addTelop, updateCueText, alignTelop } =
    useTelopEdit({ cueTrack, idCounter, trackNum, insertTrackOrdered })
  // 出入りの演出（頭・尻・テロップ同士の間）は state/useTelopAnim
  const {
    patchCueAnim, resolveTelopTransDrop, applyTelopTransDrop, selectTelopTrans,
    updateTelopTransDur, setTelopTransType, deleteSelectedTelopTrans, toggleTelopEmphasis
  } = useTelopAnim({ cueTrack, telopLocked, motionLabel, draggingTelopAnimRef, setRightTab })

  // コピーと貼り付け（クリップと動きだけ）は state/useCopyPaste
  const { copySelected, pasteClipboard } = useCopyPaste({
    cueTrack, fallbackTrack, telopLocked, selected, idCounter,
    motionSelRef, motionRowsRef, reframeTargetRef, leftTab
  })
  // 「設定だけ」（属性のコピー・貼り付け）は state/useAttrCopy
  const { attrSummary, copyAttributes, pasteAttributes } =
    useAttrCopy({ mainLocked, telopLocked, srcOfSeg })

  // 消す・切る・複製する・詰める（タイムラインを縮める側）は state/useTimelineEdit
  const {
    deleteSelected, rippleDeleteSelected, cutSelected, duplicateSelected, razorSegment,
    deleteSelectedSE, findSilences, applySilenceCut, rippleDeleteVideoSegments,
    toggleBlankSelectedVideo, duplicateClipsFromMenu, duplicateSelectedSegments,
    setSelectedSegSpeed, setSegRotate, closeGapAtPlayhead, deleteVideoSegmentsLeavingGap,
    closeSelectedGaps,
    rippleToPrevCut, rippleToNextCut, splitVideoAtPlayhead, cutAtPlayhead
  } = useTimelineEdit({
    cleanupOrphanTrans, commitPending, copySelected, cueTrack, cutRangeFromSegs,
    deleteSelectedImg, deleteSelectedVClip, idCounter, mainLocked, makeGapSeg,
    seekTo, revealPlayhead, segLayoutRef, segOps, silenceCut, setSilenceCut, setSilenceOpen, setTime,
    shiftAfter, silenceCuts, stopPlayback, telopLocked, vcLen, videoRef
  })

  // ここから下の3つは、**useTimelineEdit と usePlaybackEngine の後でなければ呼べない**。
  // どれも相手の戻り値を要るが、相手はこちらを要らない（＝輪ではなく片道）。
  // 以前は上で呼んで「呼ぶときに見に行く」形で逃げていたが、順番を直せば素直に渡せる。

  // 字幕づくりは state/useSubtitles（聞き取り→割る→音に合わせる）
  const { runSubtitles, handleImportSrt } = useSubtitles({
    stopPlayback,
    seekTo,
    segLayout,
    resetHistory,
    askConfirm,
    idCounter,
    subMaxChars,
    subReplace,
    newTelopStyle,
    setSrtPath,
    setSubtitleOpen,
    setSubtitleState
  })

  // プレビューの上で映像を掴む（動かす・拡げる・回す）と画面を撮るのは state/usePreviewManip
  const {
    onVideoReframeStart, selectPreviewOverlay, resetVideoZoom, onVideoRotateStart,
    captureScreenshot, zoomAnchor, toggleZoomAnchor, onZoomAnchorStart
  } = usePreviewManip({
    screenRef, videoRef, reframeTargetRef, segLayout, cueTrack, iconForCue, vcLen,
    videoTLen, v1Hidden, curBlank, curSegZoom, patchClipMotion,
    setSegZoom, setImgZoom, setVClipZoom, clearAllSelections,
    setSegRotate
  })

  // 本編の切片（カット列）を掴む・端を摘むのは state/useSegmentDrag。
  // 切片は「並んでいる順」に意味があり、動かすと後ろが詰まる／上書きされる。
  const { onSegPointerDown, onSegTrimStart } = useSegmentDrag({
    tool, mainLocked, maybeTrackSelect, stopPlayback, undo,
    moveSegmentTo,
    razorSegment,
    srcOfSeg, shiftAfter,
    trackInnerRef, scrollRef, zoomRef, videoDurationRef, videoName, videoPath,
    setDragTip, setSnapLineX, setVideoGhost, setOverwriteIds,
    snapClipStart, snapTime
  })

  // プロジェクトの開く・保存・復元は state/useProjectFile
  //（拾い忘れた項目はエラーも出ずに消えるので、1か所にまとめてある）
  const {
    saveCurrentAsTemplate, deleteUserTemplate, projectJson, saveProjectFn,
    openProjectFn, saveAsTemplateFn, openTemplateFn,
    pickTemplate, applyProjectData, applyTemplate, applyTemplateToCue
  } = useProjectFile({
    stopPlayback, setTime, fallbackTrack, kindOf, applyLayout, layoutNow, snapNow,
    resetHistory, confirmDiscard, hasProjectContent, askText, rememberProject,
    prepareMediaMeta, runColorFromStyle, applyRunRange, curSel, selected,
    commitPending, idCounter, savedJsonRef, projectJsonRef, markUnsavedRef,
    lastAutosaveRef, initializedForPathRef, proxyForPathRef, videoElsRef, videoRef,
    setTemplatePicker, saveLS, baselineRef, hydrateSource, updateSource
  })

  // 素材とプロジェクトの出し入れ（開く・足す・持ち出す・下書き）は state/useProjectIO
  const {
    handleReplaceVideo, handleAppendVideo,
    genThumbFor, addFilesToProject, addFolderToProject,
    packProjectFn, openPackFn, writeAutosave
  } = useProjectIO({
    projectPath, projectJson,
    applyProjectData, askConfirm, loadVideo, registerSource, addMediaPaths,
    mediaQueue, thumbDoneRef, packBusyRef, setPackPct, autosaveNgRef, autosavedRevRef,
    lastAutosaveRef, setAutosaveNg, confirmDiscard, rememberProject
  })

  // 作業位置と下書きを覚えておくのは state/useSessionMemory
  useSessionMemory({
    writeAutosave, currentJsonRef, projectRevRef, autosavedRevRef,
    lastAutosaveRef, hasContentRef, applyProjectData, askConfirm, setRestorePrompt,
    setTemplatePicker, isDirty, snapNow, pushUndo, baselineRef, pendingTimerRef,
    suppressHistoryRef, redoStackRef, setHistTick, setTime,
    scrollRef, rightBodyRef, rightTab, setRightTab, ratioRef, localTemplates
  })
  projectJsonRef.current = projectJson

  // メインからの知らせ（進み具合・更新・関連付けで開く）は state/useMainEvents。
  // **ここで呼ぶのは、下書きに書く projectJson が出来た後だから。**
  useMainEvents({
    proxyForPathRef, setProxyPct, setExportPct, setSubtitleState, setUpdateState,
    packBusyRef, setPackPct, openProjectFn, projectJson
  })

  // キーを押したときに何が起きるか（state/useKeyboard）。
  // **ここで呼ぶ。** 渡す物のうち addTelop・saveProjectFn などは、この上の
  // フックが返す物なので、上の方で呼ぶと初期化前参照になる。
  useKeyboard({
    // 何かを開いている間は Esc 以外を通さない（裏のタイムラインが勝手に動かないように）
    modalOpen: !!(
      restorePrompt || templatePicker || cropSrc || showExportDialog ||
      prefsOpen || promptState || confirmState || iconSettingsOpen
    ),
    capturing: !!capturingId,
    exporting: !!exportStatus,
    shortcuts,
    setTool,
    toggleSnap,
    togglePlay,
    shuttleForward,
    shuttleReverse,
    stopPlayback,
    seekTo,
    contentEndRef,
    copyAttributes,
    pasteAttributes,
    copySelected,
    cutSelected,
    pasteClipboard,
    undo,
    redo,
    removeMedia,
    deleteMarker,
    deleteSelectedTrans,
    deleteSelectedTelopTrans,
    deleteTrack,
    deleteSelected,
    deleteSelectedSE,
    deleteSelectedImg,
    deleteSelectedVClip,
    deleteVideoSegmentsLeavingGap,
    closeSelectedGaps,
    closeGapAtPlayhead,
    rippleDeleteVideoSegments,
    rippleToPrevCut,
    rippleToNextCut,
    duplicateSelected,
    duplicateSelectedSegments,
    cutAtPlayhead,
    addTelop,
    addMarkerAtPlayhead,
    saveProjectFn,
    openProjectFn,
    openExportDialog,
  })

  // 帯を右クリック。**選んでいない物を押したときだけ**選び直す（前の選択が残っていると、
  // 押した物ではない方へ操作が飛ぶ）。**既に選ばれている物なら選択はそのまま残す**——
  // 常に1つへ潰していたので「まとめて選ぶ → 右クリック → ネストする」が成立しなかった。
  // テロップ側（useTimelineDrag の onClipContextMenu）は元からこの形。
  const openClipMenu: OpenClipMenu = (e, kind, clip) => {
    e.preventDefault()
    e.stopPropagation()
    const cur = { vclip: selectedVClipIds, se: selectedSeIds, seg: selectedVideoIds, img: selectedImgIds }[kind]
    if (!cur?.includes(clip.id)) {
      if (kind === 'vclip') setSelectedVClipIds([clip.id])
      else if (kind === 'se') setSelectedSeIds([clip.id])
      else if (kind === 'seg') {
        // 本編の切片は「映像だけ選ぶ」。画像の選択は必ず落とす
        // （両方選んだまま品書きを出すと、削除が画像まで巻き込む）
        setSelectedVideoIds([clip.id])
        setSelectedImgIds([])
      } else setSelectedImgIds([clip.id])
    }
    setMenu(null)
    setClipMenu({ x: e.clientX, y: e.clientY, kind, id: clip.id, name: clip.name })
  }

  // タイムラインの区画を部品へ出すための2つの心臓。
  // **操作の入口**と**見え方**を分けてあるのは、描き直しの理由を混ぜないため
  //（1つにまとめると、掴んで影が動くたびに操作の入口も「変わった」ことになる）。
  // 中身は state/timelineOpsContext.tsx / state/timelineViewContext.tsx
  const timelineOps: TimelineOps = {
    removeKeyAtTime,
    onClipPointerDown, onClipContextMenu, onTrimStart, onSegPointerDown, onSegTrimStart,
    onSePointerDown, onImgPointerDown, onVClipPointerDown, onMarkerPointerDown,
    onTrackAreaPointerDown, startScrub, startGroupResize, startTransResize, openClipMenu,
    updateDropGhost, clearDropGhosts, dropLaneAt, videoDropLane, placeSE, placeImage, imgLaneAt, placeDropped,
    placeVClip, placeVideoAtDrop, snapClipStart, draggingMediaRef, draggingTransRef,
    draggingTelopAnimRef, dragSeDurRef,
    resolveTransDrop, applyTransDrop, selectTransition, setVideoTransDur,
    resolveTelopTransDrop, applyTelopTransDrop, selectTelopTrans, patchCueAnim,
    undo, redo, undoStackRef, redoStackRef, isDirty, cutAtPlayhead, findSilences,
    setSilenceOpen, toggleSnap,
    selectTrack, toggleTrack, addVideoTrack, addAudioTrack, addBgm, resetLaneH, setTracks, askText,
    fallbackTrack, stopPlayback, seekTo
  }
  const timelineView: TimelineView = {
    cueTrack, vcLen, mediaMeta, srcOfSeg, pairedAudioOf, trackNum, motionLabel,
    silenceCut, shortcuts, duration,
    tool, setTool, snap,
    hoverX, setHoverX, lastHoverPaintRef,
    telopDrop, setTelopDrop, transDrop, setTransDrop,
    segLayout, rulerTicks, padTop, padBottom, trackHOf, inView,
    scrollRef, trackInnerRef, thBodyRef, syncTimelineVScroll,
    fitTimelineZoom
  }

  // プレビュー（中央の映像）まわり。中身は state/previewContext.tsx
  const previewCtx: PreviewCtxValue = {
    orderedTabs, TAB_DEFS, monitorTab, pickTab, setTabMenu, setTabOverflow, setTabOrder,
    shortcuts, cueTrack, srcOfSeg, loadVideo, updateSource, segLayoutRef, segsRef, segIdCounter,
    suppressHistoryRef, initializedForPathRef, stopPlayback, clearSegSel, toggleTrack, duration,
    draggingMediaRef,
    screenRef, videoRef, videoBRef, videoElsRef, elKey, activeHalf, effActiveSrcId,
    previewSources, previewUrl, monitorAspect,
    xfPreview, xfBStyle, xfNextBUrl, xfDipOverlay, transOverlay, videoMainStyle,
    curAdjustCss, curBlank, v1Hidden, videoTLen, activeCues, windowVClips,
    vcRefCb, clipXform, vcLen, iconForCue, proxyPct, packPct,
    onVideoReframeStart, onVideoRotateStart, resetVideoZoom, resetCount,
    zoomAnchor, toggleZoomAnchor, onZoomAnchorStart,
    resetSelectedTelops, telopResetCount,
    selectPreviewOverlay, reframeTarget, onTelopPointerDown, onTelopResizeStart,
    editorTextRef, updateCueText, setEditorSel, clearRunsInSelection,
    draggingTemplateRef, draggingIconRef, applyTemplateToCue, applyIconToCue,
    togglePlay, skipSec, stepFrame, jumpMarker, addMarkerAtPlayhead, captureScreenshot,
    seekAndReveal, handleVideoEnded, startFader, setTrackVolume, setMasterVolume,
    transportInfo
  }

  // 右パネルまわり。中身は state/rightPanelContext.tsx
  // 左パネルが要る物（右・プレビュー・タイムラインと同じ流儀）
  const leftPanel: LeftPanelValue = {
    alignTelop, applyTemplate, changeIconAuto, clearClipMotions, currentTime,
    motionSelRef, motionRowsRef, nudgeClips, pairedAudioOf, panelStyleFor, reframeTarget, resetClipChannel,
    resetCount, saveMyMotion, savePreset, seekTo, setBoxAnchor, setPersonIconForSelected,
    setSelectedSegSpeed, toggleKeys, updateSelectedStyle, updateSelectedText, userTemplates,
    iconForCue
  }

  const rightPanel: RightPanelValue = {
    PANE_LABEL, orderedTabs, TAB_DEFS, pickTab, setTabOrder, setTabMenu, setTabOverflow,
    setTplMenu, setOrgMenu, rightTab, setTransDrop, draggingTransRef, draggingTelopAnimRef,
    setTelopDrop, toggleTelopEmphasis, myMotions, motionPresets, applyMotionPreset,
    deleteMyMotion,
    accSec, rightBodyRef, importSeInto, addMediaAtPlayhead, catOf, srtPath,
    labelGroups, removeMedia, beginMediaDrag, draggingMediaRef, localTemplates, isFav,
    draggingTemplateRef, iconFavs, toggleIconFav, draggingIconRef, seLibrary, seFavs,
    setSeFolderOf, toggleSeFav, TELOP_MOTIONS, addFilesToProject, addFolderToProject, handleImportSrt,
    loadVideo, selectByLabel, genThumbFor, prepareMediaMeta, allCats, openTplSec,
    tplSecRefs, toggleTplSec, saveCurrentAsTemplate, addCustomCat, deleteCustomCat, refreshPresets,
    applyTemplate, deleteUserTemplate, toggleFav, setTplCat, iconLibrary, iconFolders,
    iconOv, addIconImages, addIconFiles, addIconFolder, deleteIconFolder, removeIconImage,
    setIconFolderOf, seFolders, seOv, addSeFolder, deleteSeFolder, refreshSE,
    previewSE, setSelectedTransType, updateSelectedTransDur, deleteSelectedTrans, setTelopTransType, updateTelopTransDur,
    deleteSelectedTelopTrans
  }

  // 覆い（ダイアログ）まわり。中身は state/dialogsContext.tsx
  // 右クリックの品書きが要る物（区画と同じ流儀で心臓へ）
  // 画面のいちばん上が要る物（区画・品書きと同じ流儀で心臓へ）
  const header: HeaderValue = {
    updateState, setUpdateState, fileMenuOpen, setFileMenuOpen, shortcuts, appVersion, unsaved,
    saveProjectFn, openProjectFn, packProjectFn, openPackFn, saveAsTemplateFn, openTemplateFn,
    handleAppendVideo, handleReplaceVideo, handleImportSrt, exportSrtFn, importMotionPresets,
    refreshSE, refreshPresets, refreshMotionPresets, setPrefsOpen, setSubtitleOpen,
    openExportDialog, addTelop, changeRatio, projectPath
  }

  const menus: MenusValue = {
    menu, setMenu, clipMenu, setClipMenu, tabMenu, setTabMenu, tabOverflow, setTabOverflow,
    tplMenu, setTplMenu, orgMenu, setOrgMenu, clampMenu, PANE_LABEL, TAB_DEFS, orderedTabs,
    pickTab, setTabOrder, isPopped, popPane, unpopPane, monitorTab, rightTab, allCats, customCats,
    setTplCat, isFav, toggleFav, setLabelFor, selectByLabel, setClipLabel, deleteSelected,
    rippleDeleteSelected, deleteSelectedSE, deleteSelectedImg, deleteSelectedVClip,
    deleteVideoSegmentsLeavingGap, rippleDeleteVideoSegments, duplicateClipsFromMenu,
    splitVideoAtPlayhead, toggleBlankSelectedVideo, findSilences, silenceCut, setDuckOpen,
    copySelected, copyAttributes, pasteAttributes, copiedAttrs, attrSummary, shortcuts
  }

  const dialogs: DialogsValue = {
    silenceCut, perfStopped, templatePicker, setTemplatePicker, cropSrc, setShowExportDialog,
    exportStatus, restorePrompt, setRestorePrompt, silenceCuts, findSilences, shortcuts,
    capturingId, setCapturingId, setCropSrc, promptState, setPromptState, confirmState,
    showExportDialog, fpsLabel, srcFpsForExport, exportProject, exportPct, setExportStatus,
    applyProjectData, subtitleOpen, subModel, subtitleState, subMaxChars, setSubMaxChars,
    saveLS, subReplace, setSubReplace, runSubtitles, setSubtitleOpen, pickTemplate,
    silenceOpen, setSilenceCut, applySilenceCut, setSilenceOpen, duckOpen, duckOpts,
    setDuckOpts, duckEnv, setDuckOpen, seRefCb, prefsOpen, resetShortcuts,
    setPrefsOpen, setIconForColor, setIconForLane, perfOpen, setPerfOpen, setPerfStopped,
    toasts, closeConfirm, iconAssign, laneIconAssign, iconLibrary
  }

  return {
    PANE_LABEL, appVersion, autosaveNg, cues, dialogs, dragTip, header, isPopped, leftPanel,
    menus, paneGeom, playRateUI, previewCtx, ratio, rightPanel, startResize, timelineOps,
    timelineView, tool, unpopPane, selectedIds, selectedVideoIds, selectedAudioIds, selectedSeIds,
    selectedImgIds, selectedVClipIds, selectedTrans, selectedTelopTrans, selectedMarkerId,
    selectedTrackId, currentTime, fps
  }
}
