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
    if (inside) window.addEventListener('pointerdown', onDown, true)
    else window.addEventListener('click', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      if (inside) window.removeEventListener('pointerdown', onDown, true)
      else window.removeEventListener('click', onDown)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inside])
}
