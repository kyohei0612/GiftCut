import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// パネルの外枠まわり（タブ帯・並び替え・別ウィンドウ）。
//
// App.tsx から切り出したもの。どれもプロパティだけで動き、App の状態を
// 直接触らない。**App の中で定義してはいけない**部品が集まっているので、
// ここに置いておけば「うっかり中へ移す」事故も起きない
// （中で定義すると毎レンダーで作り直され、ref も掴んでいる途中の状態も失われる）。

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
  onReorder
}: {
  group: string
  tabs: { id: string; label: string }[]
  active: string
  onPick: (id: string) => void
  onTabMenu: (e: React.MouseEvent, group: string, id: string, label: string) => void
  onOverflow: (e: React.MouseEvent, group: string, hidden: string[]) => void
  onReorder: (ids: string[]) => void
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
    </div>
  )
}

/**
 * パネルの置き場所。別ウィンドウへ出しているときだけ、中身をそちらへ差し込む。
 * 出していないときは、今までどおりその場に置く（何も挟まらない）。
 */
export function PaneHost({
  id,
  title,
  popped,
  geom,
  onClose,
  placeholder,
  children
}: {
  id: string
  title: string
  popped: boolean
  /** 保存してあった大きさ・位置。あればそこに開く（別モニターに置いたまま戻せる） */
  geom?: PaneGeom
  onClose: () => void
  /** 出ている間、その場所に置いておくもの。真ん中のパネルだけ必要（下記） */
  placeholder?: React.ReactNode
  children: React.ReactNode
}): JSX.Element {
  if (!popped) return <>{children}</>
  return (
    <>
      {placeholder}
      <PaneWindow id={id} title={title} geom={geom} onClose={onClose}>
        {children}
      </PaneWindow>
    </>
  )
}

/**
 * パネルを**アプリの外**（別ウィンドウ・別モニター）へ出す。
 *
 * 画面の中で浮かせる「切り離し」とは別物。作業中はパネルを2枚目のモニターへ
 * 逃がしたい、という要望から作った。
 *
 * 作りは `window.open` した別ウィンドウへ React のポータルで中身を差し込む形。
 * **同じレンダラーのまま**なので、状態はそのまま共有される（別ウィンドウで
 * 選んだクリップが本体側でも選ばれている、という当たり前の動きになる）。
 *
 * 気を付けたところ:
 *   - 別 document なので CSS は引き継がれない。style と link を写す
 *   - 掴んで動かす処理は、どれも本体側の window に耳を付けている。
 *     別ウィンドウの中で動かしたぶんが届かないと**掴んだまま固まる**ので、
 *     pointer 系だけ本体へ流す（座標はどちらも同じ窓の中で測るのでずれない）
 *   - キーは流さない。流すと、別ウィンドウの文字入力がショートカットとして
 *     二重に効いてしまう（文字を打つたびに削除や分割が走る）
 *   - ウィンドウを閉じたら自動で元の場所へ戻す（閉じ忘れで行方不明にしない）
 *
 * ※ App の中で定義してはいけない（PanelTabs と同じ理由）。
 */
function PaneWindow({
  id,
  title,
  geom,
  onClose,
  children
}: {
  id: string
  title: string
  geom?: PaneGeom
  onClose: () => void
  children: React.ReactNode
}): JSX.Element | null {
  // 開く場所は最初の1回だけ見る（開いたあとに保存内容が変わっても開き直さない）
  const geomRef = useRef(geom)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    // 置き直し（開発モードの2回走り）なら、さっきの窓をそのまま使う。
    // 新しく開き直すと、閉じかけの窓を掴んでしまい一瞬で消える。
    const kept = PANE_WINDOWS[id]
    if (kept && !kept.w.closed) {
      if (kept.closeTimer !== null) {
        window.clearTimeout(kept.closeTimer)
        kept.closeTimer = null
      }
      setHost(kept.root)
      const keptWatch = window.setInterval(() => {
        if (kept.w.closed) {
          window.clearInterval(keptWatch)
          delete PANE_WINDOWS[id]
          closeRef.current()
        }
      }, 400)
      return () => {
        window.clearInterval(keptWatch)
        const cur = PANE_WINDOWS[id]
        if (!cur) return
        cur.closeTimer = window.setTimeout(() => {
          delete PANE_WINDOWS[id]
          if (!cur.w.closed) cur.w.close()
        }, CLOSE_DELAY_MS)
      }
    }
    // 保存してあった大きさ・位置があればそこへ。無ければ本体の脇に手ごろな大きさで。
    const g = geomRef.current
    const feat = g
      ? `width=${g.w},height=${g.h},left=${g.x},top=${g.y}`
      : `width=${Math.min(760, Math.round(window.innerWidth * 0.42))},height=${Math.min(
          820,
          Math.round(window.innerHeight * 0.7)
        )}`
    const w = window.open('', `gc-pane-${id}`, feat)
    if (!w) {
      closeRef.current()
      return
    }
    const doc = w.document
    doc.title = `GiftCut - ${title}`
    // 見た目を写す。
    //
    // `link` の参照先はそのまま写すと相対のままで、別ウィンドウ側で
    // 何を基準に解決されるかが暗黙になる（いまは about:blank が本体の基準を
    // 継ぐので動いているだけ）。**絶対の場所にして写す**。
    const copyStyle = (node: Element): Node => {
      const c = node.cloneNode(true) as Element
      if (c.tagName === 'LINK') c.setAttribute('href', (node as HTMLLinkElement).href)
      return c
    }
    const STYLE_SEL = 'style, link[rel="stylesheet"]'
    for (const node of document.querySelectorAll(STYLE_SEL)) {
      doc.head.appendChild(copyStyle(node))
    }
    // 本体の見た目が後から変わることがある（開発中の書き換え、将来のテーマ切替）。
    // 開いた瞬間の1回だけ写すと、別ウィンドウだけ古い見た目のまま取り残される。
    const styleWatch = new MutationObserver(() => {
      doc.head.querySelectorAll(STYLE_SEL).forEach((n) => n.remove())
      for (const node of document.querySelectorAll(STYLE_SEL)) {
        doc.head.appendChild(copyStyle(node))
      }
    })
    styleWatch.observe(document.head, { childList: true, subtree: true, characterData: true })
    doc.body.className = document.body.className
    doc.body.style.margin = '0'
    doc.body.style.background = getComputedStyle(document.body).backgroundColor
    const root = doc.createElement('div')
    root.className = 'pane-pop-root'
    doc.body.appendChild(root)
    setHost(root)
    PANE_WINDOWS[id] = { w, root, closeTimer: null }
    // 掴んで動かすぶんを本体へ流す
    const forward = (ev: PointerEvent): void => {
      window.dispatchEvent(new PointerEvent(ev.type, ev))
    }
    for (const t of ['pointermove', 'pointerup', 'pointercancel']) {
      w.addEventListener(t, forward as EventListener, true)
    }
    // メニューを閉じる処理も本体側にあるので、押した合図だけ流す
    const forwardClick = (): void => {
      window.dispatchEvent(new MouseEvent('click'))
    }
    w.addEventListener('click', forwardClick, true)
    // ショートカットも流す。
    //
    // ただし**文字を打っている最中は流さない**。流すと、打った文字が
    // そのままショートカットとして効いて、1文字打つたびに削除や分割が走る。
    // 本体側は「押された相手が入力欄かどうか」で判断しているが、
    // 流したイベントの相手は本体の窓になるので、ここで見るしかない。
    const forwardKey = (ev: KeyboardEvent): void => {
      const el = ev.target as HTMLElement | null
      const tag = el?.tagName
      const typing =
        (tag === 'INPUT' && (el as HTMLInputElement).type !== 'range') ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el?.isContentEditable === true
      if (typing) return
      window.dispatchEvent(new KeyboardEvent(ev.type, ev))
    }
    w.addEventListener('keydown', forwardKey, true)
    // 本体が読み込み直されると、この中身を描いていた側がいなくなる。
    // 別ウィンドウだけが「もう動かない画面」として残るので、道連れに閉じる
    // （実際、再読み込みで1枚取り残された）。
    const closeWithOwner = (): void => {
      if (!w.closed) w.close()
    }
    window.addEventListener('beforeunload', closeWithOwner)
    // 閉じたら元の場所へ戻す。
    // beforeunload は閉じ方によっては飛んでこない（実際、閉じても戻らなかった）。
    // 閉じたかどうかを見張るのが確実。
    const watch = window.setInterval(() => {
      if (w.closed) {
        window.clearInterval(watch)
        delete PANE_WINDOWS[id]
        closeRef.current()
      }
    }, 400)
    return () => {
      window.clearInterval(watch)
      styleWatch.disconnect()
      window.removeEventListener('beforeunload', closeWithOwner)
      for (const t of ['pointermove', 'pointerup', 'pointercancel']) {
        w.removeEventListener(t, forward as EventListener, true)
      }
      w.removeEventListener('click', forwardClick, true)
      w.removeEventListener('keydown', forwardKey as EventListener, true)
      // すぐ閉じない。置き直し（開発モードの2回走り）なら、この直後に
      // また置かれるので、そのときは閉じるのをやめる
      const slot = PANE_WINDOWS[id]
      if (slot) {
        slot.closeTimer = window.setTimeout(() => {
          delete PANE_WINDOWS[id]
          if (!w.closed) w.close()
        }, CLOSE_DELAY_MS)
      } else if (!w.closed) {
        w.close()
      }
    }
    // 開くのは1回だけ。title が変わっても開き直さない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  if (!host) return null
  return createPortal(
    <>
      <div className="pane-pop-head">
        <span className="float-title">{title}</span>
        <button className="float-dock" title="本体へ戻す" onClick={() => closeRef.current()}>
          ⇤ 戻す
        </button>
      </div>
      {children}
    </>,
    host
  )
}

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
/**
 * 開いている別ウィンドウの控え。
 *
 * 開発モードの React（StrictMode）は、部品を置いた直後に
 * **わざと1回片付けて、もう一度置き直す**（後片付けが正しく書けているかを試すため）。
 * 「置いたら開く・片付けたら閉じる」と素直に書くと、
 * **開いた瞬間に閉じられて、押しても一瞬で消える**（実際にそうなった）。
 *
 * なので id ごとに窓を控えておき、置き直しでは同じ窓を使い回す。
 * 片付けはすぐ閉じずに少し待ち、その間に置き直されたら閉じるのをやめる。
 */
const PANE_WINDOWS: Record<
  string,
  { w: Window; root: HTMLElement; closeTimer: number | null }
> = {}
const CLOSE_DELAY_MS = 80

/** 切り離した窓の、いまの大きさと位置。保存するときに**その場で**読む。 */
export type PaneGeom = { x: number; y: number; w: number; h: number }
export function readPaneGeometry(): Record<string, PaneGeom> {
  const out: Record<string, PaneGeom> = {}
  for (const [id, slot] of Object.entries(PANE_WINDOWS)) {
    if (slot.w.closed) continue
    // 画面上の位置で持つ（別モニターに置いてあれば、その位置のまま戻せる）
    out[id] = {
      x: Math.round(slot.w.screenX),
      y: Math.round(slot.w.screenY),
      w: Math.round(slot.w.outerWidth),
      h: Math.round(slot.w.outerHeight)
    }
  }
  return out
}

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
