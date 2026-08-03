// 「≫」の中の並び替えコーナー。
//
// 元は `PanelChrome.tsx` に、タブ帯・別ウィンドウと同居していた。
// **あのファイルの頭のコメント自身が3つ挙げていて**、3組は定数もヘルパも
// state も1つも共有していなかった（またぐ名前は 0 / 0）。読む相手も
// ここは AppMenus だけで、他の2つと重なっていない。
//
// なお下の説明は、元ファイルでは**本体から36行離れた所**（別ウィンドウの
// 定数の真上）に置かれていた。中身と一緒に戻してある。

import { useRef, useState } from 'react'

/**
 * 「≫」の中の並び替えコーナー。
 *
 * 帯の上で掴んで動かす方法は残してあるが、狭いパネルでは掴む場所そのものが
 * 見えないことがある。ここなら幅に関係なく必ず並び替えられる。
 *
 * 操作は**長押ししてから動かす**。押しただけ・軽く触れただけで並びが
 * 変わってしまうと、選ぼうとしただけなのに並びが崩れる。
 *
 * ※ App の中で定義してはいけない（PanelTabs と同じ理由）。
 */
const SORT_HOLD_MS = 280
export function TabSortList({
  tabs,
  active,
  onReorder
}: {
  tabs: { id: string; label: string }[]
  active: string
  onReorder: (ids: string[]) => void
}): JSX.Element {
  const listRef = useRef<HTMLDivElement | null>(null)
  const [holdId, setHoldId] = useState<string | null>(null) // 長押し待ち
  const [grabId, setGrabId] = useState<string | null>(null) // 掴んだ
  // いまの並び順。掴んでいる間の処理から読む。
  // 掴んだ時点の並びを覚えたままにすると、1つ動かした後の「何番目か」が
  // 古いままになり、2つ以上またいで動かしたときに違う場所へ入る。
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const start = (id: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    setHoldId(id)
    // 掴んだ位置（枠の上端から何px下を掴んだか）と、枠の高さ。
    // これを見ないと、枠のどこを掴んでも同じ扱いになり、
    // **掴んでいる枠がマウスからずれて見える**。
    const box = e.currentTarget.getBoundingClientRect()
    const grabDY = e.clientY - box.top
    const boxH = box.height
    // 掴んだかどうかは、この場の値で見る。state は次のレンダーまで反映されず、
    // 長押しが成立した直後の動きを取りこぼす。
    let grabbed = false
    const timer = window.setTimeout(() => {
      grabbed = true
      setHoldId(null)
      setGrabId(id)
    }, SORT_HOLD_MS)
    const move = (ev: PointerEvent): void => {
      // 長押しが成立する前の動きでは並び替えない（選ぼうとしただけで崩れないように）
      if (!grabbed) return
      const list = listRef.current
      if (!list) return
      const rows = [...list.querySelectorAll<HTMLElement>('.tab-sort-row')].map((r) =>
        r.getBoundingClientRect()
      )
      const ids = tabsRef.current.map((t) => t.id)
      const from = ids.indexOf(id)
      if (from < 0) return
      // いま掴んでいる枠が「どこにあるか」。マウスの位置ではなく、掴んでいる枠の
      // 上端・下端で判定する。
      const top = ev.clientY - grabDY
      const bottom = top + boxH
      let to = from
      // 下へ動かすとき: 掴んでいる枠の**下端**が、相手の枠の**下端**に届いたら入れ替える。
      // 相手の上端を基準にすると、まだ半分しか重なっていないのに入れ替わり、
      // 掴んでいる枠がマウスから離れていく。
      for (let i = from + 1; i < rows.length; i++) if (bottom >= rows[i].bottom) to = i
      // 上へ動かすとき: **上端**が相手の**上端**に届いたら
      for (let i = from - 1; i >= 0; i--) if (top <= rows[i].top) to = i
      if (to !== from) {
        const next = [...ids]
        next.splice(from, 1)
        next.splice(to, 0, id)
        onReorder(next)
      }
    }
    const up = (): void => {
      window.clearTimeout(timer)
      setHoldId(null)
      setGrabId(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  return (
    <div className="tab-sort" ref={listRef}>
      {tabs.map((t) => (
        <div
          key={t.id}
          className={`tab-sort-row ${grabId === t.id ? 'tab-sort-grab' : ''} ${
            holdId === t.id ? 'tab-sort-hold' : ''
          } ${active === t.id ? 'tab-sort-on' : ''}`}
          onPointerDown={start(t.id)}
          title="長押ししてから上下に動かすと、並び順を変えられます"
        >
          <span className="tab-sort-grip">⠿</span>
          <span className="tab-sort-label">{t.label}</span>
        </div>
      ))}
    </div>
  )
}
