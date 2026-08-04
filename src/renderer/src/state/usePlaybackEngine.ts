// 再生の心臓。流す・止める・飛ぶ・コマ送り・早送り。
//
// ## 切片をまたぐときが一番むずかしい
//
// タイムラインは切片（カット）の列で、切片ごとに元動画の別の場所を指す。
// 素直に1本の <video> で追うと、切片の境目で毎回シークが入り、
// **そこで数百ms 止まる**。見ている側には「カットのたびにつっかえる」に見える。
//
// そこで **A面/B面の2本**を使う。いま流している裏で、次の切片の頭へ
// もう1本を先に合わせておき、境目では表示を入れ替えるだけにする。
//
// ## 「合わせておく」のは温めた面
//
// 先に合わせた面（preparedRef）は、位置が飛んだ時点で当てにならなくなる。
// 飛んだら必ず捨てること。捨て忘れると、**関係ない所の絵が一瞬出る**。
//
// ## 描き直しは頭打ちにする
//
// 再生位置を state に入れると App 全体が作り直される。240Hz のモニタでは
// 毎秒240回になり、細かい仕事で主スレッドが埋まって音がぶちぶち切れる。
// 再生ヘッドは秒60回動けば人の目には連続に見えるので、そこで止める。

import { clamp, qFrame, tToSource } from '../../../shared/timeline'
import type { SegLayout, Source, VSeg } from '../lib/projectTypes'
import { usePlaybackCtx } from './playbackContext'
// 切片をまたぐ時計（A面/B面）。**一番むずかしい所をここだけに閉じてある**
import { useSegClock } from './useSegClock'

// **`any` で受けない。** ここは呼ぶ側（`useAppWiring`）が実物を渡す入口なので、
// 型がズレた瞬間に呼び出し側で落ちる＝手で書いても腐らない。
// 型は推測せず、呼び出し側が実際に渡している物をそのまま写した。
export interface UsePlaybackEngineDeps {
  /** 本編の <video>。A面/B面の2本と、その一覧 */
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
  videoBRef: React.RefObject<HTMLVideoElement>
  videoElsRef: React.MutableRefObject<Map<string, HTMLVideoElement>>
  /** いま表に出している面（A か B）。境目で入れ替える */
  setActiveHalf: React.Dispatch<React.SetStateAction<Record<number, 0 | 1>>>
  halfOf: (srcId: number) => 0 | 1
  elKey: (srcId: number, half: 0 | 1) => string
  segLayoutRef: React.MutableRefObject<SegLayout[]>
  srcOfSeg: (seg: VSeg | undefined) => Source | undefined
  videoTLenRef: React.MutableRefObject<number>
  videoDurationRef: React.MutableRefObject<number>
  contentEndRef: React.MutableRefObject<number>
  /** 効果音の <audio> */
  seAudioRefs: React.MutableRefObject<Map<number, HTMLAudioElement>>
  sePreviewRef: React.MutableRefObject<HTMLAudioElement | null>
  /** 再生位置を進める（描き直しは頭打ち） */
  paintTime: (t: number, force?: boolean) => void
  setTime: (t: number) => void
  /**
   * 再生ヘッドを横に見えている所へ連れてくる。state/useTimelineBox の物。
   *
   * **見せ方（state/useViewNav）ごと受け取らないこと。** あちらは飛ばす側＝
   * ここの seekTo を要るので、輪になる。連れてくるだけの物は飛ばす側を要らない。
   */
  revealPlayhead: () => void
}

export function usePlaybackEngine(deps: UsePlaybackEngineDeps) {
  const {
    videoRef, videoBRef, videoElsRef, segLayoutRef,
    videoTLenRef, videoDurationRef, contentEndRef,
    seAudioRefs, sePreviewRef, paintTime, setTime, revealPlayhead
  } = deps
  const {
    currentTimeRef, durationRef, fpsRef, playRateRef, rafRef,
    setCurrentTime, setPlayRateUI, setPlaying,
    // 追いかけの時計まわりは心臓（usePlayback）が持っている
    clockStartWallRef, clockStartPosRef, lastTsRef, preparedRef, currentSegRef
  } = usePlaybackCtx()


  // 切片をまたぐ時計（A面/B面の入れ替え）は state/useSegClock。
  // **自分で心臓を見に行く**ので、ここから渡すのは deps と、
  // 一元管理している2つ（getPlayEnd / stopPlayback）だけ
  const { startVideoSegClock, xfBStyle } = useSegClock({ ...deps, getPlayEnd, stopPlayback })

  function getPlayEnd(): number {
    return contentEndRef.current > 0
      ? Math.min(contentEndRef.current, durationRef.current)
      : durationRef.current
  }

  // ================= 再生エンジン =================
  // すべての再生は startPlayback / stopPlayback を通す（状態の一元管理）
  function stopPlayback(): void {
    // SEライブラリの試聴音も止める（DOM外のAudioなので放置すると鳴り続ける）
    try {
      sePreviewRef.current?.pause()
    } catch {
      /* noop */
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    // **2枚組なので、映していない面も必ず止める。**
    // 片方だけ止めると、裏の面が鳴り続けたり勝手に進んだりする
    videoElsRef.current.forEach((el: HTMLVideoElement) => {
      if (!el.paused) el.pause()
    })
    // 温めてあった面は、止めた時点で当てにできない（位置が変わるため）
    preparedRef.current = null
    const v = videoRef.current
    if (v && !v.paused) v.pause()
    const vb = videoBRef.current
    if (vb && !vb.paused) vb.pause()
    seAudioRefs.current.forEach((a: HTMLAudioElement) => {
      if (!a.paused) a.pause()
    })
    playRateRef.current = 0
    setPlaying(false)
    setPlayRateUI(0)
    // 画質スロットルで最終フレームを間引いた場合に備え、停止時は正確な位置へ確実に反映
    setCurrentTime(currentTimeRef.current)
  }

  function startRafClock(rate: number): void {
    lastTsRef.current = performance.now()
    const tick = (ts: number): void => {
      const dt = (ts - lastTsRef.current) / 1000
      lastTsRef.current = ts
      const nt = currentTimeRef.current + rate * dt
      if (rate > 0 && nt >= getPlayEnd()) {
        setTime(getPlayEnd())
        stopPlayback()
        return
      }
      if (rate < 0 && nt <= 0) {
        setTime(0)
        stopPlayback()
        return
      }
      paintTime(nt)
      const v = videoRef.current
      if (v && rate < 0) {
        // 逆再生は paused の動画をセグメント対応でフレームシーク
        const src = tToSource(segLayoutRef.current, nt)
        if (src) v.currentTime = src.srcTime
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }


  // 順再生（動画駆動）中も rAF で毎フレーム再生ヘッドを同期する
  // （video の timeupdate は約4Hzしか発火せず、テロップの出入りが最大250msズレるため）
  function startVideoClock(): void {
    let started = false // play() は非同期なので、実際に再生が始まるまでは paused を停止扱いしない
    const tick = (): void => {
      const v = videoRef.current
      if (!v) {
        stopPlayback()
        return
      }
      if (!v.paused) started = true
      else if (started && !v.ended) {
        // 再生開始後に予期せず止まった（デコードエラー等）→ 状態を破綻させない
        stopPlayback()
        return
      }
      setTime(v.currentTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function startPlayback(rate: number): void {
    preparedRef.current = null // 前の再生で温めた面は、位置が変わっているので捨てる
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    const v = videoRef.current
    if (v && !v.paused) v.pause()
    let t = currentTimeRef.current
    if (rate > 0 && t >= getPlayEnd() - 0.01) {
      t = 0
      setTime(0)
    }
    // 壁時計の基準をセット（この時刻・位置から一定速度で再生ヘッドを進める）
    clockStartPosRef.current = t
    clockStartWallRef.current = performance.now() / 1000
    playRateRef.current = rate
    setPlaying(true)
    setPlayRateUI(rate)
    if (v && rate > 0) {
      const src = tToSource(segLayoutRef.current, t)
      if (src && videoDurationRef.current > 0 && t < videoTLenRef.current - 1e-3) {
        currentSegRef.current = src.index
        // すでにヘッド位置にいれば再シークしない（毎回の再生開始で一拍待たされるのを防ぐ）
        if (Math.abs(v.currentTime - src.srcTime) > 0.05) v.currentTime = src.srcTime
        v.playbackRate = Math.min(rate * src.speed, 16)
        v.play().catch(() => stopPlayback())
        startVideoSegClock() // 壁時計マスターで再生ヘッドを流す（動画は追従）
        return
      }
      if (segLayoutRef.current.length === 0 && videoDurationRef.current === 0) {
        // metadata 未取得 → 素直にネイティブ再生
        v.currentTime = t
        v.playbackRate = Math.min(rate, 8)
        v.play().catch(() => stopPlayback())
        startVideoClock()
        return
      }
    }
    // 逆再生 / 動画の先（テロップのみ区間）/ 動画なし → rAF クロック
    startRafClock(rate)
  }

  function togglePlay(): void {
    if (playRateRef.current !== 0) stopPlayback()
    else startPlayback(1)
  }

  // JKL シャトル（プレミア準拠: L 順方向を押すたび倍速、J 逆方向、K 停止）
  function shuttleForward(): void {
    startPlayback(playRateRef.current > 0 ? Math.min(playRateRef.current * 2, 8) : 1)
  }
  function shuttleReverse(): void {
    startPlayback(playRateRef.current < 0 ? Math.max(playRateRef.current * 2, -8) : -1)
  }

  // 動画のソース終端に達した場合の保険。
  // 壁時計マスター（切片あり）では tick が終端を管理するので何もしない
  // （ここでヘッドを動かすと再生ヘッドが末尾へテレポートするバグになる）。
  function handleVideoEnded(): void {
    if (segLayoutRef.current.length === 0) stopPlayback() // metadata未取得のネイティブ再生のみ
  }

  function seekTo(t: number): void {
    const nt = clamp(t, 0, durationRef.current)
    setTime(nt)
    const v = videoRef.current
    if (v && playRateRef.current <= 0) {
      const src = tToSource(segLayoutRef.current, nt)
      if (src) {
        v.currentTime = src.srcTime
        currentSegRef.current = src.index
      } else {
        currentSegRef.current = Math.max(0, segLayoutRef.current.length - 1)
      }
    }
  }
  // 再生ヘッド位置の切片IDを取得（リフレーム/ズームの編集対象）
  function curSegId(): number | null {
    const src = tToSource(segLayoutRef.current, currentTimeRef.current)
    return src ? (segLayoutRef.current[src.index]?.seg.id ?? null) : null
  }

  /**
   * 飛ばして、そこを見せる。**プレビュー側の操作はすべてこれを通す。**
   *
   * 飛ばす操作は**すべてタイムライン側も追従させる**。バーだけ連動して、
   * ボタンだと付いてこない、という食い違いが一番読みにくい。
   *
   * 幅と位置は飛んだ後でなければ決まらないので、連れてくるのは1コマ待つ。
   */
  function seekAndReveal(t: number): void {
    seekTo(t)
    requestAnimationFrame(revealPlayhead)
  }
  // 再生ヘッドを指定秒だけ移動（±5/±10 秒送り戻し）。再生中は止めてから。
  function skipSec(sec: number): void {
    stopPlayback()
    seekAndReveal(currentTimeRef.current + sec)
  }
  // 1フレーム単位で移動（フレームグリッドに量子化）。
  function stepFrame(frames: number): void {
    stopPlayback()
    seekAndReveal(qFrame(currentTimeRef.current, fpsRef.current) + frames / fpsRef.current)
  }

  return {
    getPlayEnd, stopPlayback, startRafClock, startVideoSegClock, startVideoClock,
    startPlayback, togglePlay, shuttleForward, shuttleReverse, handleVideoEnded,
    seekTo, seekAndReveal, xfBStyle, curSegId, skipSec, stepFrame
  }
}
