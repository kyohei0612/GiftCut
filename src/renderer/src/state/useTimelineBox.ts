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
// ## React の状態にしない
//
// スクロールは毎秒何十回も飛んでくる。状態にすると毎回描き直しになり、
// せっかく 250回/秒 → 60回/秒 に減らした所へ逆戻りする。
import { useCallback, useRef } from 'react'
import { applyTimelineVScroll, centeredScrollTop } from '../lib/timelineVScroll'
import { useVisibleRange } from './useVisibleRange'

export function useTimelineBox() {
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
    viewSec,
    inView
  }
}
