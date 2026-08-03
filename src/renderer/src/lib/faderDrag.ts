// ミキサーの縦フェーダーを掴んで振る。
//
// 元は `state/useTracksAdmin`（段そのものの面倒）に居たが、**段と何の関係も無い**。
// 呼ぶのは `PreviewBars` のミキサーだけで、React の状態も心臓も1つも要らない
// （要るのは `clamp` だけ）。ここに置くと 0 個の導管で済む
// （2026-08-03。中身は変えていない）。

import { clamp } from '../../../shared/timeline'

/** 縦フェーダーのドラッグ（上=1.0 / 下=0）。apply には 0..1 の値が渡る */
export function startFader(e: React.PointerEvent, apply: (f: number) => void): void {
  e.preventDefault()
  e.stopPropagation()
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const set = (cy: number): void => apply(clamp(1 - (cy - rect.top) / rect.height, 0, 1))
  set(e.clientY)
  const mv = (ev: PointerEvent): void => set(ev.clientY)
  const up = (): void => {
    window.removeEventListener('pointermove', mv)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
  }
  window.addEventListener('pointermove', mv)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}
