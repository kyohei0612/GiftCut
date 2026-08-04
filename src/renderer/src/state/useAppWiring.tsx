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
// 行の内訳（08-04 実測）: 頭40 / import107 / **配線957** / 束113 / return9。
// 束は名前を並べているだけ（宣言は8個）＝**切る余地は配線957行にしか無い**。
// 短くする唯一の道と順序は `引き継ぎ-心臓の分け直し.md` の「useAppWiring の地図」。
//
// ## 呼ぶ順が全て
//
// 上から順に、下は上しか参照していない。**前方参照を逃げるための
// `(...a) => X(...a)` は 0 か所**（2026-08-02 に21か所すべて外した）。
// 増やす前にまず疑うこと——相手は本当にこちらを要るか、
// 輪の結び目が「置き場所を間違えた小さな物」ではないか。
// 4つの輪を解いて、4つともそれだった。
//
// ## ここにしか無い物（**足す前に必ずここを見る**）
//
// 下の「中身」は、**このファイルにしか実体が無い14本**。どれも複数の領域を
// 同時に触るので、どのフックの持ち物でもない。**知らずに新規で書くと二重になる。**
//
// 65本のフックは名前を通しているだけなので、中身はそちらを読むこと
//（`npm run index` か、名前で grep）。ここを通しで読む理由は無い。
//
// ## 中身
//
// - `useAppWiring` … 呼ぶ順を保証して、束にして返す。**それ自体に中身は無い**
//
// **画面ぜんぶに掛かる操作**
//
// - `changeRatio` … 比率を変える。**テロップの箱と文字サイズも一緒に補正する**
// - `addMediaAtPlayhead` … 素材を再生ヘッドの位置へ置く（掴んで落とす道と同じ既定へ揃える）
// - `openClipMenu` … 帯の右クリック。**選んでいない物を押したときだけ**選び直す
//
// **その場で1つに決める小物**
//
// - `resetCount` … リセットが何個に効くか（押す前に分かるように）
//
// ※ `PANE_LABEL`（切り離した窓の題）は **state/usePanelLayout へ出した**（08-04）。
//   ただの文字の表なのに、束2つと `Workspace` の prop の**3経路**を通っていた。
// ※ `iconForCue`（テロップに出す絵）は **state/cueIconContext へ出した**（08-04）。
//   心臓を3つまたぐので、どれか1つの中には置けなかった。
// ※ `blurActiveInput`（入力欄から手を離させる）は **lib/focus へ出した**（08-04）。
//   DOM を見るだけで状態を1つも持たないのに、ここに居るせいで掴む処理が上がらなかった。
// ※ `shiftAfter`（境目より後ろをまとめてずらす）は **state/useContentShift へ寄せた**（08-04）。
//   あちらが「5種類まとめてしか触らない」土台で、**同じ決まりを2か所に書いていた**。
// ※ 書き出す fps の3つ（`srcFpsForExport` / `fpsLabel` / `resolveExportFps`）は
//   **state/useExportSettings へ出した**（08-04）。設定も素材の fps も、あちらが持っている。
// ※ `transportInfo`（見出し行の右端の「状態」）と `monitorAspect`（枠の形）は
//   **state/previewContext へ出した**（08-04）。どちらもプレビューの見出しの話で、
//   束を組み立てる所と同じ場所にある方が近い。
//
// ※ `useAppWiring` 自身は「呼ぶ順を保証して、束にして返す」だけ。**中身は無い。**
//
// ## 大きさは state/wiringSize.test.ts が見張っている
//
// 1回で読み切れる大きさ（1,250行）を超えると赤くなる。理由はそちらに書いてある。
import { useEffect, useRef } from 'react'
import type {} from '../../../preload/index.d'
import { perf } from '../lib/perfMonitor'
import { useLayout } from './layoutContext'
import { useSel } from './selectionContext'
import { useDoc } from './contentContext'
import { useTracksCtx } from './tracksContext'
import { useAskCtx } from './askContext'
import { useShortcutPrefsCtx } from './shortcutPrefsContext'
import { useSeAudioCtx } from './seAudioContext'
import { useSilenceDuckCtx } from './silenceDuckContext'
import { useCurrentLookCtx } from './currentLookContext'
import { useWindowDrop } from './useWindowDrop'
import { useAutosaveMarkCtx } from './autosaveMarkContext'
import { TELOP_MOTIONS } from './useLabelsPresets'
import { useLabelsPresetsCtx } from './labelsPresetsContext'
import { useMainEvents } from './useMainEvents'
import { useTimelineSpanCtx } from './timelineSpanContext'
import { useBandDragCtx } from './bandDragContext'
import { useAppChromeCtx } from './appChromeContext'
import type { Ratio } from './useExportSettings'
import { useSubtitlePrefsCtx } from './subtitlePrefsContext'
import { useTimelineBoxCtx } from './timelineBoxContext'
import { useTemplateShelfCtx } from './templateShelfContext'
import { useTimelineWheel } from './useTimelineWheel'
import { audioLaneFor } from '../../../shared/lanes'
import { useDismissOnOutside } from './useDismissOnOutside'
import { RECENT_KEY } from '../lib/appConst'
import type { MediaItem } from '../components/panels/ProjectBinTab'
import { useViewNavCtx } from './viewNavContext'
import { useTransitionsCtx } from './transitionsContext'
import { useMotionCtx } from './motionContext'
import { useTimelineEditCtx } from './timelineEditContext'
import { useTracksAdminCtx } from './tracksAdminContext'
import { useMediaDropCtx } from './mediaDropContext'
import { useIconLibraryCtx } from './iconLibraryContext'
import { useProjectIOCtx } from './projectIOContext'
import { useVideoSync } from './useVideoSync'
import { useSessionMemory, takeRestoredView } from './useSessionMemory'
import { useHistoryCoalesce } from './useHistoryCoalesce'
import { useAutosaveDraft } from './useAutosaveDraft'
import { useSelectionCleanup } from './useSelectionCleanup'
import { useNestSelectSync } from './useNest'
import { useDiagnostics } from './useDiagnostics'
import { useAppLayoutCtx } from './appLayoutContext'
import { useLibraryCtx } from './libraryContext'

import { useSegmentPlaceCtx } from './segmentPlaceContext'
import { useToastCtx } from './toastContext'
import { useExportCtx } from './exportContext'
import { useMediaCtx } from './mediaContext'
import { useExportRunCtx } from './exportRunContext'
import { useSubtitlesCtx } from './subtitlesContext'
import { useMediaOpsCtx } from './mediaOpsContext'
import { useProjectStateCtx } from './projectStateContext'
import { useProjectFileCtx } from './projectFileContext'
import { useProjectTemplatesCtx } from './projectTemplatesContext'
import { useDragPreviewCtx } from './dragPreviewContext'
import { useCopyPasteCtx } from './copyPasteContext'
import { useTelopEditCtx } from './telopEditContext'
import { useTelopAnimCtx } from './telopAnimContext'
import { useAttrCopyCtx } from './attrCopyContext'
import { useTelopTemplateCtx } from './telopTemplateContext'
import { useClipboardCtx } from './clipboardContext'
import { useLaneHeightsCtx } from './laneHeightsContext'
import { usePlaybackCtx } from './playbackContext'
import { useKeyboard } from './useKeyboard'
import type { OpenClipMenu } from '../components/timeline/ClipBand'
import { useTimelineOpsValue } from './timelineOpsContext'
import { useTimelineViewValue } from './timelineViewContext'
import { usePreviewCtxValue } from './previewContext'
import { useLeftPanelValue } from './leftPanelContext'

export function useAppWiring() {
  // 掴んでいる最中に出す物（影・吹き出し・吸い付きの線・囲い）と、コピーの控え
  const {
    draggingMediaRef, dragTip
  } = useDragPreviewCtx()
  const {
    copiedAttrs,
  } = useClipboardCtx()
  // プロジェクトの持ち物と設定（更新しても消えてはいけない物が多い）
  const {
    projectPath, srtPath,
    recentProjects,
    customCats, 
    iconAssign, laneIconAssign
  } = useProjectStateCtx()
  // 素材（取り込んだ物）と元動画（いま使っている物）。videoSrc は差し替わるが
  // videoPath は原本なので差し替えない（焼き直した粗い映像で書き出さないため）
  const {
    videoPath,
    videoDuration, 
    
  } = useMediaCtx()
  // 書き出しの設定と進み具合（設定はプロジェクトの一部、進み具合は画面の一部）
  const {
    ratio, setRatio, 
    srcFpsForExport, fpsLabel,
    showExportDialog, setShowExportDialog,
    exportStatus, setExportStatus, exportPct
  } = useExportCtx()
  // 段の高さ（種類ごと＋段ごと）。state と ref を1か所で面倒を見る
  const {
    videoTrackH, audioTrackH, 
    
  } = useLaneHeightsCtx()
  // 再生の「今」（時刻・流しているか・速さ）。**追いかけの仕組みは動かしていない**
  const {
    currentTime, currentTimeRef, durationRef,
    playing, playRateUI,
    fps, fpsRef,
    // 追いかけの時計まわりも心臓が持っている。**App で別に宣言しないこと**
    //（同じ名前の入れ物が2つできて、「消す方」と「読む方」が食い違う）
  } = usePlaybackCtx()
  // 見え方（拡大率）とお知らせ
  const { toasts } = useToastCtx()
  // 段（トラック）と鍵。**鍵はあらゆる編集の手前で見る**ので心臓に置く
  const { tracks } =
    useTracksCtx()
  // タイムラインの中身は state/useContent がまとめて持つ（配列と採番は一組）
  const {
    cues, setCues, 
    seClips, vClips,
    vClipsRef
  } = useDoc()
  // 選んでいる物は state/useSelection がまとめて持つ（解除の入口も1つ）
  const sel = useSel()
  const {
    selectedIds, selectedVideoIds, setSelectedVideoIds,
    selectedAudioIds, selectedSeIds, setSelectedSeIds,
    selectedImgIds, setSelectedImgIds, selectedVClipIds, setSelectedVClipIds,
    selectedTrans, selectedTelopTrans,
    selectedTrackId, selectedMarkerId,
        
  } = sel
  // ---- データ ----
  // プロジェクト(.gcproj)の保存先。srtPath とは必ず別に持つ
  // （兼用にすると「上書き保存」が読み込んだSRTファイルを壊す）。
  // 開いたプロジェクトで「見つからなかった素材」。保存時に書き戻して情報を失わないため。
  // 画面の枠まわりの小さな状態（品書き・道具・マグネット・進み具合・版）は
  // state/useAppChrome。**保存しない物**をまとめてある
  const {
    menu, setMenu, clipMenu, setClipMenu, tool, 
    rightTab, setPerfOpen, setUpdateState,
    appVersion
  } = useAppChromeCtx()
  // 字幕づくりの設定と進み具合は state/useSubtitlePrefs
  const {
 setSubtitleOpen,
    subMaxChars, subReplace
  } = useSubtitlePrefsCtx()

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
  // ※ sourcesRef の追随はここに無い。**setSources が同じ場で写しも更新する**
  //   （state/useMedia）。effect で追随していた頃は、同じ一拍のうちに2回置くと
  //   2回目がまだ空の写しを見て、1本目を捨てていた。


  // 効果音を鳴らす物（置いた物・試聴の物）は state/useSeAudio
  const { seRefCb, previewSE } = useSeAudioCtx()

  useEffect(() => {
    vClipsRef.current = vClips
  }, [vClips])



  // 段（トラック）の足す・消す・選ぶ・鍵・音量は state/useTracksAdmin
  const {
    fallbackTrack,
    setClipLabel, 
    
  } = useTracksAdminCtx()



  // 人に聞く（文字を入れてもらう・はい/いいえ）は state/askContext。
  // **配線は作らない。** 使う側が直に見に行く（2026-08-04）
  const { promptState, setPromptState, confirmState, closeConfirm } = useAskCtx()

  // 最近開いたプロジェクトの控え。**書けなくても動作には影響しない**ので握りつぶす
  useEffect(() => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recentProjects))
    } catch {
      /* 保存できなくても動作には影響しない */
    }
  }, [recentProjects])

  // 置き場（効果音・見本・動きの見本帳）と並べ方（★・フォルダ・畳み）は
  // state/libraryContext。**34個のうち、ここで使うのはこれだけ。**
  // 残りは束へ詰め直して心臓へ戻す往復だったので、使う側に直に見に行かせた
  //（2026-08-04。数え方は ）
  const {
    localTemplates, refreshPresets, openTplSec, saveLS
  } = useLibraryCtx()
  // 見本帳の棚まわり（右クリックの品書き・開いたら先頭へ送る）は state/useTemplateShelf
  const { tplMenu, setTplMenu, tplSecRefs, rightBodyRef } = useTemplateShelfCtx()
  // 帯になる物（つなぎ目の演出・テロップの出入り・見本・色）を運んでいる最中の
  // 持ち物は state/useBandDrag（ref と state に分ける理由も中にある）
  const {
 draggingTransRef,
    draggingTelopAnimRef
  } = useBandDragCtx()

  // ライブラリに画像を追加（ファイル選択 → 円形クロップ → 保存）

  // キーの割り当てと、環境設定・ファイルメニューの開け閉めは state/useShortcutPrefs
  const {
    shortcuts,
    prefsOpen,
    capturingId,
  } = useShortcutPrefsCtx()

  // タイムラインの箱への参照と、追従（縦は「ついていく側3つ」、横は revealPlayhead）は
  // state/useTimelineBox
  const {
    
    syncTimelineVScroll, fitTimelineAroundVA
  } = useTimelineBoxCtx()

  // 画面の配置は state/usePanelLayout が持つ（大きさの限界と、掴んで動かす所も一緒）
  const {
    timelineH, startResize,
    monitorTab, setTabOrder,
    isPopped, unpopPane, paneGeom
  } = useLayout()

  // 画面の配置（切り離し・幅と高さ・タブ帯）と品書きの位置は state/useAppLayout
  const {
    popPane, orderedTabs, TAB_DEFS, pickTab, clampMenu,
    tabMenu, setTabMenu, tabOverflow, setTabOverflow
  } = useAppLayoutCtx()

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






  // 動きの計測と不具合の記録は state/useDiagnostics
  useDiagnostics()

  // タイムラインの長さ（出す長さ／本当の終わり）と、ものさしの目盛りは
  // state/useTimelineSpan（長さが2つある理由も中にある）
  const { duration } = useTimelineSpanCtx()


  // 素材の読み込みと焼き直しは state/useMediaOps
  //（焼き直しはプレビュー用。書き出しは必ず原本を使う）
  const { loadVideo } = useMediaOpsCtx()


  // 「いまこの瞬間」を見る側のために、state を写しへ移す
  useEffect(() => {
    durationRef.current = duration
  }, [duration])
  useEffect(() => {
    fpsRef.current = fps
  }, [fps])

  // 選んだ物が「もう無い物」を指し続けないよう掃除するのは state/useSelectionCleanup
  useSelectionCleanup()
  // **「組」で選ぶ唯一の入口。** 選び方が何通りあっても、最後にここで組ごとに広げる
  useNestSelectSync()

  // 再生ヘッドの位置の見た目と、リフレーム枠の相手は state/useCurrentLook
  const {
    
    reframeTargetRef
  } = useCurrentLookCtx()

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

  // 本編の切片をどこへ置くか（動かす・新しく置く・落とした所へ）は state/useSegmentPlace
  const { placeVideoAtDrop } = useSegmentPlaceCtx()


  // 雛形を選ぶ窓（起動時と手動の両方）。**当てても原本は汚さない**＝新規扱いで開く

  // 未保存の「＊」と、下書きの土台は state/useAutosaveMark
  // （何と比べて決めるか・なぜ変わったときだけ見直すかも中にある）
  const {
    unsaved,
    restorePrompt, setRestorePrompt, projectJsonRef,
    autosaveNg
  } = useAutosaveMarkCtx()




  // 静かな所を切る・声の間だけ BGM を下げる（同じ解析結果を使う）は state/useSilenceDuck
  const {
    silenceCut, setSilenceCut, silenceOpen, setSilenceOpen,
    duckOpts, setDuckOpts, duckOpen, setDuckOpen, duckEnv, silenceCuts
  } = useSilenceDuckCtx()

  // 動き（キーフレーム）を付ける・消す・配るのは state/useMotion
  const {
    
    applyMotionPreset
  } = useMotionCtx()

  // 書き出しは state/useExport（やり直しが利かないので、道すじを1か所に）
  const { exportSrtFn, openExportDialog, exportProject } = useExportRunCtx()
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
  // つなぎ目の演出（選ぶ・付ける・長さ・外す）は state/useTransitions
  const {
    updateSelectedTransDur, setSelectedTransType,
    deleteSelectedTrans, 
    
  } = useTransitionsCtx()

  // 色ラベルと見本の保存、出入りアニメの一覧は state/useLabelsPresets
  const { labelGroups, setLabelFor, selectByLabel } = useLabelsPresetsCtx()


  // 素材を掴んで落とす（どの段の、どこへ置くか）は state/useMediaDrop
  const {
    prepareMediaMeta, beginMediaDrag, placeImage, deleteSelectedImg,
    
    deleteSelectedVClip, placeSE, removeMedia
  } = useMediaDropCtx()

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
  useVideoSync()

  // 見ている場所を動かす（寄る・引く・連れてくる）は state/useViewNav
  const { fitTimelineZoom } = useViewNavCtx()


  // ホイールの割り当てと、再生ヘッドの追いかけは state/useTimelineWheel
  useTimelineWheel()

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
  useWindowDrop()

  /**
   * 入力欄から手を離させる。
   *
   * スライダーや数値欄に居座られると、**矢印キーが再生ヘッドではなくその欄を動かし**、
   * Space も効かなくなる。しかも掴む処理で既定の動きを止めているので、
   * 押しても戻ってこない。タイムライン／プレビューを触った時点で外す。
   */


  // アイコンの置き場と割り当て（段ごと・色ごと）は state/useIconLibrary
  const {
    setIconForLane, setIconForColor,
    addIconFiles, addIconImages, removeIconImage, 
    iconLibrary, cropSrc, setCropSrc
  } = useIconLibraryCtx()

  // テロップの足し引きは state/useTelopEdit
  const { addTelop } =
    useTelopEditCtx()
  // 出入りの演出（頭・尻・テロップ同士の間）は state/useTelopAnim
  const {
    
    updateTelopTransDur, setTelopTransType, deleteSelectedTelopTrans, toggleTelopEmphasis
  } = useTelopAnimCtx()

  // コピーと貼り付け（クリップと動きだけ）は state/useCopyPaste
  const { copySelected } = useCopyPasteCtx()
  // 「設定だけ」（属性のコピー・貼り付け）は state/useAttrCopy
  const { attrSummary, copyAttributes, pasteAttributes } =
    useAttrCopyCtx()

  // 消す・切る・複製する・詰める（タイムラインを縮める側）は state/useTimelineEdit
  const {
    deleteSelected, rippleDeleteSelected,
    deleteSelectedSE, findSilences, applySilenceCut, rippleDeleteVideoSegments,
    toggleBlankSelectedVideo, duplicateClipsFromMenu,
    deleteVideoSegmentsLeavingGap,
    splitVideoAtPlayhead
  } = useTimelineEditCtx()

  // ここから下の3つは、**useTimelineEdit と usePlaybackEngine の後でなければ呼べない**。
  // どれも相手の戻り値を要るが、相手はこちらを要らない（＝輪ではなく片道）。
  // 以前は上で呼んで「呼ぶときに見に行く」形で逃げていたが、順番を直せば素直に渡せる。

  // 字幕づくりは state/useSubtitles（聞き取り→割る→音に合わせる）
  const { runSubtitles, handleImportSrt } = useSubtitlesCtx()



  // プロジェクトの開く・保存・復元は state/useProjectFile
  //（拾い忘れた項目はエラーも出ずに消えるので、1か所にまとめてある）
  const { projectJson, saveProjectFn, openProjectFn, applyProjectData } = useProjectFileCtx()
  // テンプレート（次に始めるときの形を決める）は state/useProjectTemplates。
  // **タイムラインの中身は一切触らない**ので、上とは持ち物がほとんど重ならない。
  const {
    saveAsTemplateFn, openTemplateFn, pickTemplate, templatePicker, setTemplatePicker
  } = useProjectTemplatesCtx()
  // テロップの見本（作る・当てる・消す）は state/useTelopTemplate
  const { saveCurrentAsTemplate, deleteUserTemplate, applyTemplate } =
    useTelopTemplateCtx()

  // 素材とプロジェクトの出し入れ（開く・足す・持ち出す・下書き）は state/useProjectIO
  const {
    handleReplaceVideo, handleAppendVideo,
    genThumbFor, addFilesToProject, addFolderToProject,
    packProjectFn, openPackFn
  } = useProjectIOCtx()

  // 覚えておく物は3つ。**この順に呼ぶこと**（2026-08-03 に1つを3つへ分けた）。
  //
  // 効果（useEffect）は**宣言した順**に走る。いちばん上の「作業位置を覚える」は
  // 「1つ前の描画の ref」を見て中身があるか判断しているので、**写し取りをする
  // useHistoryCoalesce を先に呼ぶと、起動直後に空でセッションを上書きしうる。**
  // 同じ型の事故を1度やっていて、e2e が `7613 → 0` で捕まえた
  //（16-仕上げ「前回の続きを開くと、タイムラインの横位置も戻る」）。
  useSessionMemory()
  useHistoryCoalesce()
  useAutosaveDraft()
  projectJsonRef.current = projectJson

  // メインからの知らせ（進み具合・更新・関連付けで開く）は state/useMainEvents。
  // **ここで呼ぶのは、下書きに書く projectJson が出来た後だから。**
  useMainEvents()

  // キーを押したときに何が起きるか（state/useKeyboard）。
  // **ここで呼ぶ。** 渡す物のうち addTelop・saveProjectFn などは、この上の
  // フックが返す物なので、上の方で呼ぶと初期化前参照になる。
  useKeyboard()


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
  // タイムラインの操作の入口。**中身は心臓側で集める**（state/timelineOpsContext）
  const timelineOps = useTimelineOpsValue({ openClipMenu })

  // タイムラインの見え方。**中身は心臓側で集める**（state/timelineViewContext）
  const timelineView = useTimelineViewValue()


  // プレビュー（中央の映像）まわり。中身は state/previewContext.tsx
  // プレビュー（中央の映像）。**中身は心臓側で集める**（state/previewContext）
  const previewCtx = usePreviewCtxValue({ resetCount })


  // 右パネルまわり。中身は state/rightPanelContext.tsx
  // 左パネルが要る物（右・プレビュー・タイムラインと同じ流儀）
  // 左パネル。**中身は心臓側で集める**（state/leftPanelContext）
  const leftPanel = useLeftPanelValue({ resetCount })


  const rightPanel = {
    orderedTabs, TAB_DEFS, pickTab, setTabOrder, setTabMenu, setTabOverflow,
    setTplMenu, rightTab, draggingTransRef, draggingTelopAnimRef,
    // 動きの見本を当てるのは state/useMotion（置き場そのものは state/libraryContext）
    applyMotionPreset,
 toggleTelopEmphasis,
 rightBodyRef, addMediaAtPlayhead, srtPath,
    labelGroups, removeMedia, beginMediaDrag, draggingMediaRef, localTemplates,
    // 掴んで運ぶ物は並べて置く（見本帳・アイコン・強調。落とし先は帯と文字の上）
 TELOP_MOTIONS, addFilesToProject, addFolderToProject, handleImportSrt,
    loadVideo, selectByLabel, genThumbFor, prepareMediaMeta, openTplSec,
    tplSecRefs, saveCurrentAsTemplate, refreshPresets,
    applyTemplate, deleteUserTemplate, iconLibrary,
 addIconImages, addIconFiles, removeIconImage,
    previewSE, setSelectedTransType, updateSelectedTransDur, deleteSelectedTrans, setTelopTransType, updateTelopTransDur,
    deleteSelectedTelopTrans
  }

  // 覆い（ダイアログ）まわり。中身は state/dialogsContext.tsx
  // 右クリックの品書きが要る物（区画と同じ流儀で心臓へ）
  // 画面のいちばん上が要る物（区画・品書きと同じ流儀で心臓へ）
  const header = {
 setUpdateState, shortcuts, appVersion, unsaved,
    saveProjectFn, openProjectFn, packProjectFn, openPackFn, saveAsTemplateFn, openTemplateFn,
    handleAppendVideo, handleReplaceVideo, handleImportSrt, exportSrtFn,
 refreshPresets, setSubtitleOpen,
    openExportDialog, addTelop, changeRatio, projectPath
  }

  const menus = {
    menu, setMenu, clipMenu, setClipMenu, tabMenu, setTabMenu, tabOverflow, setTabOverflow,
    tplMenu, setTplMenu, clampMenu, TAB_DEFS, orderedTabs,
    pickTab, setTabOrder, isPopped, popPane, unpopPane, monitorTab, rightTab, customCats,
 setLabelFor, selectByLabel, setClipLabel, deleteSelected,
    rippleDeleteSelected, deleteSelectedSE, deleteSelectedImg, deleteSelectedVClip,
    deleteVideoSegmentsLeavingGap, rippleDeleteVideoSegments, duplicateClipsFromMenu,
    splitVideoAtPlayhead, toggleBlankSelectedVideo, findSilences, silenceCut, setDuckOpen,
    copySelected, copyAttributes, pasteAttributes, copiedAttrs, attrSummary, shortcuts
  }

  const dialogs = {
    silenceCut, templatePicker, setTemplatePicker, cropSrc, setShowExportDialog,
    exportStatus, restorePrompt, setRestorePrompt, silenceCuts, findSilences, shortcuts,
    capturingId, setCropSrc, promptState, setPromptState, confirmState,
    showExportDialog, fpsLabel, srcFpsForExport, exportProject, exportPct, setExportStatus,
    applyProjectData, subMaxChars,
    saveLS, subReplace, runSubtitles, setSubtitleOpen, pickTemplate,
    silenceOpen, setSilenceCut, applySilenceCut, setSilenceOpen, duckOpen, duckOpts,
    setDuckOpts, duckEnv, setDuckOpen, seRefCb, prefsOpen,
 setIconForColor, setIconForLane, setPerfOpen,
    toasts, closeConfirm, iconAssign, laneIconAssign, iconLibrary
  }

  return {
    appVersion, autosaveNg, cues, dialogs, dragTip, header, isPopped, leftPanel,
    menus, paneGeom, playRateUI, previewCtx, ratio, rightPanel, startResize, timelineOps,
    timelineView, tool, unpopPane, selectedIds, selectedVideoIds, selectedAudioIds, selectedSeIds,
    selectedImgIds, selectedVClipIds, selectedTrans, selectedTelopTrans, selectedMarkerId,
    selectedTrackId, currentTime, fps
  }
}
