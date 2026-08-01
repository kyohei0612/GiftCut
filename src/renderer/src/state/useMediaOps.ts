// 素材の読み込みと、焼き直し（プロキシ）の面倒。
//
// ## 焼き直しとは
//
// 原本は数秒に1枚しかキーフレームが無いので、カットで飛ぶたびに
// 復号し直しが起きて**絵が100〜200ms止まる**。全コマがキーフレームの映像を
// 別に作っておき、プレビューではそちらを流す。
//
// **書き出しは必ず原本を使う**（焼き直しは粗いので、完成品の画質には影響させない）。
import { toGcUrl } from '../lib/gcUrl'
import { FPS_FALLBACK as FPS } from '../../../shared/timeline'
import type { MediaItem } from '../components/panels/ProjectBinTab'
import type { Source, VSeg } from '../lib/projectTypes'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useMediaCtx } from './mediaContext'
import { useToastCtx } from './toastContext'
import { usePlaybackCtx } from './playbackContext'

export interface UseMediaOpsDeps {
  stopPlayback: () => void
  setTime: (t: number) => void
  duration: number
  /** その段が今も在るか見て、無ければ在る段へ寄せる */
  fallbackTrack: (id: string, kind: 'video' | 'audio') => string
  /** 拡張子から種類を見分ける */
  kindOf: (path: string) => 'video' | 'image' | 'audio'
  /* eslint-disable @typescript-eslint/no-explicit-any */
  placeImage: (...a: any[]) => any
  placeSE: (...a: any[]) => any
  placeVideoAtDrop: (...a: any[]) => any
  setOpenAccSec: (fn: (p: Record<string, string[]>) => Record<string, string[]>) => void
  /* eslint-enable @typescript-eslint/no-explicit-any */
  videoElsRef: React.MutableRefObject<Map<string, HTMLVideoElement>>
  /** いま焼き直している原本のパス */
  proxyForPathRef: React.MutableRefObject<string | null>
  srcAddedAtRef: React.MutableRefObject<Map<number, number>>
  /** この動画について初期の切片を作ったか */
  initializedForPathRef: React.MutableRefObject<string | null>
  /** 履歴の控え（読み込みで積み直すため） */
  /* eslint-disable @typescript-eslint/no-explicit-any */
  baselineRef: React.MutableRefObject<any>
  redoStackRef: React.MutableRefObject<any[]>
  pendingTimerRef: React.MutableRefObject<number | null>
  undoStackRef: React.MutableRefObject<any[]>
  suppressHistoryRef: React.MutableRefObject<boolean>
  /** パス → gcfile URL */  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export function useMediaOps(deps: UseMediaOpsDeps) {
  const { stopPlayback, setTime, duration, fallbackTrack, kindOf, placeImage, placeSE, placeVideoAtDrop, setOpenAccSec, videoElsRef, proxyForPathRef, srcAddedAtRef, initializedForPathRef, baselineRef, redoStackRef, pendingTimerRef, undoStackRef, suppressHistoryRef } = deps
  const { segments, setSegments, segIdCounter, cuesRef, segsRef, seClipsRef } = useDoc()
  const { clearSegSel } = useSel()
  const { videoPath, setVideoPath, videoSrc, setVideoSrc, setVideoName, setVideoDuration, setProxyPct, setWaveform, setThumbnailSrc, sources, setSources, sourcesRef, sourceIdCounter, curSourceIdRef, setActiveSrcId, mediaItems, setMediaItems, mediaIdCounter } = useMediaCtx()
  const { showToast } = useToastCtx()
  const { setFps, fpsRef, currentTimeRef } = usePlaybackCtx()

  // seg の元動画を返す（srcId 未指定 or 見つからなければ主ソース）
  function srcOfSeg(seg: VSeg | undefined): Source | undefined {
    const list = sourcesRef.current
    if (!list.length) return undefined
    if (seg?.srcId == null) return list[0]
    return list.find((s) => s.id === seg.srcId) ?? list[0]
  }

  function updateSource(id: number, patch: Partial<Source>): void {
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  // ソースの付随データ（長さ/fps/プロキシ/波形）を非同期取得して反映（プロジェクト読込の追加ソース用）
  function hydrateSource(id: number, path: string): void {
    void window.giftcut.getDuration(path).then((r) => {
      if (r?.ok && r.duration && r.duration > 0) updateSource(id, { duration: r.duration })
    })
    void window.giftcut.getFps(path).then((r) => {
      if (r?.ok && r.fps && r.fps > 0) updateSource(id, { fps: Math.round(r.fps * 1000) / 1000 })
    })
    // プロキシは「プレビュー解像度」の effect が sources を見て一括で用意する（ここでは作らない）
    void window.giftcut.generateWaveform(path).then((r) => {
      if (r?.ok && r.min && r.max)
        updateSource(id, { waveform: { min: r.min, max: r.max, dur: r.duration ?? 0 } })
    })
  }

  /**
   * 素材を**再生ヘッドの位置へ置く**（ダブルクリック用）。
   *
   * 置く場所をマウスで指す必要があるのはドラッグだけで、
   * 「とりあえず今いる所に足したい」ときにドラッグを強いるのは手間なだけ。
   * プレミアも素材のダブルクリック／挿入は再生ヘッド基準。
   * どのレーンに載せるかは、ドラッグで何も指さなかったときと同じ既定に合わせる。
   */
  function addMediaAtPlayhead(m: MediaItem): void {
    const t = currentTimeRef.current
    if (m.kind === 'video') void placeVideoAtDrop(m.path, t, false)
    else if (m.kind === 'audio') void placeSE(m, t, 'A2')
    else placeImage(m, t, fallbackTrack('V3', 'video'))
  }

  // 指定パスの動画をアクティブ動画として読み込む（差し替え）
  // placed=true: 切片は呼び出し側が置くので、読み込み時の自動配置（先頭に全長1本）はしない。
  async function loadVideo(path: string, opts?: { placed?: boolean }): Promise<void> {
    stopPlayback()
    // 動画差し替え: 履歴を破棄し、segsRef も同期リセット（onLoadedMetadata の初期化レース対策）
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current)
      pendingTimerRef.current = null
    }
    undoStackRef.current = []
    redoStackRef.current = []
    baselineRef.current = { cues: cuesRef.current, segments: [], seClips: seClipsRef.current }
    segsRef.current = []
    suppressHistoryRef.current = true
    setSegments([])
    clearSegSel()
    segIdCounter.current = 1
    setVideoSrc(toGcUrl(path))
    setVideoPath(path)
    setVideoName(path.split(/[\\/]/).pop() ?? null)
    setTime(0)
    setWaveform(null)
    setThumbnailSrc(null)
    // マルチソース: 主ソース(sources[0])として登録し直す（差し替え=単一ソースに戻す）
    const srcId = sourceIdCounter.current++
    curSourceIdRef.current = srcId
    setActiveSrcId(srcId)
    videoElsRef.current.clear() // 旧ソースの要素は破棄される
    // 新しい動画なので初期切片を1度だけ作る。ただし呼び出し側が位置を決めて置く場合は、
    // 「もう初期化済み」にしておいて自動配置（先頭に全長1本）を止める。
    initializedForPathRef.current = opts?.placed ? path : null
    setSources([
      {
        id: srcId,
        path,
        name: path.split(/[\\/]/).pop() ?? path,
        origUrl: toGcUrl(path),
        duration: 0,
        fps: FPS,
        waveform: null
      }
    ])
    // 素材の実fpsを取得（フレームステップ/タイムコード/カット量子化に反映）。失敗時は既定30。
    setFps(FPS)
    void window.giftcut.getFps(path).then((r) => {
      if (proxyForPathRef.current === path && r?.ok && r.fps && r.fps > 0) {
        const f = Math.round(r.fps * 1000) / 1000
        setFps(f)
        updateSource(srcId, { fps: f })
      }
    })
    // ライブラリに無ければ追加（File メニューからの読み込み等）
    setMediaItems((prev) =>
      prev.some((m) => m.path === path)
        ? prev
        : [
            ...prev,
            { id: mediaIdCounter.current++, path, name: path.split(/[\\/]/).pop() ?? path, kind: 'video' as const }
          ]
    )
    // 編集用プロキシ（キーフレーム密＝シーク高速）は「プレビュー解像度」の effect が sources を
    // 見て生成し、出来たら上のソース切替 effect が src を差し替える。原本指定なら生成しない。
    // 書き出しは videoPath(原本) を使うので画質は劣化しない。
    proxyForPathRef.current = path
    const [wf, th] = await Promise.all([
      window.giftcut.generateWaveform(path),
      window.giftcut.generateThumbnail(path)
    ])
    if (proxyForPathRef.current !== path) return // 解析中に別動画へ切替えた（前の波形/サムネを出さない）
    if (wf?.ok && wf.min && wf.max) {
      const wv = { min: wf.min, max: wf.max, dur: wf.duration ?? 0 }
      setWaveform(wv)
      updateSource(srcId, { waveform: wv })
    }
    if (th?.ok && th.path) {
      const url = toGcUrl(th.path)
      setThumbnailSrc(url) // タイムラインの動画クリップ用
      setMediaItems((prev) => prev.map((m) => (m.path === path ? { ...m, thumb: url } : m)))
    }
  }

  // マルチソース: 動画を「新しい元動画」としてソース登録（既存の切片・編集はそのまま）。
  // プロキシ/波形/fps/サムネは非同期で後追い反映。切片の配置は呼び出し側が行う。
  async function registerSource(path: string): Promise<{ id: number; dur: number } | null> {
    const dRes = await window.giftcut.getDuration(path)
    const dur = dRes?.ok && dRes.duration ? dRes.duration : 0
    if (dur <= 0) {
      showToast('動画の長さを取得できませんでした。', 'error')
      return null
    }
    // 同じパスが登録済みならそれを再利用（1動画=1ソース。切片だけ増やす）
    const existing = sourcesRef.current.find((s) => s.path === path)
    if (existing) return { id: existing.id, dur: existing.duration || dur }
    const id = sourceIdCounter.current++
    const name = path.split(/[\\/]/).pop() ?? path
    srcAddedAtRef.current.set(id, performance.now()) // GCの猶予用
    setSources((prev) => [
      ...prev,
      { id, path, name, origUrl: toGcUrl(path), duration: dur, fps: FPS, waveform: null }
    ])
    // ライブラリにも追加
    setMediaItems((prev) =>
      prev.some((m) => m.path === path)
        ? prev
        : [...prev, { id: mediaIdCounter.current++, path, name, kind: 'video' as const }]
    )
    // 後追い: fps / 波形 / サムネ（プロキシは「プレビュー解像度」の effect が用意する）
    void window.giftcut.getFps(path).then((r) => {
      if (r?.ok && r.fps && r.fps > 0) updateSource(id, { fps: Math.round(r.fps * 1000) / 1000 })
    })
    void window.giftcut.generateWaveform(path).then((r) => {
      if (r?.ok && r.min && r.max)
        updateSource(id, { waveform: { min: r.min, max: r.max, dur: r.duration ?? 0 } })
    })
    void window.giftcut.generateThumbnail(path).then((r) => {
      if (r?.ok && r.path) {
        const url = toGcUrl(r.path)
        setMediaItems((prev) => prev.map((m) => (m.path === path ? { ...m, thumb: url } : m)))
      }
    })
    return { id, dur }
  }

  function addMediaPaths(paths: string[], folder?: string): void {
    if (!paths.length) return
    const existing = new Set(mediaItems.map((m) => m.path))
    const add: MediaItem[] = paths
      .filter((p) => !existing.has(p))
      .map((p) => {
        const kind = kindOf(p)
        return {
          id: mediaIdCounter.current++,
          path: p,
          name: p.split(/[\\/]/).pop() ?? p,
          kind,
          folder,
          thumb: kind === 'image' ? toGcUrl(p) : undefined
        }
      })
    if (!add.length) return
    setMediaItems((prev) => [...prev, ...add])
    // 追加した種類のフォルダを自動で開く（テロップタブと同じ「開いて見せる」動作＝追加が迷子にならない）
    // 追加した種類は必ず開いた状態にする（追加が迷子にならない）。
    // プロジェクトタブは複数同時に開けるので、他を閉じずに足すだけでよい。
    setOpenAccSec((p: Record<string, string[]>) => ({
      ...p,
      project: [...new Set([...(p.project ?? []), add[0].kind])]
    }))
    // サムネと波形は**見えている素材だけ**用意する（ビンが用意できたら onVisible が呼ぶ）。
    // 全部ぶん用意していた頃は、フォルダ丸ごと追加で500件を超えると
    // 1操作 94.5ms・1000件ごとに +26.7MB まで膨らんでいた。
    // 波形は全長デコードなので、見てもいない素材のぶんまで抱えると効く。
    // 追加しただけではタイムラインに載せない。置く位置は自分で決めるもので、
    // 勝手に先頭へ置かれると2本目以降が後ろに回って並べ直しになる。
    // タイムラインへドラッグするか、ビンでダブルクリックすると読み込まれる。
  }

  return { srcOfSeg, updateSource, hydrateSource, addMediaAtPlayhead, loadVideo, registerSource, addMediaPaths }
}
