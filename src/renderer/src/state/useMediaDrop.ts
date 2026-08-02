// 素材を掴んでタイムラインへ落とす。**どの段の、どこへ置くか**を決める所。
//
// ## 駐禁を作らない
//
// どこへ落としても必ずどこかへ置く。置けない段（音を映像段へ、など）に落ちたときは、
// **一番近い置ける段**へ寄せる。置けない場所があると、そこだけ 🚫 が出て
// 「壊れている」ように見えるうえ、なぜ置けないのかも分からない。
//
// ## 同じ種類なら、落とした段に置く
//
// 一番上の段に固定すると、段を分けて重ねる使い方ができない。
// 判定に使うのは種類だけ（mp3 かどうか、など）で、置き場所は自由にする。
//
// ## 離す前に「ここに、この長さで入る」を見せる
//
// 落とした瞬間に他のクリップを押しのけたり上書きしたりするので、
// ゴースト（半透明の影）で先に見せる。中身は timeline/DropGhosts.tsx。
//
// ## 素材の中身は落とす前に調べておく
//
// 尺や波形が分からないと、ゴーストの長さも波形も出せない。
// 掴んだ時点で調べ始めて、間に合わなければ「解析中」と書く。

import { EMPTY_DRAG_IMG } from '../lib/dragChip'
import { clamp, fadeGain } from '../../../shared/timeline'
import { zoomAt, type ClipMotion } from '../../../shared/clipMotion'
import { isNeutralZoom } from '../lib/clipLook'
import { newTrackState } from '../lib/trackState'
import type { ImgClip, SEClip, VClip } from '../lib/projectTypes'
import type { MediaItem } from '../components/panels/ProjectBinTab'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { avoidBusyLane } from '../../../shared/lanes'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'
import { useMediaCtx } from './mediaContext'
import { usePlaybackCtx } from './playbackContext'
import { useViewCtx } from './viewContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface UseMediaDropDeps {
  /** 掴んでいる絵を消すための透明画像（既定の巨大なゴーストを出さない） */
  /** 効果音を置くとき、足りなければ増やす音声段の名前 */
  EXTRA_AUDIO_TRACK: string
  dragSeDurRef: any
  /** いま掴んでいる素材 */
  draggingMediaRef: any
  /** 縦位置から段を割り出す */
  dropLaneAt: any
  fallbackTrack: any
  /** テロップが載っている段（既定の扱いを1か所にするため受け取る） */
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  cueTrack: (c: any) => string
  /** 段を正しい並びで足す */
  insertTrackOrdered: any
  /** その素材が、いまタイムラインで使われているか */
  mediaInUse: any
  /** 調べ終わった素材の中身（尺・波形）。掴んでいる最中に読むので ref */
  mediaMetaRef: any
  /** これから調べる素材の待ち行列 */
  mediaQueue: any
  metaInFlightRef: any
  /** 映像段と対になる音声段の名前（V2 → A2） */
  pairedAudioOf: any
  placeVideoAtDrop: any
  /** 映像と音の段を対で確保する */
  reserveTrackPairForVideo: any
  scrollRef: React.RefObject<HTMLDivElement>
  trackInnerRef: React.RefObject<HTMLDivElement>
  /** 吸着（クリップの左右どちらの端でも寄せる） */
  snapClipStart: any
  /** どこからも使われなくなった元動画 */
  staleSourceIds: any
  trackFromEvent: any
  trackNum: (id: string) => number
  vcLen: (c: VClip) => number
  /** 調べ終わった素材の中身の置き場 */
  setMediaMeta: React.Dispatch<
    React.SetStateAction<
      Record<string, { dur?: number; wave?: { min: number[]; max: number[]; dur: number } }>
    >
  >
  setImgGhost: any
  setSeGhost: any
  setVideoGhost: any
  setSnapLineX: (x: number | null) => void
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useMediaDrop(deps: UseMediaDropDeps) {
  const {
    EXTRA_AUDIO_TRACK, dragSeDurRef, draggingMediaRef, dropLaneAt,
    fallbackTrack, cueTrack, insertTrackOrdered, mediaInUse, mediaMetaRef, mediaQueue,
    metaInFlightRef, pairedAudioOf, placeVideoAtDrop, reserveTrackPairForVideo,
    scrollRef, trackInnerRef, snapClipStart, staleSourceIds, trackFromEvent, trackNum,
    vcLen, setMediaMeta, setImgGhost, setSeGhost, setVideoGhost, setSnapLineX
  } = deps
  const {
    cuesRef, seClips, setSeClips, seClipsRef, seIdCounter, imgClipsRef, imgIdCounter,
    setImgClips, segsRef, vClips, setVClips, vClipsRef, vClipIdCounter
  } = useDoc()
  const {
    selectedImgIds, setSelectedImgIds, setSelectedSeIds, selectedVClipIds,
    setSelectedVClipIds, setSelectedMediaIds
  } = useSel()
  const { tracks, setTracks, trackStates, setTrackStates } = useTracksCtx()
  const { showToast } = useToastCtx()
  const {
    mediaItems, setMediaItems, sourcesRef, setSources, videoPath, setVideoPath,
    setVideoSrc, setVideoName, setVideoDuration, setThumbnailSrc
  } = useMediaCtx()
  const { currentTimeRef } = usePlaybackCtx()
  const { zoomRef } = useViewCtx()

  // 素材の尺と波形を用意する（動画・音声のみ。取り込み時に呼ぶ）
  function prepareMediaMeta(path: string, kind: 'video' | 'audio' | 'image'): void {
    if (kind === 'image') return
    if (mediaMetaRef.current[path]?.wave) return // 既に解析済み
    if (metaInFlightRef.current.has(path)) return // 解析中（波形解析は全長デコードで重い）
    metaInFlightRef.current.add(path)
    // 波形は全長デコードで重い。同時に走る数を絞らないと、素材が多いほど
    // 開いた直後にアプリ全体が止まる（2000件で69秒かかっていた）。
    mediaQueue(() =>
      window.giftcut.getDuration(path).then((r) => {
        if (r?.ok && r.duration)
          setMediaMeta((prev) => ({ ...prev, [path]: { ...prev[path], dur: r.duration } }))
      })
    )
    mediaQueue(() =>
      window.giftcut
      .generateWaveform(path)
      .then((r) => {
        if (r?.ok && r.min && r.max)
          setMediaMeta((prev) => ({
            ...prev,
            [path]: {
              ...prev[path],
              wave: { min: r.min as number[], max: r.max as number[], dur: r.duration ?? 0 }
            }
          }))
      })
        .finally(() => metaInFlightRef.current.delete(path))
    )
  }

  // メディアのドラッグ開始時に尺を取得しておく（ゴーストの幅＆配置時の再利用）
  function beginMediaDrag(m: MediaItem, e: React.DragEvent): void {
    // カーソルに付く既定のドラッグ画像を透明化（位置はタイムラインのゴーストで示す）
    if (EMPTY_DRAG_IMG) e.dataTransfer.setDragImage(EMPTY_DRAG_IMG, 0, 0)
    // 許可する操作を宣言しておく。これが無いと、受け取る側で「コピー」と言っても
    // ブラウザ側が弾いて 🚫（駐禁）カーソルに戻ってしまう。
    e.dataTransfer.effectAllowed = 'copy'
    draggingMediaRef.current = m
    // 取り込み時に用意した尺があれば即使う（無ければ既定値→getDurationで後追い）
    const known = mediaMetaRef.current[m.path]?.dur
    dragSeDurRef.current = m.kind === 'image' ? 5 : known && known > 0 ? known : 2
    if (m.kind === 'audio' || m.kind === 'video') {
      void window.giftcut.getDuration(m.path).then((d) => {
        if (d?.ok && d.duration && draggingMediaRef.current?.path === m.path) {
          dragSeDurRef.current = d.duration
        }
      })
    }
  }

  // ---- 画像クリップ（V2/V3等の映像トラックに置く静止画。プレミアの画像配置に相当）----
  function placeImage(m: MediaItem, t: number, track: string): void {
    if (trackStates[track]?.locked) {
      showToast('このトラックはロックされています。')
      return
    }
    const id = imgIdCounter.current++
    setImgClips((prev) => [
      ...prev,
      { id, path: m.path, name: m.name, tStart: Math.max(0, t), duration: 5, track }
    ])
    setSelectedImgIds([id])
  }
  function deleteSelectedImg(): void {
    if (!selectedImgIds.length) return
    // ロック中トラックの画像は残す
    setImgClips((prev) =>
      prev.filter((c) => !selectedImgIds.includes(c.id) || trackStates[c.track]?.locked)
    )
    setSelectedImgIds([])
  }
  // 映像レイヤーのCSS transform（回転/反転＋ズーム）。
  // localT はクリップの先頭からの秒。動きが付いていればその瞬間のズームになる
  // （印が無ければ zoomAt は固定値をそのまま返すので、今までと同じ絵）。
  function vcXform(
    c: {
      rotate?: number
      flipH?: boolean
      flipV?: boolean
      zoom?: { scale: number; x: number; y: number }
      motion?: ClipMotion
    },
    localT = 0
  ): string | undefined {
    const parts: string[] = []
    if (c.rotate) parts.push(`rotate(${c.rotate}deg)`)
    if (c.flipH) parts.push('scaleX(-1)')
    if (c.flipV) parts.push('scaleY(-1)')
    const z = zoomAt(c.zoom, c.motion, localT)
    if (!isNeutralZoom(z))
      parts.push(
        `translate(${(z.x * 100).toFixed(3)}%, ${(z.y * 100).toFixed(3)}%) scale(${z.scale.toFixed(4)})`
      )
    return parts.length ? parts.join(' ') : undefined
  }
  // 画像のCSS transform（回転/反転＋ズーム）。動画切片と同じ合成順。
  function imgXform(c: ImgClip, localT = 0): string | undefined {
    const parts: string[] = []
    if (c.rotate) parts.push(`rotate(${c.rotate}deg)`)
    if (c.flipH) parts.push('scaleX(-1)')
    if (c.flipV) parts.push('scaleY(-1)')
    const z = zoomAt(c.zoom, c.motion, localT)
    if (!isNeutralZoom(z))
      parts.push(
        `translate(${(z.x * 100).toFixed(3)}%, ${(z.y * 100).toFixed(3)}%) scale(${z.scale.toFixed(4)})`
      )
    return parts.length ? parts.join(' ') : undefined
  }

  /**
   * ドラッグ中の「ここに置きます」の影を更新する。
   *
   * タイムラインの外へカーソルが出ても出し続ける。消してしまうと、少し外れた
   * だけで行き先が分からなくなり、置けないのか場所が悪いのか判断できない。
   * 位置はタイムラインの表示範囲へ丸めるので、外にいても一番近い場所を指す。
   */
  function updateDropGhost(
    m: MediaItem,
    clientX: number,
    clientY: number,
    insert: boolean,
    target?: EventTarget | null
  ): void {
    const inner = trackInnerRef.current
    const scroll = scrollRef.current
    if (!inner || !scroll) return
    const rect = inner.getBoundingClientRect()
    const view = scroll.getBoundingClientRect()
    const raw = Math.max(0, (clamp(clientX, view.left, view.right) - rect.left) / zoomRef.current)
    const t = snapClipStart(raw, dragSeDurRef.current)
    const yRel = clamp(clientY, view.top, view.bottom) - rect.top
    const dur = dragSeDurRef.current
    if (m.kind === 'audio') {
      setSeGhost({ t, name: m.name, dur, track: dropLaneAt(yRel, 'audio', true) ?? 'A2', path: m.path })
      setVideoGhost(null)
      setImgGhost(null)
    } else if (m.kind === 'video') {
      setVideoGhost({ t, name: m.name, dur, insert, path: m.path, track: videoDropLane({ target: target ?? null }, yRel) })
      setSeGhost(null)
      setImgGhost(null)
    } else {
      setImgGhost({ t, name: m.name, dur, track: imgLaneAt(yRel, t) })
      setSeGhost(null)
      setVideoGhost(null)
    }
  }

  /**
   * 画像を置く段。**影と実際の置き先で必ず同じ判定を通す**（別々にすると影が嘘をつく）。
   *
   * 狙った段がその時刻に埋まっていれば1段ずつ上へ避ける（判定は shared/lanes の
   * avoidBusyLane）。見るのはその段に乗り得る物すべて——テロップ・画像・重ねた映像。
   */
  function imgLaneAt(yRel: number, t: number): string {
    const picked = fallbackTrack(dropLaneAt(yRel, 'video', true) ?? 'V3', 'video')
    const order = tracks.filter((tr) => tr.kind === 'video' && tr.id !== 'V1').map((tr) => tr.id)
    const busy = [
      ...cuesRef.current.map((c) => ({
        track: cueTrack(c),
        tStart: c.start,
        duration: c.end - c.start
      })),
      ...imgClipsRef.current.map((c) => ({
        track: c.track,
        tStart: c.tStart,
        duration: c.duration
      })),
      ...vClipsRef.current.map((c) => ({
        track: c.track,
        tStart: c.tStart,
        duration: Math.max(0.05, c.srcEnd - c.srcStart)
      }))
    ]
    return avoidBusyLane(order, busy, t, picked)
  }
  /** ドラッグが終わったら影を全部消す */
  function clearDropGhosts(): void {
    setSeGhost(null)
    setVideoGhost(null)
    setImgGhost(null)
    setSnapLineX(null)
  }

  /**
   * タイムラインの外（トラックヘッダー列・パネルの上など）で離された素材を、
   * 一番近い位置に置く。どこも受け取らずに掴んだものが消えるのを防ぐための最終受け皿。
   */
  function dropMediaNearest(m: MediaItem, clientX: number, clientY: number): void {
    const inner = trackInnerRef.current
    const scroll = scrollRef.current
    if (!inner || !scroll) return
    const rect = inner.getBoundingClientRect()
    const view = scroll.getBoundingClientRect()
    // タイムラインの表示範囲へ丸めてから秒とレーンに直す（外に出ていても端に寄る）
    const raw = Math.max(0, (clamp(clientX, view.left, view.right) - rect.left) / zoomRef.current)
    const t = snapClipStart(raw, dragSeDurRef.current)
    const yRel = clamp(clientY, view.top, view.bottom) - rect.top
    if (m.kind === 'video') {
      const vt = dropLaneAt(yRel, 'video') ?? 'V1'
      if (vt !== 'V1') void placeVClip(m, t, vt)
      else void placeVideoAtDrop(m.path, t, false)
    } else if (m.kind === 'audio') {
      void placeSE(m, t, dropLaneAt(yRel, 'audio', true) ?? 'A2')
    } else {
      placeImage(m, t, imgLaneAt(yRel, t))
    }
  }
  /**
   * 動画のドロップ先レーンを決める。
   *
   * トラックの行の外（下の余白、音声トラックの上など）に落ちたとき、以前は V1 ＝
   * 本編の上書きに倒れていた。置いたつもりが本編を壊す。行の外でも駐禁を出さずに
   * 置けるようにしたいので、**縦位置が一番近い映像トラック**に寄せる。
   * どうしても決まらないときだけ1つ上の新しいレーンを作る
   * （V{n}/A{n} は reserveTrackPairForVideo が作る）。
   */
  function videoDropLane(e: { target: EventTarget | null }, yRel?: number): string {
    const tid = trackFromEvent(e, 'video')
    if (tid) return tid
    if (yRel !== undefined) {
      const near = dropLaneAt(yRel, 'video')
      if (near) return near
    }
    const vMax = Math.max(1, ...tracks.filter((t) => t.kind === 'video').map((t) => trackNum(t.id)))
    return 'V' + (vMax + 1)
  }
  // 映像レイヤーに動画クリップを置く
  async function placeVClip(m: MediaItem, t: number, track: string): Promise<void> {
    if (trackStates[track]?.locked) {
      showToast('このトラックはロックされています。')
      return
    }
    const known = mediaMetaRef.current[m.path]?.dur
    let dur = known && known > 0 ? known : 0
    if (!dur) {
      const d = await window.giftcut.getDuration(m.path)
      dur = d?.ok && d.duration ? d.duration : 0
    }
    if (dur <= 0) {
      showToast('動画の長さを取得できませんでした。', 'error')
      return
    }
    const vTrack = reserveTrackPairForVideo(track)
    const id = vClipIdCounter.current++
    setVClips((prev) => [
      ...prev,
      {
        id,
        path: m.path,
        name: m.name,
        track: vTrack,
        tStart: Math.max(0, t),
        srcStart: 0,
        srcEnd: dur,
        srcDur: dur
      }
    ])
    setSelectedVClipIds([id])
    prepareMediaMeta(m.path, 'video')
    showToast(vTrack + ' に配置しました（音声は ' + pairedAudioOf(vTrack) + ' に連動）。', 'success')
  }
  function deleteSelectedVClip(): void {
    if (!selectedVClipIds.length) return
    setVClips((prev) =>
      prev.filter((c) => !selectedVClipIds.includes(c.id) || trackStates[c.track]?.locked)
    )
    setSelectedVClipIds([])
  }
  // クリップ内ローカル秒 t における音声フェード係数
  // フェード計算は shared/timeline の fadeGain に集約（音声フェードの実装を1つに保つ）
  function vcFadeGain(c: VClip, t: number): number {
    return fadeGain(t, vcLen(c), c.afadeIn, c.afadeOut)
  }

  async function placeSE(m: MediaItem, t: number, track = 'A2'): Promise<void> {
    if (trackStates[track]?.locked) {
      showToast('このトラックはロックされています。')
      return
    }
    const d = await window.giftcut.getDuration(m.path)
    const dur = d?.ok && d.duration ? d.duration : 3
    const id = seIdCounter.current++
    setSeClips((prev) => [
      ...prev,
      {
        id,
        path: m.path,
        name: m.name,
        tStart: Math.max(0, t),
        duration: dur,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        track,
        srcOffset: 0,
        srcDur: dur
      }
    ])
    setSelectedSeIds([id])
  }
  // 音声ファイルを追加：ファイル選択→A3トラックの再生ヘッド位置に配置（BGM等）。
  // BGM を置く音声トラックを決める。テロップと同じ考え方で、再生ヘッド位置が
  // 空いている一番上（A2 に近い側）から順に探し、無ければ1段下に作る。
  // 以前は A3 決め打ちだったため、V3 に映像レイヤーを置いて A3 がその音声で
  // 埋まっていても、♪＋ ボタンが A3 に BGM を重ねていた。
  function trackForNewBgm(t: number): string {
    // 映像レイヤーの音声で予約済みのトラックは避ける（V{n} と対になっている）
    const reservedByVideo = new Set(vClips.map((c) => 'A' + trackNum(c.track)))
    const cands = tracks
      .filter(
        (tr) =>
          tr.kind === 'audio' &&
          tr.id !== 'A1' &&
          !trackStates[tr.id]?.locked &&
          !reservedByVideo.has(tr.id)
      )
      .sort((a, b) => trackNum(a.id) - trackNum(b.id))
    const busy = (id: string): boolean =>
      seClips.some((c) => c.track === id && c.tStart < t + 1 && c.tStart + c.duration > t)
    const free = cands.find((tr) => !busy(tr.id))
    if (free) return free.id
    const maxNum = Math.max(
      1,
      ...tracks.filter((x) => x.kind === 'audio').map((x) => trackNum(x.id))
    )
    const id = 'A' + (maxNum + 1)
    setTracks((prev) =>
      prev.some((x) => x.id === id)
        ? prev
        : insertTrackOrdered(prev, { id, name: id, kind: 'audio' })
    )
    setTrackStates((prev) => (prev[id] ? prev : { ...prev, [id]: newTrackState(id) }))
    return id
  }
  async function addBgm(): Promise<void> {
    const res = await window.giftcut.addMedia()
    if (!res?.paths?.length) return
    const track = trackForNewBgm(currentTimeRef.current)
    for (const p of res.paths) {
      const name = p.split(/[\\/]/).pop() ?? '音声'
      await placeSE({ id: -1, path: p, name, kind: 'audio' }, currentTimeRef.current, track)
    }
    if (track !== EXTRA_AUDIO_TRACK) showToast(track + ' に追加しました。')
  }
  // SEクリップ内ローカル秒 t におけるフェード係数(0-1)。頭 fadeIn / 尻 fadeOut を線形。
  function seFadeGain(clip: SEClip, t: number): number {
    let g = 1
    if (clip.fadeIn > 0 && t < clip.fadeIn) g = Math.min(g, t / clip.fadeIn)
    const outStart = clip.duration - clip.fadeOut
    if (clip.fadeOut > 0 && t > outStart) g = Math.min(g, (clip.duration - t) / clip.fadeOut)
    return clamp(g, 0, 1)
  }
  function removeMedia(id: number): void {
    const m = mediaItems.find((x) => x.id === id)
    // タイムラインで使っている素材は消せない（消すとビンから見えないのに再生され続けて混乱する）。
    // 「使用中」の基準はクリップが残っているかどうか。元動画としての登録は、切片を
    // 全部消したあとも主ソースとして残るので、それを見ていると
    // 「タイムラインは空なのにビンから消せない」という手詰まりになる。
    if (m) {
      const refs = {
        sources: sourcesRef.current,
        segments: segsRef.current,
        seClips: seClipsRef.current,
        imgClips: imgClipsRef.current,
        vClips: vClipsRef.current
      }
      if (mediaInUse(m.path, refs)) {
        showToast('この素材はタイムラインで使用中です。先にクリップを削除してください。')
        return
      }
      // 誰も使っていない元動画の登録も一緒に片付ける。残すと、見えない <video> が
      // プロキシを読み続け、書き出しの入力にも無駄に載る。
      const stale = staleSourceIds(m.path, refs)
      if (stale.length) setSources((prev) => prev.filter((s) => !stale.includes(s.id)))
      // 消した素材をプレビューが映したままにしない（ビンに無い動画が出続ける）
      if (videoPath === m.path) {
        setVideoPath(null)
        setVideoSrc(null)
        setVideoName(null)
        setVideoDuration(0)
        setThumbnailSrc(null)
      }
    }
    setMediaItems((prev) => prev.filter((x) => x.id !== id))
    // まとめて選んでいることがあるので、消した物だけを選択から外す
    setSelectedMediaIds((prev) => prev.filter((x) => x !== id))
  }

  return {
    prepareMediaMeta, beginMediaDrag, placeImage, deleteSelectedImg, vcXform, imgXform,
    updateDropGhost, clearDropGhosts, dropMediaNearest, videoDropLane, placeVClip,
    deleteSelectedVClip, vcFadeGain, placeSE, trackForNewBgm, addBgm, seFadeGain, removeMedia,
    imgLaneAt
  }
}
