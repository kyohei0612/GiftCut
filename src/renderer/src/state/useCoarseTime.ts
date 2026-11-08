// 再生位置を**粗く**（既定 毎秒10回）読む。数値欄のように「見せるだけ」の所向け。
//
// ## なぜ要るか（2026-11-08）
//
// モーションのタブは数値欄が19個あり、`currentTime` を毎コマ読むと 19個の <input> の値を
// 毎コマ書き換える。それで左パネルの `panel-body` の中身の高さが揺れて Scrollbar changed が
// 毎秒158回起き、再生中のレイアウト（毎秒60回・99ms）の最大の汚し主になっていた
// （`node e2e/layout-who.mjs`）。数字は人が読む物なので毎秒10回で足りる。
//
// ## 作り
//
// 毎コマ変わる囲い（usePlaybackCtx）は読まない。読むのは ref（毎コマ変わらない側の囲い）で、
// 一定間隔で見に行って**変わっていたときだけ** state を更新する。止まっているときは
// 値が同じなので描き直しは起きない。飛んだ（シーク）直後は最大で1間隔ぶん遅れて追いつく。
import { useEffect, useState } from 'react'
import { usePlaybackStableCtx } from './playbackContext'

export function useCoarseTime(hz = 10): number {
  const { currentTimeRef } = usePlaybackStableCtx()
  const [t, setT] = useState(() => currentTimeRef.current)
  useEffect(() => {
    const id = window.setInterval(() => {
      // 同じ値なら React は描き直さない（setState の同値スキップ）
      setT(currentTimeRef.current)
    }, Math.max(16, Math.round(1000 / hz)))
    return () => window.clearInterval(id)
  }, [currentTimeRef, hz])
  return t
}
