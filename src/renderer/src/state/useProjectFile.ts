// プロジェクトの開く・保存・復元と、テンプレート。
//
// ## ここが一番「静かに壊れる」所
//
// 開いたときに拾い忘れた項目は、**エラーも出ずに消える**。
// 読み込みの整え直しは lib/projectLoad に出して試験で押さえたが、
// その前後（どのファイルを開いたか・何を控えるか・テンプレートの当て方）は
// まだここにある。
//
// ## テンプレートを当てるときの決まり
//
// **原本を汚さない。** テンプレートから始めたら「新規」扱いにして、
// 上書き保存でテンプレート自体を潰さないようにする。
import { toGcUrl } from '../lib/gcUrl'
import { clamp, FPS_FALLBACK as FPS } from '../../../shared/timeline'
import { loadCues, loadSegs, loadSeClips, loadMarkers, loadImgClips, loadVClips } from '../lib/projectLoad'
import {  type TelopStyle, type TextRun } from '../lib/telopStyle'
import { DEFAULT_TRACKS, EXTRA_AUDIO_TRACK, initTrackStates, newTrackState } from '../lib/trackState'
import { mergeAssignments, mergeFavorites, mergeFolders, mergeNamed } from '../../../shared/templateMerge'
import { saveCatOverrides, saveCustomCats, saveFavorites, saveUserTemplates } from '../lib/telopTemplates'
import { saveIconAssign } from '../lib/iconLibrary'
import type { Cue } from '../lib/srt'
import type { ImgClip, Marker, SEClip, Source, Track, VClip, VSeg } from '../lib/projectTypes'
import type { MediaItem } from '../components/panels/ProjectBinTab'
import { useDoc } from './contentContext'
import { useProjectStateCtx } from './projectStateContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'
import { useExportCtx } from './exportContext'
import { useMediaCtx } from './mediaContext'
import { useIconsCtx } from './iconsContext'
import { usePlaybackCtx } from './playbackContext'

export interface UseProjectFileDeps {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  //
  // **ここは画面側の配線をそのまま借りている。** 型を細かく付けるより、
  // 借り物であることが見えている方が直しやすい（付け替えるときに
  // どこまでが自分の責任かが分かる）。
  //
    stopPlayback: any
    setTime: any
    duration: any
    fallbackTrack: any
    kindOf: any
    applyLayout: any
    layoutNow: any
    snapNow: any
    resetHistory: any
    confirmDiscard: any
    hasProjectContent: any
    askText: (title: string, def: string, onOk: (v: string) => void) => void
    rememberProject: any
    prepareMediaMeta: any
    mediaMeta: any
    runColorFromStyle: any
    applyRunRange: any
    curSel: any
    selected: any
    audioTrackGain: any
    commitPending: any
    idCounter: any
    savedJsonRef: any
    projectJsonRef: any
    markUnsavedRef: any
    lastAutosaveRef: any
    initializedForPathRef: any
    proxyForPathRef: any
    videoElsRef: any
    videoRef: any
    setTemplatePicker: any
    saveLS: any
  baselineRef: any
  undoStackRef: any
  redoStackRef: any
  pendingTimerRef: any
  hydrateSource: any
  updateSource: any
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export function useProjectFile(deps: UseProjectFileDeps) {
  const { stopPlayback, setTime, fallbackTrack, kindOf, applyLayout, layoutNow, snapNow, resetHistory, confirmDiscard, hasProjectContent, askText, rememberProject, prepareMediaMeta, runColorFromStyle, applyRunRange, curSel, selected, commitPending, idCounter, savedJsonRef, projectJsonRef, markUnsavedRef, lastAutosaveRef, initializedForPathRef, proxyForPathRef, videoElsRef, videoRef, setTemplatePicker, saveLS, baselineRef, hydrateSource, updateSource } = deps
  const { cues, setCues, segments, setSegments, seClips, setSeClips, imgClips, setImgClips, vClips, setVClips, markers, setMarkers, segIdCounter, seIdCounter, imgIdCounter, vClipIdCounter, markerIdCounter } = useDoc()
  const { setSelectedIds, clearSegSel, isSelected, editingId, setEditingId, setSelectedTrackId, setSelectedVClipIds,
    setSelectedMarkerId, setSelectedSeIds,
    setSelectedMediaId, setEditingMarkerId, selectedIds } = useSel()
  const { tracks, setTracks, trackStates, setTrackStates } = useTracksCtx()  const { showToast } = useToastCtx()
  const { ratio, setRatio, exportOpts, setExportOpts, masterVolume, setMasterVolume, loudnormLUFS, setLoudnormLUFS } = useExportCtx()
  const { videoPath, setVideoPath, setVideoSrc, setVideoName, setVideoDuration, sources, setSources, sourceIdCounter, curSourceIdRef, setActiveSrcId, mediaItems, setMediaItems, mediaIdCounter, setWaveform, setThumbnailSrc, setProxyPct } = useMediaCtx()
  const { iconSide, setIconSide, iconOffset, setIconOffset, iconScale, setIconScale, iconAuto, setIconAuto, iconAnchorPos, setIconAnchorPos } = useIconsCtx()
  const { setFps } = usePlaybackCtx()
  const {
    projectPath, setProjectPath, setSrtPath, setMissingMedia, setRecentProjects,
    favorites, setFavorites, catOverrides, setCatOverrides, customCats, setCustomCats,
    userTemplates, setUserTemplates, newTelopStyle, setNewTelopStyle, transDur, setTransDur, srtPath,
    iconAssign, setIconAssignState, laneIconAssign, setLaneIconAssign, missingMedia
  } = useProjectStateCtx()

  function saveCurrentAsTemplate(): void {
    const base = selected?.style ?? newTelopStyle
    askText('テンプレート名', 'マイテロップ' + (userTemplates.length + 1), (name) => {
      if (!name) return
      const next = [...userTemplates, { name, style: structuredClone(base) }]
      setUserTemplates(next)
      saveUserTemplates(next)
    })
  }

  function deleteUserTemplate(i: number): void {
    const next = userTemplates.filter((_, k) => k !== i)
    setUserTemplates(next)
    saveUserTemplates(next)
  }

  // ※ restore（控えを画面へ戻す）は state/useHistory へ移した。
  //   控えを取る側と同じ持ち物を触るだけなのに、ここに置いていたせいで
  //   「履歴は戻す物を要り、こちらは履歴の初期化を要る」という輪になっていた。

  // ================= プロジェクト保存 / 読み込み =================
  // プロジェクトのシリアライズ（保存・自動保存で共通）
  // pathOverride: 保存直後に「保存済みの基準」を作るとき、まだ state に
  // 反映されていない新しい保存先を渡す。これを渡さないと基準が古いパスで
  // 作られ、以降ずっと「未保存の変更あり」と判定され続ける（初回保存や
  // 別名保存の直後に必ず起きていた）。
  function projectJson(pathOverride?: string | null): string {
    return JSON.stringify(
      {
        version: 1,
        // 素材が見つからなかった場合は元のパスを書き戻す（消さない）
        videoPath: videoPath ?? missingMedia?.videoPath ?? null,
        srtPath,
        // マルチソース: 元動画一覧（id/path/name）。プロキシ/波形/fpsは読込時に再生成。
        sources: sources.length
          ? sources.map((s) => ({ id: s.id, path: s.path, name: s.name }))
          : (missingMedia?.sources ?? []),
        ratio,
        tracks,
        cues,
        segments,
        seClips,
        markers,
        imgClips,
        vClips,
        // トラックの状態（ロック/非表示/ミュート/ソロ/音量）とメディアビンも保存する
        // ＝開き直したときに非表示設定や追加素材が消えないように
        trackStates,
        mediaItems: mediaItems.map((m) => ({
          path: m.path,
          name: m.name,
          kind: m.kind,
          folder: m.folder
        })),
        iconSide,
        iconOffset,
        iconScale,
        iconAuto,
        iconAnchorPos,
        // ラベル色/レーンごとのアイコン割当。プロジェクトに入れないと、別PCで開いたとき
        // 「個別にD&Dしたアイコンだけ残り、色で割り当てたアイコンが無警告で全部消える」。
        iconAssign,
        laneIconAssign,
        // 書き出し設定・音量系もプロジェクトの一部（毎回やり直し＆設定違いでの再エンコード事故を防ぐ）
        exportOpts,
        loudnormLUFS,
        masterVolume,
        transDur, // トランジションの既定長
        newTelopStyle, // このプロジェクトで次に追加するテロップの既定スタイル
        // 画面の配置（パネルの幅・段の高さ・タブ・切り離した窓）。
        // 「開き直したら前と同じ形で始まる」ようにするため、中身と一緒に持つ。
        layout: layoutNow(),
        // 現在のプロジェクトファイルパス（自動保存からの復帰でタイトル/上書き先を失わないため）
        projectPath: pathOverride !== undefined ? pathOverride : projectPath
      },
      null,
      1
    )
  }

  async function saveProjectFn(asNew = false): Promise<void> {
    if (!hasProjectContent()) {
      showToast('保存する内容がありません。')
      return
    }
    // 保留中(450msデバウンス)の履歴を先に確定させる。これが無いと
    // 「動かして即 Ctrl+S」の直後の Ctrl+Z が、その移動ではなく1つ前を取り消す。
    commitPending()
    // .gcproj 以外（例: 読み込んだSRT）を上書き先にしない安全弁
    const cur = projectPath && /\.(gcproj|json)$/i.test(projectPath) ? projectPath : null
    const res = await window.giftcut.saveProject(projectJson(), cur, asNew)
    if (res?.ok && res.path) {
      setProjectPath(res.path) // 以降の Ctrl+S はここへ上書き
      // 手動保存できたら自動保存の下書きは不要（毎起動で復帰プロンプトが出続けるのを防ぐ）
      void window.giftcut.autosaveClear()
      const saved = projectJson(res.path)
      lastAutosaveRef.current = saved
      savedJsonRef.current = saved // ここを「保存済み」の基準にする
      baselineRef.current = snapNow() // 保存時点を「未編集」の基準にする
      rememberProject(res.path) // ファイルメニューの「最近使ったプロジェクト」に出す
      markUnsavedRef.current(saved) // タイトルの「＊」を待たずに消す
      showToast('プロジェクトを保存しました:\n' + res.path, 'success')
    } else if (res?.error && res.error !== 'キャンセル')
      showToast('保存失敗: ' + res.error, 'error')
  }

  // path 省略=ダイアログで選ぶ / path 指定=最近使ったプロジェクトを直接開く
  async function openProjectFn(path?: string): Promise<void> {
    // 閉じるときは確認するのに開くときはしない、という非対称を解消する
    // （確認なしだと30分の作業が警告なしに消え、しかも自動保存の下書きも
    //   30秒後に新しいプロジェクトで上書きされて復元不能になる）
    if (!(await confirmDiscard('別のプロジェクトを開く'))) return
    const res = await window.giftcut.openProject(path)
    if (!res) return
    if (!res.ok || !res.data) {
      showToast('プロジェクトを開けませんでした:\n' + (res.error ?? '不明なエラー'), 'error')
      // 見つからなくなったファイルは一覧から外す（毎回同じエラーを踏まないように）
      if (path) setRecentProjects((prev) => prev.filter((r) => r.path !== path))
      return
    }
    await applyProjectData(res.data, !!res.videoExists, res.path ?? null)
    if (res.path) rememberProject(res.path)
  }

  // テンプレJSON＝プロジェクトタブ(メディアビン)＋テロップ設定(フォルダ/お気に入り/カテゴリ)＋比率/アイコン。
  // タイムライン(カット/配置=cues/segments/seClips/videoPath)は含めない。
  function templateJson(): string {
    return JSON.stringify(
      {
        version: 1,
        kind: 'template',
        ratio,
        mediaItems: mediaItems.map((m) => ({
          path: m.path,
          name: m.name,
          kind: m.kind,
          folder: m.folder
        })),
        iconSide,
        iconOffset,
        iconScale,
        iconAuto,
        iconAnchorPos,
        // テンプレは「開始状態を揃える」ものなので、テロップの自作テンプレと
        // アイコン割当・既定スタイルも含める（含めないと★が存在しないテンプレを指す）
        telop: { favorites, catOverrides, customCats, userTemplates },
        iconAssign,
        laneIconAssign,
        newTelopStyle,
        // 画面の配置も込みで覚える。テンプレは「開始状態を揃える」ものなので、
        // 窓を出した形で登録すれば、次からその形で始まる
        layout: layoutNow()
      },
      null,
      1
    )
  }

  /** テンプレを適用（メディアビン＋テロップ設定＋設定。タイムラインは触らない） */
  function applyProjectTemplate(data: any): void {
    const d = data as any
    // テンプレは「新規プロジェクトの開始状態」なので、保存先は引き継がない。
    // 残すと直後の Ctrl+S が元のプロジェクトを無警告で上書きしてしまう。
    setProjectPath(null)
    if (d.ratio) setRatio(d.ratio)
    if (Array.isArray(d.mediaItems)) {
      const items: MediaItem[] = d.mediaItems
        .filter((m: any) => m && typeof m.path === 'string')
        .map((m: any) => {
          const kind = kindOf(String(m.path))
          return {
            id: mediaIdCounter.current++,
            path: String(m.path),
            name: String(m.name ?? String(m.path).split(/[\\/]/).pop() ?? ''),
            kind,
            folder: typeof m.folder === 'string' ? m.folder : undefined,
            thumb: kind === 'image' ? toGcUrl(String(m.path)) : undefined
          }
        })
      // 画像はパスをそのままサムネに（テンプレ適用と同じ扱いに揃える）
      const withThumb = items.map((m) =>
        m.kind === 'image' ? { ...m, thumb: toGcUrl(m.path) } : m
      )
      setMediaItems(withThumb)
      // サムネ・尺・波形は見えている物だけ用意する（onVisible が呼ぶ）
    }
    if (d.iconSide) setIconSide(d.iconSide)
    if (d.iconOffset && typeof d.iconOffset.x === 'number') setIconOffset(d.iconOffset)
    if (typeof d.iconScale === 'number') setIconScale(d.iconScale)
    if (typeof d.iconAuto === 'boolean') setIconAuto(d.iconAuto)
    if (d.iconAnchorPos && typeof d.iconAnchorPos.x === 'number' && typeof d.iconAnchorPos.y === 'number')
      setIconAnchorPos({ x: d.iconAnchorPos.x, y: d.iconAnchorPos.y })
    // 動画ズーム（リフレーム）は切片ごと（loadedSegs で復元済み）。旧グローバル videoZoom は無視。
    //
    // テロップの整理（★/分類/自作フォルダ/自作テロップ）とアイコンの割り当ては
    // **置き換えではなく混ぜる**。混ぜ方の決まりは shared/templateMerge にあり、
    // 「いまの設定が勝つ」向きも含めてテストで見張ってある。
    // 置き換えにしていた頃は、テンプレを1回開くだけで育てた設定が全部消えた（戻せない）。
    if (d.telop) {
      const favs = mergeFavorites(favorites, d.telop.favorites)
      if (favs !== favorites) {
        setFavorites(favs)
        saveFavorites(favs)
      }
      const cats = mergeAssignments(catOverrides, d.telop.catOverrides)
      if (cats !== catOverrides) {
        setCatOverrides(cats)
        saveCatOverrides(cats)
      }
      const folders = mergeFolders(customCats, d.telop.customCats)
      if (folders !== customCats) {
        setCustomCats(folders)
        saveCustomCats(folders)
      }
      const tpls = mergeNamed(userTemplates, d.telop.userTemplates)
      if (tpls.length !== userTemplates.length) {
        setUserTemplates(tpls)
        saveUserTemplates(tpls)
      }
    }
    const icons = mergeAssignments(iconAssign, d.iconAssign)
    if (icons !== iconAssign) {
      setIconAssignState(icons)
      saveIconAssign(icons)
    }
    const laneIcons = mergeAssignments(laneIconAssign, d.laneIconAssign)
    if (laneIcons !== laneIconAssign) {
      setLaneIconAssign(laneIcons)
      saveLS('giftcut.laneIconAssign', laneIcons)
    }
    if (d.newTelopStyle && typeof d.newTelopStyle === 'object') setNewTelopStyle(d.newTelopStyle)
    // 画面の配置（窓を出した形も含む）。テンプレの目的は「開始状態を揃える」こと
    applyLayout(d.layout)
    showToast('テンプレートを読み込みました。', 'success')
  }

  // 現在の設定をテンプレートとして保存（GiftCut/テンプレート/ 配下）
  function saveAsTemplateFn(): void {
    askText('テンプレート名', 'マイテンプレート', (name) => {
      if (!name) return
      void window.giftcut.saveTemplate(name, templateJson()).then((res) => {
        if (res?.ok) showToast('テンプレートを保存しました:\n' + res.path, 'success')
        else showToast('保存失敗: ' + (res?.error ?? ''), 'error')
      })
    })
  }

  // テンプレートを開く＝テンプレートフォルダ内の一覧から選ぶ（アプリ内ピッカー）
  async function openTemplateFn(): Promise<void> {
    const t = await window.giftcut.listTemplates()
    if (!t?.ok || !t.items.length) {
      showToast('テンプレートがありません。\n「テンプレートとして保存」で作成してください。')
      return
    }
    setTemplatePicker({ items: t.items, startup: false })
  }

  async function pickTemplate(path: string): Promise<void> {
    setTemplatePicker(null)
    const res = await window.giftcut.loadTemplate(path)
    if (!res?.ok || !res.data) {
      showToast('テンプレートを開けませんでした:\n' + (res?.error ?? ''), 'error')
      return
    }
    applyProjectTemplate(res.data)
  }

  async function applyProjectData(
    data: any,
    videoExists: boolean,
    srcPath: string | null
  ): Promise<void> {
    stopPlayback()
    const d = data as any
    // 画面の配置を先に戻す（中身より先に形を作っておく）。
    // 復元でも「落ちる前と同じ形」で戻ってくる
    applyLayout(d?.layout)
    // id はファイルの値を信用せず振り直す（NaN/重複による採番汚染を防ぐ）
    const loadedCues: Cue[] = loadCues(d.cues)
    const loadedSegs: VSeg[] = loadSegs(d.segments)
    /* eslint-enable @typescript-eslint/no-explicit-any */
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const loadedSe: SEClip[] = loadSeClips(d.seClips)
    // トラック構成（追加レーン）を復元。形式が不正ならデフォルトに戻す
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const loadedTracks: Track[] = Array.isArray(d.tracks)
      ? d.tracks
          .filter(
            (t: any) =>
              t &&
              typeof t.id === 'string' &&
              /^[VA]\d+$/.test(t.id) &&
              (t.kind === 'video' || t.kind === 'audio')
          )
          .map((t: any) => ({ id: t.id, name: String(t.name ?? t.id), kind: t.kind }))
      : []
    /* eslint-enable @typescript-eslint/no-explicit-any */
    let nextTracks =
      loadedTracks.some((t) => t.id === 'V1') && loadedTracks.some((t) => t.id === 'A1')
        ? loadedTracks
        : DEFAULT_TRACKS
    // 旧プロジェクトにはBGMトラックが無いので、無ければ音声トラックの末尾に補完
    if (!nextTracks.some((t) => t.id === EXTRA_AUDIO_TRACK)) {
      const lastAudio = nextTracks.map((t) => t.kind).lastIndexOf('audio')
      const bgm: Track = { id: EXTRA_AUDIO_TRACK, name: 'A3', kind: 'audio' }
      nextTracks =
        lastAudio >= 0
          ? [...nextTracks.slice(0, lastAudio + 1), bgm, ...nextTracks.slice(lastAudio + 1)]
          : [...nextTracks, bgm]
    }
    setTracks(nextTracks)
    // トラック状態（ロック/非表示/ミュート/ソロ/音量）を復元。保存が無い/欠けている行は初期値。
    {
      const base = initTrackStates(nextTracks)
      const saved = d.trackStates
      if (saved && typeof saved === 'object') {
        for (const t of nextTracks) {
          const s = saved[t.id]
          if (!s || typeof s !== 'object') continue
          base[t.id] = {
            ...base[t.id],
            locked: s.locked === true,
            hidden: s.hidden === true,
            muted: s.muted === true,
            solo: s.solo === true,
            target: s.target === true,
            volume: typeof s.volume === 'number' ? clamp(s.volume, 0, 1) : base[t.id].volume
          }
        }
      }
      setTrackStates(base)
    }
    // メディアビン（プロジェクトに追加した素材）を復元
    if (Array.isArray(d.mediaItems)) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const items: MediaItem[] = d.mediaItems
        .filter((m: any) => m && typeof m.path === 'string')
        .map((m: any) => ({
          id: mediaIdCounter.current++,
          path: m.path,
          name: String(m.name ?? m.path.split(/[\\/]/).pop() ?? m.path),
          kind: m.kind === 'audio' || m.kind === 'image' ? m.kind : ('video' as const),
          folder: typeof m.folder === 'string' ? m.folder : undefined
        }))
      /* eslint-enable @typescript-eslint/no-explicit-any */
      setMediaItems(items)
      // サムネは見えている物だけ作る（onVisible が呼ぶ）
    }
    setSelectedTrackId(null)
    // マーカー復元（t 昇順、idは振り直し）
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const loadedMarkers: Marker[] = loadMarkers(d.markers)
    // 画像クリップ復元
    const loadedImgs: ImgClip[] = loadImgClips(d.imgClips, fallbackTrack)
    // 映像レイヤークリップ復元
    const loadedVc: VClip[] = loadVClips(d.vClips, fallbackTrack)
    /* eslint-enable @typescript-eslint/no-explicit-any */
    idCounter.current = loadedCues.length + 1
    segIdCounter.current = loadedSegs.length + 1
    seIdCounter.current = loadedSe.length + 1
    markerIdCounter.current = loadedMarkers.length + 1
    imgIdCounter.current = loadedImgs.length + 1
    // 映像レイヤーが使う「対の音声トラック」と映像トラックを補完する。
    // 無いと audioTrackGain が 0 を返して無音になり、音声帯も出ないので原因が分からない。
    if (loadedVc.length) {
      setTracks((prev) => {
        let out = [...prev]
        for (const c of loadedVc) {
          const a = 'A' + (Number(c.track.slice(1)) || 0)
          if (!out.some((t) => t.id === c.track)) {
            const firstV = out.findIndex((t) => t.kind === 'video')
            out = [
              ...out.slice(0, Math.max(0, firstV)),
              { id: c.track, name: c.track, kind: 'video' as const },
              ...out.slice(Math.max(0, firstV))
            ]
          }
          if (!out.some((t) => t.id === a)) {
            const lastA = out.map((t) => t.kind).lastIndexOf('audio')
            out = [
              ...out.slice(0, lastA + 1),
              { id: a, name: a, kind: 'audio' as const },
              ...out.slice(lastA + 1)
            ]
          }
        }
        return out
      })
      setTrackStates((prev) => {
        const out = { ...prev }
        for (const c of loadedVc) {
          const a = 'A' + (Number(c.track.slice(1)) || 0)
          if (!out[c.track]) out[c.track] = newTrackState(c.track)
          if (!out[a]) out[a] = newTrackState(a)
        }
        return out
      })
    }
    vClipIdCounter.current = loadedVc.length + 1
    resetHistory({
      cues: loadedCues,
      segments: loadedSegs,
      seClips: loadedSe,
      markers: loadedMarkers,
      imgClips: loadedImgs,
      vClips: loadedVc
    })
    setCues(loadedCues)
    setSegments(loadedSegs)
    setSeClips(loadedSe)
    setMarkers(loadedMarkers)
    setImgClips(loadedImgs)
    setVClips(loadedVc)
    setSelectedVClipIds([])
    // 映像レイヤーの波形を用意し直す（波形は mediaMeta 側にあるので、これが無いと
    // 開き直した途端に音声帯が「波形解析中…」のまま止まる）
    loadedVc.forEach((c) => prepareMediaMeta(c.path, 'video'))
    setSelectedMarkerId(null)
    setSelectedSeIds([])
    setSelectedIds([])
    setEditingId(null) // 編集オーバーレイを閉じる（idを振り直すので別テロップに付き直すのを防ぐ）
    setSelectedTrackId(null)
    clearSegSel()
    if (d.ratio === '16:9' || d.ratio === '9:16' || d.ratio === '1:1') setRatio(d.ratio)
    // アイコンの配置（側・オフセット・サイズ）プロジェクト固定
    setIconSide(
      ['left', 'right', 'top', 'bottom'].includes(d.iconSide) ? d.iconSide : 'left'
    )
    if (d.iconOffset && typeof d.iconOffset.x === 'number' && typeof d.iconOffset.y === 'number')
      setIconOffset({ x: d.iconOffset.x, y: d.iconOffset.y })
    else setIconOffset({ x: 0, y: 0 })
    setIconScale(typeof d.iconScale === 'number' && d.iconScale > 0 ? d.iconScale : 1)
    setIconAuto(d.iconAuto === true)
    setIconAnchorPos(
      d.iconAnchorPos &&
        typeof d.iconAnchorPos.x === 'number' &&
        typeof d.iconAnchorPos.y === 'number'
        ? { x: d.iconAnchorPos.x, y: d.iconAnchorPos.y }
        : null
    )
    // ラベル色/レーンごとのアイコン割当（プロジェクト固定。無ければ現在の設定を維持）
    if (d.iconAssign && typeof d.iconAssign === 'object') {
      setIconAssignState(d.iconAssign)
      saveIconAssign(d.iconAssign)
    }
    if (d.laneIconAssign && typeof d.laneIconAssign === 'object') {
      setLaneIconAssign(d.laneIconAssign)
      saveLS('giftcut.laneIconAssign', d.laneIconAssign)
    }
    // 書き出し設定・音量・トランジション既定長・既定テロップスタイル
    if (d.exportOpts && typeof d.exportOpts === 'object') {
      const eo = d.exportOpts
      setExportOpts({
        resP: [2160, 1080, 720, 480].includes(eo.resP) ? eo.resP : 1080,
        // 旧形式は数値のみ。その値は尊重し、未知の値だけ 'source'（素材と同じ）に落とす
        fps: eo.fps === 'source' || [24, 30, 60].includes(eo.fps) ? eo.fps : 'source',
        quality: ['high', 'med', 'low'].includes(eo.quality) ? eo.quality : 'high'
      })
    }
    if (d.loudnormLUFS === null || typeof d.loudnormLUFS === 'number')
      setLoudnormLUFS(d.loudnormLUFS)
    if (typeof d.masterVolume === 'number') setMasterVolume(clamp(d.masterVolume, 0, 1))
    if (typeof d.transDur === 'number' && d.transDur > 0) setTransDur(d.transDur)
    if (d.newTelopStyle && typeof d.newTelopStyle === 'object') setNewTelopStyle(d.newTelopStyle)
    // 保存元のパス（自動保存からの復帰では srcPath が無いので、JSON内の projectPath を使う）
    setProjectPath(srcPath ?? (typeof d.projectPath === 'string' ? d.projectPath : null))
    // 開いた直後は「未保存の変更なし」。次のレンダー後の内容を基準にする
    window.setTimeout(() => {
      const json = projectJsonRef.current()
      savedJsonRef.current = json
      markUnsavedRef.current(json) // タイトルの「＊」もその場で消す
    }, 0)
    if (typeof d.srtPath === 'string') setSrtPath(d.srtPath)
    // 将来の新形式を旧バイナリが黙って読み書きして壊さないための検証
    if (typeof d.version === 'number' && d.version > 1)
      showToast('このプロジェクトは新しい形式です。一部の設定が読み込めない可能性があります。')
    setEditingMarkerId(null)
    setSelectedMediaId(null)
    setTime(0)
    setWaveform(null)
    setThumbnailSrc(null)
    if (typeof d.videoPath === 'string' && d.videoPath && videoExists) {
      const vp = d.videoPath
      // マルチソース: 保存された sources を復元（無ければ videoPath 単独）。idは保存値を維持（切片のsrcId整合）。
      const savedSources = Array.isArray(d.sources)
        ? d.sources.filter((s: any) => s && typeof s.path === 'string' && typeof s.id === 'number')
        : []
      const loadedSources: Source[] = (
        savedSources.length ? savedSources : [{ id: 1, path: vp, name: vp.split(/[\\/]/).pop() }]
      ).map((s: any) => ({
        id: s.id,
        path: s.path,
        name: String(s.name ?? s.path.split(/[\\/]/).pop() ?? s.path),
        origUrl: toGcUrl(s.path),
        duration: 0,
        fps: FPS,
        waveform: null
      }))
      setSources(loadedSources)
      sourceIdCounter.current = Math.max(0, ...loadedSources.map((s) => s.id)) + 1
      // 主ソース（先頭）＝プレビュー対象。既存の videoPath はこの先頭に一致させて保存している。
      const primary = loadedSources.find((s) => s.path === vp) ?? loadedSources[0]
      curSourceIdRef.current = primary.id
      setActiveSrcId(primary.id)
      videoElsRef.current.clear()
      // 読込したプロジェクトには既に切片があるので、初期切片の自動生成はしない
      initializedForPathRef.current = primary.path
      setVideoPath(primary.path)
      setVideoName(primary.name)
      setVideoSrc(primary.origUrl)
      // プレビュー用プロキシは「プレビュー解像度」の effect が sources を見て用意する
      // （キャッシュ済みなら即完了。原本指定のときは作らない）
      proxyForPathRef.current = primary.path
      setMissingMedia(null) // 正常に読み込めたので欠損情報は不要
      setFps(FPS)
      void window.giftcut.getFps(primary.path).then((r) => {
        if (proxyForPathRef.current !== primary.path) return
        // fps だけでなく素材の大きさも控える（書き出しの既定がここから決まる）
        if (r?.ok && r.fps && r.fps > 0) {
          const f = Math.round(r.fps * 1000) / 1000
          setFps(f)
          updateSource(primary.id, { fps: f, ...(r.w && r.h ? { w: r.w, h: r.h } : {}) })
        } else if (r?.w && r?.h) updateSource(primary.id, { w: r.w, h: r.h })
      })
      // 追加ソースは背景でプロキシ/波形/長さ/fpsを生成
      loadedSources.filter((s) => s.id !== primary.id).forEach((s) => hydrateSource(s.id, s.path))
      const [wf, th] = await Promise.all([
        window.giftcut.generateWaveform(primary.path),
        window.giftcut.generateThumbnail(primary.path)
      ])
      if (proxyForPathRef.current !== primary.path) return // 解析中に別プロジェクト/動画へ切替えた
      if (wf?.ok && wf.min && wf.max) {
        const wv = { min: wf.min, max: wf.max, dur: wf.duration ?? 0 }
        setWaveform(wv)
        updateSource(primary.id, { waveform: wv })
      }
      if (th?.ok && th.path) setThumbnailSrc(toGcUrl(th.path))
    } else {
      setVideoPath(null)
      setVideoSrc(null)
      setVideoName(null)
      setVideoDuration(0)
      setFps(FPS)
      // 見つからなかったパスは捨てずに保持する。捨てると Ctrl+S で
      // 元動画パスと追加ソース一覧が永久に失われ、素材を戻しても紐付け直せない。
      setMissingMedia({
        videoPath: typeof d.videoPath === 'string' ? d.videoPath : null,
        sources: Array.isArray(d.sources) ? d.sources : []
      })
      setSources([])
      curSourceIdRef.current = null
      // 前の動画のプロキシ生成が走っていた場合、完成後に勝手にプレビューへ入るのを防ぐ
      proxyForPathRef.current = null
      setProxyPct(null)
      // 常設していた <video> の後始末（detachされた古い要素を掴み続けないように）
      videoElsRef.current.clear()
      setActiveSrcId(null)
      videoRef.current = null
      if (typeof d.videoPath === 'string' && d.videoPath) {
        showToast(
          '動画ファイルが見つかりません:\n' + d.videoPath + '\nテロップとカット情報のみ読み込みました。'
        )
      }
    }
  }

  /**
   * テロップテンプレを適用（選択があればそれに、無ければ次に足すテロップの既定に）。
   * レイアウト(anchor/box)とアニメは維持し、見た目だけ差し替える。
   */
  function applyTemplate(tpl: TelopStyle): void {
    setNewTelopStyle(tpl)
    // 編集中＋文字選択ありなら、プリセットの色/フォント/サイズを「選択文字だけ」に(runs)適用
    const editing = editingId != null ? cues.find((c) => c.id === editingId) : null
    if (editing && isSelected(editing.id)) {
      const { start, end } = curSel()
      if (end > start) {
        // プリセットを選択文字だけに適用＝塗り(グラデ優先)・背景・フォント・サイズを丸ごと反映。
        const patch: Partial<TextRun> = {}
        if (tpl.fill?.gradient && tpl.fill.gradient.stops?.length >= 2) {
          patch.gradient = tpl.fill.gradient
          patch.color = undefined
        } else {
          const col = runColorFromStyle(tpl)
          if (col) patch.color = col
          patch.gradient = undefined
        }
        patch.bgColor = tpl.background?.enabled ? tpl.background.color : undefined
        // 縁・影・結合も選択文字に反映。文字サイズは現状維持（プリセットのfontSizeは持ち込まない）。
        // 縁幅・影寸法はテロップのサイズ比 k で相似スケール（プリセットごとにfontSizeが違うため）。
        const k =
          editing.style.fontSize > 0 && tpl.fontSize > 0 ? editing.style.fontSize / tpl.fontSize : 1
        const r1 = (n: number): number => Math.round(n * 10) / 10
        patch.strokes = (tpl.strokes ?? []).map((st) => ({ ...st, width: r1(st.width * k) }))
        patch.shadows = [
          ...(tpl.shadow && tpl.shadow.enabled ? [tpl.shadow] : []),
          ...(tpl.shadows || [])
        ].map((sd) => ({
          ...sd,
          distance: r1(sd.distance * k),
          blur: r1(sd.blur * k),
          ...(sd.spread != null ? { spread: r1(sd.spread * k) } : {})
        }))
        patch.join = tpl.join
        if (tpl.fontFamily) patch.fontFamily = tpl.fontFamily
        applyRunRange(editing.id, start, end, patch)
        return
      }
    }
    if (selectedIds.length) {
      // 文字未選択で全体にプリセット適用＝部分装飾(runs)を全リセットし「見た目だけ」を載せる
      // （テキスト枠＝サイズ等は現状維持: mergeTemplateKeepFrame）。
      setCues((prev) =>
        prev.map((c) =>
          isSelected(c.id)
            ? { ...c, style: mergeTemplateKeepFrame(c.style, tpl), runs: undefined }
            : c
        )
      )
      // 編集オーバーレイを閉じる（開いたままだとテロップに被さって次のダブルクリックを奪う）。
      setEditingId(null)
    }
  }

  // プリセットを「見た目だけ」適用するマージ。テキスト枠の設定（サイズ・字間・行間・揃え・
  // アンカー・箱・アニメ）は適用前の現在値を維持する（Adobe由来プリセットは1個ずつfontSizeが
  // 違うため、丸ごと適用するとテロップのサイズが毎回変わってしまう）。
  // 縁・影・背景の寸法はサイズ比 k で相似スケールし、プリセットの見た目の均整を保つ。
  function mergeTemplateKeepFrame(cur: TelopStyle, tpl: TelopStyle): TelopStyle {
    const k = cur.fontSize > 0 && tpl.fontSize > 0 ? cur.fontSize / tpl.fontSize : 1
    const r1 = (n: number): number => Math.round(n * 10) / 10
    const scSh = <T extends { distance: number; blur: number; spread?: number }>(sd: T): T => ({
      ...sd,
      distance: r1(sd.distance * k),
      blur: r1(sd.blur * k),
      ...(sd.spread != null ? { spread: r1(sd.spread * k) } : {})
    })
    return {
      ...tpl,
      fontSize: cur.fontSize,
      tracking: cur.tracking,
      leading: cur.leading,
      align: cur.align,
      anchor: cur.anchor,
      box: cur.box,
      anim: cur.anim,
      strokes: (tpl.strokes || []).map((st) => ({ ...st, width: r1(st.width * k) })),
      shadow: tpl.shadow ? scSh(tpl.shadow) : tpl.shadow,
      shadows: tpl.shadows ? tpl.shadows.map(scSh) : tpl.shadows,
      background: tpl.background
        ? {
            ...tpl.background,
            ...(tpl.background.size != null ? { size: r1(tpl.background.size * k) } : {}),
            ...(tpl.background.corner != null ? { corner: r1(tpl.background.corner * k) } : {})
          }
        : tpl.background
    }
  }

  // テンプレをテロップにドロップして適用。落とした先が選択中の一部なら選択全部に反映。
  function applyTemplateToCue(cueId: number, tpl: TelopStyle): void {
    setNewTelopStyle(tpl)
    const targets = selectedIds.includes(cueId) && selectedIds.length ? selectedIds : [cueId]
    setCues((prev) =>
      prev.map((c) =>
        targets.includes(c.id)
          ? { ...c, style: mergeTemplateKeepFrame(c.style, tpl), runs: undefined }
          : c
      )
    )
    setEditingId(null)
  }

  return { saveCurrentAsTemplate, deleteUserTemplate, projectJson, saveProjectFn, openProjectFn, templateJson, applyProjectTemplate, saveAsTemplateFn, openTemplateFn, pickTemplate, applyProjectData, applyTemplate, mergeTemplateKeepFrame, applyTemplateToCue }
}
