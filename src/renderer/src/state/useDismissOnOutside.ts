// 開いている物を、外を押す・Escape で閉じる。
//
// ## なぜ共通にするか
//
// 品書き・小窓は数が多く、**どれか1つだけ Escape を忘れる**ということが実際に
// 起きた（他が全部閉じるので、そこだけ「閉じたつもり」のまま次の操作へ進む）。
// 閉じ方を1か所に置けば、忘れようがない。
//
// ## 「外」の測り方が2通りある
//
// 品書きは **click を待って、中の click は止まっている**前提で閉じられる。
// ところが**タイムラインのクリップは pointerdown を自分で止める**ので、
// 同じやり方では「クリップを押しても閉じない」になる（テロップの打ち直しが
// 実際にそうなっていて、他を押しても・再生しても閉じなかった）。
// 止められても届く capture で拾い、**押した場所が中かどうかを自分で見る**方を
// 選べるようにしてある。
//
// ## 右クリックでも閉じる（2026-11-12）
//
// 右クリックは `click` ではなく `contextmenu` なので、前は**開いたまま残った**。
// そこへ別の物を右クリックすると新しい品書きが重なって出る（本人「右クリックが
// 2重になる」。映像の品書きを開いたままテロップを右クリック、が典型）。
// 新しい品書きを開く側は contextmenu を止めるので、**capture で先に拾う**。
// 閉じる → 開くの順に積まれるので、最後に残るのは新しい方だけ。
// 品書きの中（`.ctx-menu`）の右クリックでは閉じない。
//
// **品書き・小窓の閉じ方は全部ここを通す。** 前は素材ビン（useLibraryOrganize）と
// タブ（useAppLayout）が同じ物を自前で書いていて、直すなら3か所だった。
import { useEffect } from 'react'

export interface DismissOpts {
  /**
   * ここより内側を押しても閉じない（CSS の選択子）。
   *
   * 指定すると **capture で pointerdown を拾う**ので、途中で止められていても
   * 効く。指定しなければ今までどおり click を待つ。
   */
  inside?: string
}

/**
 * @param open 開いているか（閉じているときは何も見張らない）
 * @param close 閉じる
 */
export function useDismissOnOutside(open: boolean, close: () => void, opts?: DismissOpts): void {
  const inside = opts?.inside
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    const onDown = (e: Event): void => {
      const t = e.target as Element | null
      if (inside && t?.closest?.(inside)) return
      close()
    }
    const onRight = (e: Event): void => {
      const t = e.target as Element | null
      if (t?.closest?.('.ctx-menu') || (inside && t?.closest?.(inside))) return
      close()
    }
    if (inside) window.addEventListener('pointerdown', onDown, true)
    else window.addEventListener('click', onDown)
    window.addEventListener('contextmenu', onRight, true)
    window.addEventListener('keydown', onKey)
    return () => {
      if (inside) window.removeEventListener('pointerdown', onDown, true)
      else window.removeEventListener('click', onDown)
      window.removeEventListener('contextmenu', onRight, true)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inside])
}
