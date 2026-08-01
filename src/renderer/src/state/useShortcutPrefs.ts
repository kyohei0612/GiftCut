// キーの割り当てと、環境設定・ファイルメニューの開け閉め。
//
// ## なぜ1か所にまとまるか
//
// 「割り当ての表」「設定の窓」「打鍵を待ち受ける状態」は、**同じ1つの話**。
// 設定の窓を開く → 変えたい項目を押す（待ち受け開始） → 打鍵で確定 → 保存、
// という1本の流れなので、途中の状態だけ別の場所にあると追えなくなる。
//
// ファイルメニューの開け閉ても一緒に置いてある。窓の外を押す・Escape で閉じる
// という同じ形の面倒を見ており、片方だけ直して片方を忘れる事故が起きやすい。
//
// ## 渡す物は無い
//
// 中身は localStorage と shared/shortcuts で完結する。App から何ももらわない。
import { useEffect, useState } from 'react'
import {
  DEFAULT_SHORTCUTS,
  SC_KEY,
  loadShortcuts,
  type ShortcutId,
  type Shortcuts
} from '../../../shared/shortcuts'
import { comboFromEvent } from '../../../shared/keymap'
import { useDismissOnOutside } from './useDismissOnOutside'

export function useShortcutPrefs() {
  const [shortcuts, setShortcuts] = useState<Shortcuts>(loadShortcuts)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  /** いま打鍵を待っている項目（null = 待っていない） */
  const [capturingId, setCapturingId] = useState<ShortcutId | null>(null)

  function save(next: Shortcuts): void {
    try {
      localStorage.setItem(SC_KEY, JSON.stringify(next))
    } catch {
      /* 保存できなくても、この回の割り当ては効かせる */
    }
  }

  function updateShortcut(id: ShortcutId, combo: string): void {
    setShortcuts((prev) => {
      const next = { ...prev, [id]: combo }
      save(next)
      return next
    })
  }

  function resetShortcuts(): void {
    setShortcuts({ ...DEFAULT_SHORTCUTS })
    save({ ...DEFAULT_SHORTCUTS })
  }

  // 待ち受け中は、次の打鍵で確定（Escape で取りやめ）。
  // capture フェーズで先取りするのは、**割り当て先の操作が先に走らないため**。
  // 例えば Ctrl+S を割り当てようとした瞬間に保存が走ってしまう。
  useEffect(() => {
    if (!capturingId) return
    function onKey(e: KeyboardEvent): void {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturingId(null)
        return
      }
      const combo = comboFromEvent(e)
      if (!combo) return // 修飾キーだけ → まだ打鍵待ち
      updateShortcut(capturingId as ShortcutId, combo)
      setCapturingId(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturingId])

  // ファイルメニューも、外を押す・Escape で閉じる。
  // **Escape が効かなかった。** 他のメニューも画面も全部 Escape で閉じるので、
  // ここだけ効かないと「閉じたつもり」のまま次の操作へ進む。しかも見出しの
  // 「ファイル」をもう一度押す動きは*開く*ではなく*閉じる*なので、閉じたつもりで
  // 押すと開かない——という分かりにくい形で表に出る（通しの確認が実際に落ちた）。
  useDismissOnOutside(fileMenuOpen, () => setFileMenuOpen(false))

  return {
    shortcuts,
    updateShortcut,
    resetShortcuts,
    prefsOpen,
    setPrefsOpen,
    fileMenuOpen,
    setFileMenuOpen,
    capturingId,
    setCapturingId
  }
}
