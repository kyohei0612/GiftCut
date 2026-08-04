// **読んだプロジェクトを画面へ流し込む。** ここがこのアプリで一番「静かに壊れる」所。
//
// ## 拾い忘れた項目は、エラーも出ずに消える
//
// 保存側（./useProjectFile の `projectJson`）に項目を足したのに、ここで拾い忘れると、
// **開いた瞬間に既定値へ戻る**。落ちないので気づかず、気づいたときには
// その設定で保存し直されている。**項目を足すときは必ず両方を直すこと。**
//
// ## 読み込みの整え直しは lib/projectLoad
//
// 古い版のファイル・欠けた項目・型のズレを吸収するのはあちら（試験で押さえてある）。
// ここの仕事は「整った物を、どの心臓へ入れるか」だけ。
//
// ## なぜ state/useProjectFile から出したか（2026-08-04）
//
// あちらは542行のうち **297行がこの1つの関数**だった。記号解決で測ったら
// **受け取る24・返す0**——しかも受け取る24は**全部 import か型**で、
// 局所の名前は1つも要らなかった（`引き継ぎ-心臓の分け直し.md`）。
//
// deps は**あちらの定義から17行を移した**（書き写していない）。あちらの
// `UseProjectFileDeps` が下の `UseProjectApplyDeps` を extends するので、
// **依存は一方向**（親 → 子）のまま。
import { toGcUrl } from '../lib/gcUrl'
import { clamp, FPS_FALLBACK as FPS } from '../../../shared/timeline'
import { loadCues, loadSegs, loadSeClips, loadMarkers, loadImgClips, loadVClips } from '../lib/projectLoad'
import {
  DEFAULT_TRACKS,
  EXTRA_AUDIO_TRACK,
  initTrackStates,
  newTrackState,
  normalizeTrackName
} from '../lib/trackState'
import { saveIconAssign } from '../lib/iconLibrary'
import type { Cue } from '../lib/srt'
import type { ImgClip, Marker, SEClip, Source, Track, VClip, VSeg } from '../lib/projectTypes'
import type { Snap } from './useHistory'
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

export interface UseProjectApplyDeps {
  stopPlayback: () => void
  setTime: (t: number) => void
  fallbackTrack: (id: string, kind: 'video' | 'audio') => string
  /** 配置の当てはめ。**中身が `any` なのは借りている側もそうだから**（直すならあちらが先） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyLayout: (l: any) => void
  resetHistory: (base: Snap) => void
  prepareMediaMeta: (path: string, kind: 'video' | 'audio' | 'image') => void
  idCounter: React.MutableRefObject<number>
  savedJsonRef: React.MutableRefObject<string | null>
  projectJsonRef: React.MutableRefObject<(p?: string | null) => string>
  markUnsavedRef: React.MutableRefObject<(nowJson?: string) => void>
  initializedForPathRef: React.MutableRefObject<string | null>
  proxyForPathRef: React.MutableRefObject<string | null>
  videoElsRef: React.MutableRefObject<Map<string, HTMLVideoElement>>
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
  saveLS: (key: string, v: unknown) => void
  hydrateSource: (id: number, path: string) => void
  updateSource: (id: number, patch: Partial<Source>) => void
}

export function useProjectApply(deps: UseProjectApplyDeps) {
  const {
    stopPlayback, setTime, fallbackTrack, applyLayout, resetHistory, prepareMediaMeta,
    idCounter, savedJsonRef, projectJsonRef, markUnsavedRef, initializedForPathRef,
    proxyForPathRef, videoElsRef, videoRef, saveLS, hydrateSource, updateSource
  } = deps
  // **入れる側しか要らない。** いまの値を読むのは保存する側（./useProjectFile）
  const { setCues, setSegments, setSeClips, setImgClips, setVClips, setMarkers, segIdCounter, seIdCounter, imgIdCounter, vClipIdCounter, markerIdCounter } = useDoc()
  const { setSelectedIds, clearSegSel, setEditingId, setSelectedTrackId, setSelectedVClipIds,
    setSelectedMarkerId, setSelectedSeIds,
    setSelectedMediaId, setEditingMarkerId } = useSel()
  const { setTracks, setTrackStates } = useTracksCtx()
  const { showToast } = useToastCtx()
  const { setRatio, setExportOpts, setMasterVolume, setLoudnormLUFS } = useExportCtx()
  const { setVideoPath, setVideoSrc, setVideoName, setVideoDuration, setSources, sourceIdCounter, curSourceIdRef, setActiveSrcId, setMediaItems, mediaIdCounter, setWaveform, setThumbnailSrc, setProxyPct } = useMediaCtx()
  // **入れる側しか要らない。** ここは流し込む所なので、いまの値は読まない
  const { setIconSide, setIconOffset, setIconScale, setIconAuto, setIconAnchorPos } = useIconsCtx()
  const { setFps } = usePlaybackCtx()
  const {
    setProjectPath, setSrtPath, setMissingMedia,
    setNewTelopStyle, setTransDur, setIconAssignState, setLaneIconAssign
  } = useProjectStateCtx()

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
    const loadedSe: SEClip[] = loadSeClips(d.seClips)
    // トラック構成（追加レーン）を復元。形式が不正ならデフォルトに戻す
    const loadedTracks: Track[] = Array.isArray(d.tracks)
      ? d.tracks
          .filter(
            (t: any) =>
              t &&
              typeof t.id === 'string' &&
              /^[VA]\d+$/.test(t.id) &&
              (t.kind === 'video' || t.kind === 'audio')
          )
          // 前の既定に付いていた注釈（「V2 テロップ」など）は番号だけに戻す。
          // 名前はプロジェクトに保存されるので、既定を変えただけでは
          // 開き直した人の画面が前のまま＝新しい段と書き方が混ざる
          .map((t: any) => ({
            id: t.id,
            name: normalizeTrackName(t.id, String(t.name ?? t.id)),
            kind: t.kind
          }))
      : []
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
      const items: MediaItem[] = d.mediaItems
        .filter((m: any) => m && typeof m.path === 'string')
        .map((m: any) => ({
          id: mediaIdCounter.current++,
          path: m.path,
          name: String(m.name ?? m.path.split(/[\\/]/).pop() ?? m.path),
          kind: m.kind === 'audio' || m.kind === 'image' ? m.kind : ('video' as const),
          folder: typeof m.folder === 'string' ? m.folder : undefined
        }))
      setMediaItems(items)
      // サムネは見えている物だけ作る（onVisible が呼ぶ）
    }
    setSelectedTrackId(null)
    // マーカー復元（t 昇順、idは振り直し）
    const loadedMarkers: Marker[] = loadMarkers(d.markers)
    // 画像クリップ復元
    const loadedImgs: ImgClip[] = loadImgClips(d.imgClips, fallbackTrack)
    // 映像レイヤークリップ復元
    const loadedVc: VClip[] = loadVClips(d.vClips, fallbackTrack)
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

  return { applyProjectData }
}
