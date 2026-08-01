// 掴んでいる最中に、カーソルへ何を握らせるか。
//
// ## なぜ既定のゴーストを消すか
//
// ブラウザは掴んだ要素そのもの（ボタン全体など）を半透明で引きずる。
// しかしこのアプリは**置き先をタイムラインの上に帯で見せる**ので、カーソル側にも
// 大きな絵があると二重になって、どちらが本当の置き先か分からなくなる。
//
// 消すには「透明な1px の画像」を握らせるしかない（消す API は無い）。

/** カーソルに何も握らせないための、透明な1px */
export const EMPTY_DRAG_IMG =
  typeof Image !== 'undefined'
    ? Object.assign(new Image(), {
        src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
      })
    : null

/**
 * 掴んでいる物を、アイコンだけの小さな札でカーソルに見せる。
 *
 * 種類（つなぎ目の演出・テロップの出入り）を運ぶときは、**何を運んでいるかは
 * 見えた方がよい**。ただしボタン全体だと大きすぎるので、札にする。
 */
export function setDragChip(e: React.DragEvent, icon: string, label: string): void {
  e.dataTransfer.effectAllowed = 'copy'
  if (typeof document === 'undefined') return
  const el = document.createElement('div')
  el.className = 'drag-chip'
  el.textContent = `${icon} ${label}`
  document.body.appendChild(el)
  try {
    e.dataTransfer.setDragImage(el, 14, 14)
  } catch {
    /* 掴む絵を差し替えられなくても、掴むこと自体はできる */
  }
  // setDragImage はその場で写しを取るので、次の一拍で片付けてよい
  setTimeout(() => el.remove(), 0)
}
