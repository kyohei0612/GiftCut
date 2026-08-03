// パネルを**アプリの外**（別ウィンドウ・別モニター）へ出す。
//
// 元は `PanelChrome.tsx` に、タブ帯・並び替えと同居していた。
// **あのファイルの頭のコメント自身が3つ挙げていて**、3組は定数もヘルパも
// state も1つも共有していなかった（またぐ名前は 0 / 0）。
//
// 同居していた害が形にも出ていた: 並び替え（TabSortList）の説明が
// `PANE_WINDOWS` の真上に置かれ、**本体から36行離れていた**。
// 3つの話題が層になって噛み合っていたせい（2026-08-03 に分けて、説明も本体へ戻した）。

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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
