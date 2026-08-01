// 見本帳（テロップのテンプレ）の棚まわり。
//
// ## なぜ「開いたら先頭へ送る」が要るか
//
// 分類をたたんで並べているので、下の方の分類を開いても**見出しが画面の外**に
// あって、開いた中身が1つも見えないことがある。開いた分類の1つ目が見えるよう、
// 見出しをパネルの先頭へ送る。
import { useEffect, useRef, useState } from 'react'

export interface TplMenu {
  x: number
  y: number
  name: string
  curCat: string
}

export interface UseTemplateShelfDeps {
  /** いま開いている分類（たたんだ物は null） */
  openTplSec: string | null
  /** 見本の一覧を作り直す（起動時に1回） */
  refreshPresets: () => void
}

export function useTemplateShelf(deps: UseTemplateShelfDeps) {
  const { openTplSec, refreshPresets } = deps

  /** 見本を右クリックしたときの品書き（分類の移動） */
  const [tplMenu, setTplMenu] = useState<TplMenu | null>(null)

  // 外を押す・Escape で閉じる。**開いたままにしない**
  useEffect(() => {
    if (!tplMenu) return
    const close = (): void => setTplMenu(null)
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setTplMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onEsc)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onEsc)
    }
  }, [tplMenu])

  /** 分類の見出しの置き場（開いたときに送る先） */
  const tplSecRefs = useRef<Record<string, HTMLDivElement | null>>({})
  useEffect(() => {
    if (!openTplSec) return
    const el = tplSecRefs.current[openTplSec]
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }, [openTplSec])

  // 起動時に一覧を作る
  useEffect(() => {
    refreshPresets()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 右のパネルの中身（送る量を測る相手） */
  const rightBodyRef = useRef<HTMLDivElement>(null)

  return { tplMenu, setTplMenu, tplSecRefs, rightBodyRef }
}
