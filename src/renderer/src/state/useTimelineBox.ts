// タイムラインの「箱」への参照と、縦に送ったときの追従。
//
// ## ついていく側が3つある
//
//   scroll     … 実際に送られる箱
//   inner      … 段の中身。送った量だけ上へずらす
//   thBody     … 左の段見出しの並び。**箱の外にいる**ので、自分でずらす
//
// 見出しだけ置いていかれると、段の名前と中身が縦にずれて「どの段の帯か」が
// 読めなくなる。3つはセットで動かす。
//
// ### この決まりは一度壊して覚えた（消さないこと）
//
// 「V と A の境目を真ん中に残す」ために scrollTop を動かす処理を入れたことがある。
// **当時このアプリは見出しを追従させる仕組みを持っていなかった**ので、
// 行だけがずれて見出しは動かず、V1 の行に音の波形が出た。
// さらに当たり判定は本当の行位置で計算されるので、
// **見えている段と掴める段が食い違って移動できない**という形で表に出た。
//
// 縦スクロールを前提にしていない所へ、スクロールだけ足してはいけない。
// いま追従できるのは、上の3つを揃えたから。
//
// ## React の状態にしない
//
// スクロールは毎秒何十回も飛んでくる。状態にすると毎回描き直しになり、
// せっかく 250回/秒 → 60回/秒 に減らした所へ逆戻りする。
import { useCallback, useRef } from 'react'
import { applyTimelineVScroll, centeredScrollTop } from '../lib/timelineVScroll'
import { useVisibleRange } from './useVisibleRange'
import { usePlaybackCtx } from './playbackContext'
import { useViewCtx } from './viewContext'

export function useTimelineBox() {
  const { currentTimeRef } = usePlaybackCtx()
  const { zoomRef } = useViewCtx()
  /** プレビューの映像の箱（テロップをその場で書き換えるときの基準） */
  const screenRef = useRef<HTMLDivElement>(null)

  const trackInnerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const thBodyRef = useRef<HTMLDivElement>(null)

  /** 縦に送ったときの追従。中身は lib/timelineVScroll */
  const syncTimelineVScroll = useCallback((): void => {
    applyTimelineVScroll(scrollRef.current?.scrollTop ?? 0, {
      headers: thBodyRef.current,
      inner: trackInnerRef.current
    })
  }, [])

  /**
   * プレビューとの境目を動かして高さが変わったときの、伸び縮み。
   *
   * **上と下が一緒に小さくなる**（プレミアと同じ感じ）ようにする。
   * 素のままだと箱は下端だけが動くので、縮めると音声側から順に消えていき、
   * 映像側はいつまでも全部見えたまま——片側だけが減る動きになる。
   *
   * 残すのは映像と音声の境目。段の高さは変えない（触った覚えのない所が
   * 太ったり痩せたりするほうが分かりにくい）。
   *
   * 境目の位置は計算で出さず、**実際に置かれている最初の音声段**から測る。
   * 計算で出すと、余白や目盛りの高さを直したときにここだけ古い式が残る。
   */
  const fitTimelineAroundVA = useCallback((): void => {
    const el = scrollRef.current
    const inner = trackInnerRef.current
    if (!el || !inner) return
    const firstAudio = inner.querySelector<HTMLElement>('.track-audio')
    if (!firstAudio) return
    el.scrollTop = centeredScrollTop(
      firstAudio.offsetTop,
      el.clientHeight,
      el.scrollHeight - el.clientHeight
    )
    syncTimelineVScroll() // scrollTop を書いても届かない場合に備えて自分でも配る
  }, [syncTimelineVScroll])

  /**
   * 再生ヘッドを、横に見えている範囲へ連れてくる（**縦の追従の、横版**）。
   *
   * プレビューのバーで飛ばしても、タイムラインは動かないままだった
   * （再生ヘッド自体は動いているが、**枠の外なので見えない**）。
   * 再生し始めてようやく画面が追いつくので、「飛んだ先がどこか分からない」
   * 状態がしばらく続く。飛ばした時点で見える所へ持ってくる。
   *
   * すでに見えているなら**何もしない**（見えている物を動かすと、
   * 押すたびに画面が揺れて逆に読みにくい）。
   *
   * ここに置いてあるのは、**飛ばす側（usePlaybackEngine）より先に要る**から。
   * 飛ばす側は見せ方（useViewNav）を要り、見せ方は飛ばす側を要る——という輪に
   * なっていたが、この関数だけは飛ばす側を一切要らないので、外に出せば輪が切れる。
   */
  const revealPlayhead = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    const x = currentTimeRef.current * zoomRef.current
    const w = el.clientWidth
    const margin = Math.min(80, w * 0.15) // 端ぎりぎりだと次の操作でまた外れる
    if (x >= el.scrollLeft + margin && x <= el.scrollLeft + w - margin) return
    el.scrollLeft = Math.max(0, x - w / 2)
  }, [currentTimeRef, zoomRef])

  /** いま画面に出ている時間の範囲（見えない帯は作らない） */
  const viewSec = useVisibleRange(scrollRef)
  /** その帯を描く必要があるか */
  const inView = (tStart: number, tEnd: number): boolean =>
    tEnd >= viewSec.a && tStart <= viewSec.b

  return {
    screenRef,
    trackInnerRef,
    scrollRef,
    thBodyRef,
    syncTimelineVScroll,
    fitTimelineAroundVA,
    revealPlayhead,
    viewSec,
    inView
  }
}
