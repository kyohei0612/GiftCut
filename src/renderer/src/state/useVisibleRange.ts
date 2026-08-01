// 画面に出ている時間の範囲（秒）。ここから外れた切片は帯を描かない。
//
// 並んでいる数だけ帯を作っていたので、マウスを動かすたびに全部が作り直され、
// クリップ1000個で1操作 68ms かかっていた。見えない帯を作らなければ、
// 何個並んでも「画面に映るぶん」しか作らずに済む。
//
// ## 前後1画面ぶん多めに作る
//
// ちょうど見えている分だけにすると、掴んで動かした先で帯が消える。
//
// ## 少しの動きでは作り直さない
//
// 半画面ぶん動いてから見直す。スクロールのたびに作り直すと、
// 軽くするために入れた仕組みが逆に重くなる。
//
// ## 幅が測れない間は全部描く
//
// 起動直後は幅が 0 で、そこで絞ると「t=0 付近の帯しか無い」状態になり、
// 置く・掴むが全部おかしくなる。

import { useEffect, useState } from 'react'
import { useViewCtx } from './viewContext'


export function useVisibleRange(scrollRef: React.RefObject<HTMLDivElement>): {
  a: number
  b: number
} {
  const { zoom, zoomRef } = useViewCtx()
  // 画面に出ている時間の範囲（秒）。ここから外れた切片は帯を描かない。
  //
  // 並んでいる数だけ帯を作っていたので、マウスを動かすたびに全部が作り直され、
  // クリップ1000個で1操作68ms かかっていた。見えない帯を作らなければ、
  // 何個並んでも「画面に映るぶん」しか作らずに済む。
  // 前後1画面ぶん多めに作る（掴んで動かした先で消えないように）。
  //
  // ※幅がまだ測れない間（起動直後など）は全部描く。ここで絞ると
  //   「t=0 付近の帯しか無い」状態になり、置く・掴むが全部おかしくなる。
  const ALL_VIEW = { a: -1e9, b: 1e9 }
  const [viewSec, setViewSec] = useState(ALL_VIEW)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let id = 0
    const update = (): void => {
      id = 0
      const z = zoomRef.current || 1
      const w = el.clientWidth
      if (!w) {
        setViewSec((p) => (p.a === ALL_VIEW.a ? p : ALL_VIEW))
        return
      }
      const pad = w / z
      setViewSec((prev) => {
        const a = el.scrollLeft / z - pad
        const b = (el.scrollLeft + w) / z + pad
        // 少しの動きで作り直さない（半画面ぶん動いたら見直す）
        if (Math.abs(a - prev.a) < pad * 0.5 && Math.abs(b - prev.b) < pad * 0.5) return prev
        return { a, b }
      })
    }
    const onScroll = (): void => {
      if (!id) id = requestAnimationFrame(update)
    }
    update()
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(onScroll)
    ro.observe(el)
    return () => {
      if (id) cancelAnimationFrame(id)
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // 拡大率が変わると見えている範囲も変わる
  useEffect(() => {
    const el = scrollRef.current
    const w = el?.clientWidth ?? 0
    if (!el || !w) return
    const z = zoom || 1
    const pad = w / z
    setViewSec({ a: el.scrollLeft / z - pad, b: (el.scrollLeft + w) / z + pad })
  }, [zoom])
  return viewSec
}
