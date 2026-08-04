// 素材を**どの段の、どこへ置くか**を決めて、実際に置く。
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
// ## 段の判定は shared/lanes
//
// どの段に置けるか（`audioLaneFor`）・埋まっていたら避ける（`avoidBusyLane`）は
// 画面を起動せずに確かめられるように分けてある。**ここで書き起こさない。**
//
// ## なぜ ./useMediaDrop から出したか（2026-08-04）
//
// あちらは533行で、記号解決で測ったらこの群は **受け取る5・返す1**。
// 受け取る5つは全部 import で、返す1つ（`prepareMediaMeta`）は
// 「素材の尺と波形を用意する」＝取り込み側の仕事なので、あちらに残して**借りた**
//（`引き継ぎ-心臓の分け直し.md`）。
//
// ## 中身
//
// - `useMediaPlace` … 下をまとめて返す唯一の入口
// - `placeImage` … 画像クリップを映像の段へ置く
// - `updateDropGhost` … 離す前に「ここに、この長さで入る」を見せる
// - `imgLaneAt` … 縦位置から、画像を置く段を決める
// - `dragList` … まとめて掴んだときに、実際に運ぶ一覧
// - `durOf` … その素材の尺（分からなければ既定値）
// - `placeDropped` … 落ちた物を種類ごとに振り分けて置く
// - `clearDropGhosts` … 見せていた予告を消す
// - `dropMediaNearest` … 画面のどこで離しても、一番近い置ける所へ置く
// - `videoDropLane` … 動画を落とす段を決める
// - `placeVClip` … 映像レイヤー（V2以降の動画）を置く。音声も対の段へ
// - `placeSE` … 効果音・BGM を置く
// - `trackForNewBgm` … BGM を足す段を選ぶ（埋まっていたら1段作る）
// - `addBgm` … ♪＋ から BGM を足す
import { clamp } from '../../../shared/timeline'
import { newTrackState } from '../lib/trackState'
import type { MediaItem } from '../components/panels/ProjectBinTab'
// どの段に置けるか・埋まっていたら避ける。**画面を起動せずに確かめられる側**
import { audioLaneFor, avoidBusyLane } from '../../../shared/lanes'
import type { UseMediaDropDeps } from './useMediaDrop'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useTracksCtx } from './tracksContext'
import { useToastCtx } from './toastContext'
import { useMediaCtx } from './mediaContext'
import { usePlaybackCtx } from './playbackContext'
import { useViewCtx } from './viewContext'

// **deps の型は手で書かない。** 呼ぶ側（./useMediaDrop）の定義から引く——
// あちらが形を変えたら、ここは黙って追従するか、合わなければ落ちる。
// 手で書くと「引数の数を間違えても通る」が起きる（実際に3か所ズレた）。
export type UseMediaPlaceDeps = Pick<
  UseMediaDropDeps,
  | 'EXTRA_AUDIO_TRACK' | 'dragSeDurRef' | 'dropLaneAt' | 'fallbackTrack' | 'cueTrack'
  | 'insertTrackOrdered' | 'mediaMetaRef' | 'pairedAudioOf' | 'placeVideoAtDrop'
  | 'reserveTrackPairForVideo' | 'scrollRef' | 'trackInnerRef' | 'snapClipStart'
  | 'trackFromEvent' | 'trackNum' | 'vcLen'
  | 'setImgGhost' | 'setSeGhost' | 'setVideoGhost' | 'setSnapLineX'
> & {
  /**
   * 素材の尺と波形を用意する。**取り込む側（./useMediaDrop）の物を借りる**
   *（置くのと取り込むのは別の仕事なので、持ち出さない）
   */
  prepareMediaMeta: (path: string, kind: 'video' | 'audio' | 'image') => void
}

export function useMediaPlace(deps: UseMediaPlaceDeps) {
  const {
    EXTRA_AUDIO_TRACK, dragSeDurRef, dropLaneAt,
    fallbackTrack, cueTrack, insertTrackOrdered, mediaMetaRef, pairedAudioOf,
    placeVideoAtDrop, reserveTrackPairForVideo, scrollRef, trackInnerRef, snapClipStart,
    trackFromEvent, trackNum, vcLen, setImgGhost, setSeGhost, setVideoGhost, setSnapLineX,
    prepareMediaMeta
  } = deps
  const {
    cuesRef, seClips, setSeClips, seClipsRef, seIdCounter, imgClipsRef, imgIdCounter,
    setImgClips, vClips, setVClips, vClipsRef, vClipIdCounter
  } = useDoc()
  const {
    setSelectedImgIds, setSelectedSeIds, setSelectedVClipIds, selectedMediaIds
  } = useSel()
  const { tracks, setTracks, trackStates, setTrackStates } = useTracksCtx()
  const { showToast } = useToastCtx()
  const { mediaItems } = useMediaCtx()
  const { currentTimeRef } = usePlaybackCtx()
  const { zoomRef } = useViewCtx()

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
  return {
    placeImage, updateDropGhost, imgLaneAt, dragList, durOf, placeDropped,
    clearDropGhosts, dropMediaNearest, videoDropLane, placeVClip, placeSE,
    trackForNewBgm, addBgm
  }
}
