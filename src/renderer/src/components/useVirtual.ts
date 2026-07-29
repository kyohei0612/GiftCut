// 「見えている所だけ作る」ために、入れ物の大きさとスクロール位置を見張る。
//
// 計算そのものは shared/virtualList（単体で確かめてある）。ここは
// 「いま何ピクセル見えていて、どこまでスクロールしているか」を測るだけ。
//
// 測る相手は **スクロールする箱**（パネルの本体）。カードの並びそのものは
// スクロールしないので、そちらを測っても常に全体の高さが返ってくる。

import { useEffect, useState, type RefObject } from 'react'

export interface Viewport {
  width: number
  height: number
  scrollTop: number
}

export function useViewport(ref: RefObject<HTMLElement>): Viewport {
  const [vp, setVp] = useState<Viewport>({ width: 0, height: 0, scrollTop: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const read = (): void =>
      setVp((prev) => {
        const next = {
          width: el.clientWidth,
          height: el.clientHeight,
          scrollTop: el.scrollTop
        }
        // 同じ値なら描き直さない（スクロールのたびに全部作り直さないため）
        return prev.width === next.width &&
          prev.height === next.height &&
          prev.scrollTop === next.scrollTop
          ? prev
          : next
      })
    read()
    el.addEventListener('scroll', read, { passive: true })
    // パネルの幅を変えると、1行に並ぶ数が変わる
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', read)
      ro.disconnect()
    }
  }, [ref])
  return vp
}
