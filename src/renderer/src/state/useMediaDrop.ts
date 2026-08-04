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
import { fadeGain } from '../../../shared/timeline'
import type { SEClip, Track, VClip } from '../lib/projectTypes'
import type { MediaItem } from '../components/panels/ProjectBinTab'
import type { Cue } from '../lib/srt'
import type { BinRefs } from '../../../shared/mediaBin'
import type { MediaMeta } from './useMediaMeta'
import type { ImgGhost, SeGhost, VideoGhost } from './useDragPreview'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'
import { useMediaCtx } from './mediaContext'
// 落とし先を決めて、置く側（13個）。**このファイルは取り込みと消す方を持つ**
import { useMediaPlace } from './useMediaPlace'
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
    dragSeDurRef, draggingMediaRef, mediaInUse, mediaMetaRef, mediaQueue, metaInFlightRef,
    staleSourceIds, vcLen, setMediaMeta
  } = deps
  const { seClipsRef, imgClipsRef, setImgClips, segsRef, setVClips, vClipsRef } = useDoc()
  const {
    selectedImgIds, setSelectedImgIds, selectedVClipIds, setSelectedVClipIds,
    setSelectedMediaIds
  } = useSel()
  const { trackStates } = useTracksCtx()
  const { showToast } = useToastCtx()
  const {
    mediaItems, setMediaItems, sourcesRef, setSources, videoPath, setVideoPath,
    setVideoSrc, setVideoName, setVideoDuration, setThumbnailSrc
  } = useMediaCtx()

  // 落とし先を決めて、置く所（state/useMediaPlace）。**自分で心臓を見に行く**ので、
  // ここから渡すのは deps と、取り込み側にしか無い prepareMediaMeta だけ
  const place = useMediaPlace({ ...deps, prepareMediaMeta })


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
  // 落とし先を決めて置く所（13個）は state/useMediaPlace。**同じ名前で返す**ので、
  // 受け取る側（useAppWiring・素材ビン・タイムライン）は1行も書き換えなくてよい
  return {
    prepareMediaMeta, beginMediaDrag, deleteSelectedImg,
    deleteSelectedVClip, vcFadeGain, seFadeGain, removeMedia,
    ...place
  }
}