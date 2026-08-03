// 見切れないタブ帯（パネルの上に並ぶタブ）。
//
// 元は `PanelChrome.tsx` に、別ウィンドウ・並び替えと同居していた。
// **あのファイルの頭のコメント自身が「タブ帯・並び替え・別ウィンドウ」と
// 3つ挙げていて**、3組は定数もヘルパも state も1つも共有していなかった
// （またぐ名前は 0 / 0）。読む相手も重なっていない
// （ここは PreviewArea と RightPanelArea だけ）。
//
// **App の中で定義してはいけない**部品。中で定義すると毎レンダーで作り直され、
// ref も掴んでいる途中の状態も失われる（実際に起きた）。
// 別ファイルに置いてあれば「うっかり中へ移す」事故も起きない。

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * 見切れないタブ帯。
 *
 * パネルを狭めるとタブが端から切れて、奥のタブへ一生たどり着けなかった。
 * 3つの逃げ道を用意する:
 *   1. 端の「送り」ボタン（押しっぱなしで送り続ける）
 *   2. 「≫」から、いま見えていないタブを一覧で選ぶ
 *   3. 掴んで横に引っぱる
 *
 * ※ App の中で定義してはいけない。毎レンダーで別物として作り直され、
 *   ref も横スクロール位置も失われて、引っぱっても戻ってしまう（実際に起きた）。
 */
export function PanelTabs({
  group,
  tabs,
  active,
  onPick,
  onTabMenu,
  onOverflow,
  onReorder,
  right
}: {
  group: string
  tabs: { id: string; label: string }[]
  active: string
  onPick: (id: string) => void
  onTabMenu: (e: React.MouseEvent, group: string, id: string, label: string) => void
  onOverflow: (e: React.MouseEvent, group: string, hidden: string[]) => void
  onReorder: (ids: string[]) => void
  /**
   * 見出しの右端に置く物。
   *
   * **押す物ではなく「いまどうなっているか」を置く場所。**
   * プレビューの画質・fps・尺がここにある。操作バーへ混ぜると、
   * 一番よく押す再生ボタンが端へ押しやられて毎回探すことになる
   * （components/panels/PreviewBars.tsx に経緯）。
   */
  right?: ReactNode
}): JSX.Element {
  const stripRef = useRef<HTMLDivElement | null>(null)
  const [over, setOver] = useState(false) // 端が切れているか
  const [dragId, setDragId] = useState<string | null>(null)
  const didDragRef = useRef(false) // 並べ替えた直後にタブが切り替わらないように
  // いまの並び順。掴んでいる間の処理から読む（掴んだ時点の並びを
  // 覚えたままだと、1つ動かした後の「何番目か」が古いままになる）
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  /** いま帯からはみ出して見えていないタブ。「≫」はこれを出す。 */
  const hiddenIds = (): string[] => {
    const strip = stripRef.current
    if (!strip) return []
    const box = strip.getBoundingClientRect()
    return [...strip.querySelectorAll<HTMLElement>('.tab')]
      .map((el, i) => ({ el, id: tabs[i]?.id }))
      .filter(({ el }) => {
        const r = el.getBoundingClientRect()
        return r.left < box.left - 1 || r.right > box.right + 1
      })
      .map(({ id }) => id)
      .filter((id): id is string => !!id)
  }
  const measure = (): void => {
    const el = stripRef.current
    if (el) setOver(el.scrollWidth > el.clientWidth + 2)
  }
  useEffect(() => {
    measure()
    const ro = new ResizeObserver(measure)
    if (stripRef.current) ro.observe(stripRef.current)
    return () => ro.disconnect()
  }, [tabs.length])
  const hold = (dir: -1 | 1) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const step = (): void => {
      stripRef.current?.scrollBy({ left: dir * 18 })
    }
    step()
    const iv = window.setInterval(step, 40)
    const stop = (): void => {
      window.clearInterval(iv)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }
  return (
    <div className="panel-tabs">
      {/* 送りと一覧は**常に出す**。狭めたときだけ出す作りにしていたが、
          出たり消えたりで押す場所がずれるうえ、「どこにあるのか」を
          覚えられない。送るものが無いときは薄くして押しても何も起きない。 */}
      <button
        className={`tab-nav ${over ? '' : 'tab-nav-off'}`}
        title="左へ送る（押しっぱなしで続けて送る）"
        onPointerDown={over ? hold(-1) : undefined}
      >
        ‹
      </button>
      <div
        className="panel-tabs-strip"
        ref={stripRef}
        onScroll={measure}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          const el = stripRef.current
          if (!el) return
          const sx = e.clientX
          const s0 = el.scrollLeft
          let moved = false
          const mv = (ev: PointerEvent): void => {
            if (!moved && Math.abs(ev.clientX - sx) < 4) return
            moved = true
            el.scrollLeft = s0 - (ev.clientX - sx)
          }
          const up = (): void => {
            window.removeEventListener('pointermove', mv)
            window.removeEventListener('pointerup', up)
          }
          window.addEventListener('pointermove', mv)
          window.addEventListener('pointerup', up)
        }}
      >
        {tabs.map((t) => (
          <span
            key={t.id}
            className={`tab ${active === t.id ? 'tab-on' : ''} ${dragId === t.id ? 'tab-dragging' : ''}`}
            onClick={() => {
              // 並べ替えた直後は、タブが切り替わらないようにする
              if (didDragRef.current) {
                didDragRef.current = false
                return
              }
              onPick(t.id)
            }}
            onContextMenu={(e) => onTabMenu(e, group, t.id, t.label)}
            title={`${t.label}（掴んで左右に動かすと並び順を変えられます）`}
            // 掴んで動かす＝並べ替え。押しただけならタブの切り替え。
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.stopPropagation() // 帯の横スクロールと取り合わない
              const sx = e.clientX
              // 掴んだ位置（タブの左端から何px右を掴んだか）と幅。
              // 見ないと、タブのどこを掴んでも同じ扱いになり、
              // 掴んでいるタブがマウスからずれて見える。
              const tb = e.currentTarget.getBoundingClientRect()
              const grabDX = e.clientX - tb.left
              const tabW = tb.width
              let dragging = false
              const move = (ev: PointerEvent): void => {
                if (!dragging && Math.abs(ev.clientX - sx) < 5) return
                dragging = true
                didDragRef.current = true
                setDragId(t.id)
                const strip = stripRef.current
                if (!strip) return
                const rects = [...strip.querySelectorAll('.tab')].map((el) =>
                  el.getBoundingClientRect()
                )
                const ids = tabsRef.current.map((x) => x.id)
                const from = ids.indexOf(t.id)
                if (from < 0) return
                // 掴んでいるタブの左端・右端で判定する（縦の並び替えと同じ考え方）。
                // 右へ動かすときは**右端**が相手の右端に、
                // 左へ動かすときは**左端**が相手の左端に届いたら入れ替える。
                const left = ev.clientX - grabDX
                const right = left + tabW
                let to = from
                for (let i = from + 1; i < rects.length; i++) if (right >= rects[i].right) to = i
                for (let i = from - 1; i >= 0; i--) if (left <= rects[i].left) to = i
                if (to !== from) {
                  const next = [...ids]
                  next.splice(from, 1)
                  next.splice(to, 0, t.id)
                  onReorder(next)
                }
              }
              const up = (): void => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
                setDragId(null)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
          >
            {t.label}
          </span>
        ))}
      </div>
      <button
        className={`tab-nav ${over ? '' : 'tab-nav-off'}`}
        title="右へ送る（押しっぱなしで続けて送る）"
        onPointerDown={over ? hold(1) : undefined}
      >
        ›
      </button>
      <button
        className="tab-nav tab-more"
        title="タブを選ぶ・並び順を変える"
        onClick={(e) => onOverflow(e, group, hiddenIds())}
      >
        ≫
      </button>
      {right && <div className="panel-tabs-right">{right}</div>}
    </div>
  )
}
