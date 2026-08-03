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
import { newTrackState } from '../lib/trackState'
import type { SEClip, Track, VClip } from '../lib/projectTypes'
import type { MediaItem } from '../components/panels/ProjectBinTab'
import type { Cue } from '../lib/srt'
import type { BinRefs } from '../../../shared/mediaBin'
import type { MediaMeta } from './useMediaMeta'
import type { ImgGhost, SeGhost, VideoGhost } from './useDragPreview'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { audioLaneFor, avoidBusyLane } from '../../../shared/lanes'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'
import { useMediaCtx } from './mediaContext'
import { usePlaybackCtx } from './playbackContext'
import { useViewCtx } from './viewContext'
// **useHistory の Snap と名前がぶつかる**ので別名で受ける
import type { Snap as SnapApi } from './useSnap'

// **`any` で受けない。** ここは呼ぶ側（`useAppWiring`）が実物を渡す入口なので、
// 型がズレた瞬間に呼び出し側で落ちる＝手で書いても腐らない。
// 型は推測せず、呼び出し側が実際に渡している物をそのまま写した。
export interface UseMediaDropDeps {
  /** 効果音を置くとき、足りなければ増やす音声段の名前 */
  EXTRA_AUDIO_TRACK: string
  dragSeDurRef: React.MutableRefObject<number>
  /** いま掴んでいる素材 */
  draggingMediaRef: React.MutableRefObject<MediaItem | null>
  /** 縦位置から段を割り出す */
  dropLaneAt: (
    yRel: number,
    kind: 'video' | 'audio',
    forVideoLayer?: boolean
  ) => string | null
  fallbackTrack: (id: string, kind: 'video' | 'audio') => string
  /** テロップが載っている段（既定の扱いを1か所にするため受け取る） */
  cueTrack: (c: Cue) => string
  /** 段を正しい並びで足す */
  insertTrackOrdered: (list: Track[], tr: Track) => Track[]
  /** その素材が、いまタイムラインで使われているか */
  mediaInUse: (path: string, refs: BinRefs) => boolean
  /** 調べ終わった素材の中身（尺・波形）。掴んでいる最中に読むので ref */
  mediaMetaRef: React.MutableRefObject<Record<string, MediaMeta>>
  /** これから調べる素材の待ち行列 */
  mediaQueue: (job: () => Promise<unknown>) => void
  metaInFlightRef: React.MutableRefObject<Set<string>>
  /** 映像段と対になる音声段の名前（V2 → A2） */
  pairedAudioOf: (vTrack: string) => string
  placeVideoAtDrop: (path: string, t: number, insert: boolean) => Promise<void>
  /** 映像と音の段を対で確保する */
  reserveTrackPairForVideo: (vTrack: string) => string
  scrollRef: React.RefObject<HTMLDivElement>
  trackInnerRef: React.RefObject<HTMLDivElement>
  /** 吸着（クリップの左右どちらの端でも寄せる）。**形は作っている側（state/useSnap）から引く** */
  snapClipStart: SnapApi['snapClipStart']
  /** どこからも使われなくなった元動画 */
  staleSourceIds: (path: string, refs: BinRefs) => number[]
  trackFromEvent: (e: { target: EventTarget | null }, kind?: 'video' | 'audio') => string | null
  trackNum: (id: string) => number
  vcLen: (c: VClip) => number
  /**
   * 調べ終わった素材の中身の置き場。
   * **中身の形は `MediaMeta` を指す**——前はここに `{ dur?; wave? }` と
   * 書き写してあり、あちらを直してもここは古いままになる形だった
   */
  setMediaMeta: React.Dispatch<React.SetStateAction<Record<string, MediaMeta>>>
  setImgGhost: React.Dispatch<React.SetStateAction<ImgGhost | null>>
  setSeGhost: React.Dispatch<React.SetStateAction<SeGhost | null>>
  setVideoGhost: React.Dispatch<React.SetStateAction<VideoGhost | null>>
  setSnapLineX: React.Dispatch<React.SetStateAction<number | null>>
}

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
    setSelectedVClipIds, selectedMediaIds, setSelectedMediaIds
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
  // ※ CSS transform の組み立ては lib/clipXform へ出した。
  //    このファイルの頭のコメントは「落とす」話だけで、描画の話が無かった。
  //    映像レイヤー用と画像用が**本体1文字違わずに2つ**あったので、1本にまとめてある

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
        duration: vcLen(c)
      }))
    ]
    return avoidBusyLane(order, busy, t, picked)
  }

  /**
   * 掴んだ物といっしょに運ぶ一覧。**まとめて選んでいれば、その順のまま。**
   *
   * 掴んだ物が選択の中に居るときだけ束で運ぶ。選択と関係ない物を掴んだら
   * それ1つ——選んであることを忘れて別の物を掴んだときに、
   * 覚えのない素材まで置かれるのが一番困る。
   */
  function dragList(grabbed: MediaItem): MediaItem[] {
    if (selectedMediaIds.length < 2 || !selectedMediaIds.includes(grabbed.id)) return [grabbed]
    return selectedMediaIds
      .map((id) => mediaItems.find((m) => m.id === id))
      .filter((m): m is MediaItem => !!m)
  }

  /**
   * その素材の長さ（秒）。**続けて並べるには、次の置き場所を知る必要がある。**
   *
   * 画像は決め打ち（置いたときの長さと同じ 5秒）。音と映像は測る。
   * 測れなければ 2秒——**止まるより、短くても置いて手で直せる方がよい**。
   */
  async function durOf(m: MediaItem): Promise<number> {
    if (m.kind === 'image') return 5
    const known = mediaMetaRef.current[m.path]?.dur
    if (known && known > 0) return known
    const d = await window.giftcut.getDuration(m.path)
    return d?.ok && d.duration ? d.duration : 2
  }

  /**
   * 落とした物を置く。**まとめて選んでいれば、その順に続けて並べる。**
   *
   * 1つだけのときは今までと同じ道を通る（測り直しもしない）。
   * 束のときだけ、1つ置くごとに次の置き場所を「置いた物の終わり」へ進める。
   */
  async function placeDropped(
    grabbed: MediaItem,
    t0: number,
    yRel: number,
    ev: { target: EventTarget | null; ctrlKey: boolean }
  ): Promise<void> {
    const list = dragList(grabbed)
    let t = t0
    for (const m of list) {
      if (m.kind === 'video') {
        const vt = videoDropLane(ev, yRel)
        if (vt !== 'V1') await placeVClip(m, t, vt)
        else await placeVideoAtDrop(m.path, t, ev.ctrlKey)
      } else if (m.kind === 'audio') {
        await placeSE(m, t, audioLaneFor(tracks, seClipsRef.current, t, null))
      } else {
        placeImage(m, t, imgLaneAt(yRel, t))
      }
      if (list.length > 1) t += await durOf(m)
    }
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
    // 端で受けた分も同じ道を通す（まとめて選んでいればまとめて置く）
    void placeDropped(m, t, yRel, { target: null, ctrlKey: false })
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
  // SEクリップ内ローカル秒 t におけるフェード係数(0-1)。
  // **すぐ上の vcFadeGain と同じ計算を、ここだけ手で書き直してあった**
  // （「フェード計算は shared/timeline の fadeGain に集約」と宣言したそばで割れていた）。
  // 中身は1行ずつ突き合わせて完全一致だったので、同じ1本に寄せた
  function seFadeGain(clip: SEClip, t: number): number {
    return fadeGain(t, clip.duration, clip.fadeIn, clip.fadeOut)
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

  // `trackForNewBgm` は返さない。受け取る所が無かった（addBgm の中でだけ使う）
  return {
    prepareMediaMeta, beginMediaDrag, placeImage, deleteSelectedImg,
    updateDropGhost, clearDropGhosts, dropMediaNearest, videoDropLane, placeVClip,
    deleteSelectedVClip, vcFadeGain, placeSE, addBgm, seFadeGain, removeMedia,
    imgLaneAt, placeDropped
  }
}
