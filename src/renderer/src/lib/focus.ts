// 入力欄から手を離させる。
//
// ## なぜ独立した1本にしたか（2026-08-04）
//
// 配線（`useAppWiring`）の中に関数として置いてあった。中身は DOM を見るだけで
// **状態も心臓も1つも要らない**のに、そこに居るせいで `useTimelineDrag` を
// 囲いへ上げられなかった（`npm run passthrough` の「待ち」）。
//
// ## なぜ必要か
//
// スライダーや数値欄に居座られると、**矢印キーが再生ヘッドではなくその欄を動かし**、
// Space も効かなくなる。しかも掴む処理で既定の動きを止めているので、押しても
// 戻ってこない。タイムライン／プレビューを触った時点で外す。

/** 入力欄にフォーカスが残っていたら外す。**掴む入口で必ず呼ぶ** */
export function blurActiveInput(): void {
  const el = document.activeElement as HTMLElement | null
  if (!el) return
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') el.blur()
}
