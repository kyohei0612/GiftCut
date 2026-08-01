// 開いている物を、外を押す・Escape で閉じる。
//
// ## なぜ共通にするか
//
// 品書き・小窓は数が多く、**どれか1つだけ Escape を忘れる**ということが実際に
// 起きた（他が全部閉じるので、そこだけ「閉じたつもり」のまま次の操作へ進む）。
// 閉じ方を1か所に置けば、忘れようがない。
import { useEffect } from 'react'

/**
 * @param open 開いているか（閉じているときは何も見張らない）
 * @param close 閉じる
 */
export function useDismissOnOutside(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return
    const onClick = (): void => close()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
}
