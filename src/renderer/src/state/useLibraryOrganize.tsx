// 置き場の**整理**——お気に入り（★）・フォルダ・畳み（アコーディオン）。
//
// ## なぜ置き場と分かれているか
//
// 元は `useLibraries.tsx`（530行）で、冒頭が自分で
// 「置き場（効果音・テロップテンプレ・動きの見本帳）**と、その整理**」と
// **2つ宣言していた**。返す物も 11個 / 31個 にきれいに分かれていて、
// **またぐ名前は0個**だった（2026-08-03 に出した）。
//
// 置き場は「何があるか」を外から読む話。こちらは「それをどう並べるか」で、
// **覚え先は全部 localStorage**（中身そのものは一切触らない）。
//
// ## 畳みは「触っていない所は閉じる」
//
// 全部開いていると目的の物まで遠い。開くと他は閉じるが、
// **お気に入りと素材置き場だけは閉じない**（毎回開き直すことになるため）。
//
// ## 開いた所は見える位置まで送る
//
// 畳みを開いても、その見出しが画面の外だと「開いたのに何も起きない」に見える。
//
// ## 中身
//
// - `useLibraryOrganize` … 下の物を全部まとめて返す唯一の入口
import { useEffect, useRef, useState, type JSX } from 'react'
import { nextOpenSecs } from '../../../shared/accordion'
import {
  TELOP_CATS,
  colorCatOf,
  // **保存は「その1件の操作」だけ**（画面の一覧を丸ごと書かない。理由は lib 側の説明）
  persistCat,
  persistCustomCat,
  persistDropCat,
  persistFav,
  type TelopTemplate
} from '../lib/telopTemplates'
import { useProjectStateCtx } from './projectStateContext'

export interface UseLibraryOrganizeDeps {
  /** 名前を尋ねる小窓（フォルダを足すときに使う） */
  askText: (title: string, initial: string, onOk: (v: string) => void) => void
}

export function useLibraryOrganize(deps: UseLibraryOrganizeDeps) {
  const { askText } = deps
  const { favorites, setFavorites, catOverrides, setCatOverrides, customCats, setCustomCats } =
    useProjectStateCtx()
  // お気に入り（★）とカテゴリ上書き（ローカル保存）
  const isFav = (name: string): boolean => favorites.includes(name)
  // **画面の一覧を丸ごと保存しない。押した1件だけを保存済みへ当てる**（lib/telopTemplates）。
  // 画面の一覧にはプロジェクト由来が混ざっているので、そのまま書くと
  // **触っていない物まで焼き付く**（2026-08-04 に直した⑦の残り）。
  const toggleFav = (name: string): void =>
    setFavorites((prev) => {
      const on = !prev.includes(name)
      persistFav(name, on)
      return on ? [...prev, name] : prev.filter((n) => n !== name)
    })
  const setTplCat = (name: string, cat: string): void =>
    setCatOverrides((prev) => {
      persistCat(name, cat)
      return { ...prev, [name]: cat }
    })
  // テロップタブのセクション開閉（アコーディオン＝1つだけ開く。既定は全て閉じる）
  const [openTplSec, setOpenTplSec] = useState<string | null>(null)
  const toggleTplSec = (k: string): void => setOpenTplSec((p) => (p === k ? null : k))
  // 右パネル他タブ（プロジェクト/アイコン/SE/トランジション）のセクション開閉。
  // テロップタブのフォルダUIと同じ動作＝1タブにつき1つだけ開く・開いたら見出しへ自動スクロール（UI統一）。
  // 開いている折りたたみ。値は「開いているキーの配列」。
  // テロップ一覧のように点数が多いタブは1つだけ開く（全部開くと探せない）が、
  // 素材ビン（プロジェクト）は種類が3つだけなので、最初から全部開けておく。
  // 毎回3回クリックして開くのは手間なだけで、隠す意味がない。
  // 効果音も複数同時に開ける。**お気に入りは開けたままにしておきたい**のに、
  // 1つだけ開く作りだとフォルダを開くたびに畳まれる（実際に使うのはお気に入りが
  // ほとんどなので、毎回開き直すことになっていた）。
  const ALWAYS_OPEN_TABS = ['project', 'se']
  // どこを開けていたかは覚える。**開閉は編集の癖**なので、毎回開き直させない
  // （既定を「お気に入りは開く」にしても、閉じる派の人が毎回閉じることになる）。
  const ACC_KEY = 'giftcut.accOpen'
  const [openAccSec, setOpenAccSec] = useState<Record<string, string[]>>(() => {
    const def: Record<string, string[]> = {
      project: ['video', 'audio', 'image'],
      // お気に入りは、どのタブでも最初から開けておく（一番よく使う所なので）
      icon: ['fav', 'lib'],
      telop: ['fav'],
      // 効果音は「★お気に入り」を最初から開けておく。
      // 外から足したフォルダも同じ扱いで、開いたぶんはそのまま残る
      se: ['fav'],
      // トランジションは**どれも開かない**で始める。節が増えて（動画・テロップ・
      // 強調・動きの見本帳）、1つ開いた状態だと他の節が下へ押し出されて見えない。
      // どれを使うかは人によるので、勝手に1つだけ開けておく意味がない。
      transition: []
    }
    try {
      const saved = JSON.parse(localStorage.getItem(ACC_KEY) ?? 'null')
      if (!saved || typeof saved !== 'object') return def
      // 壊れた値が入っていても、そこだけ既定へ落とす（画面ごと消さない）
      const out = { ...def }
      for (const [tab, v] of Object.entries(saved)) {
        if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[tab] = v as string[]
      }
      return out
    } catch {
      return def
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(ACC_KEY, JSON.stringify(openAccSec))
    } catch {
      /* 容量超過などは無視（開閉が覚えられないだけ） */
    }
  }, [openAccSec])
  const accSecRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const toggleAccSec = (tab: string, k: string): void =>
    setOpenAccSec((p) => {
      const cur = p[tab] ?? []
      const isOpen = cur.includes(k)
      // 全部開けておくタブは複数同時に開ける。それ以外は従来どおり1つだけ。
      // 決まりは shared/accordion に置いてある（画面を作らずに試せるように）
      const next = nextOpenSecs(cur, k, ALWAYS_OPEN_TABS.includes(tab))
      if (!isOpen) alignSecTop(`${tab}:${k}`)
      return { ...p, [tab]: next }
    })

  /**
   * 開いた節を、一覧の一番上へ合わせる。
   *
   * **1回では合わない。** 中身は見えている分だけ描く作りなので、開いた直後は
   * まだ高さが決まっておらず、そのあと伸び縮みして位置がずれる。
   * 前は2コマ待って1回だけ合わせていたので、**下まで見てから次を開くと
   * 1つ目からではなく途中から出る**（本人から上がった症状）。
   *
   * 位置が落ち着くまで合わせ直す。落ち着かなくても 40コマ で諦める
   *（読み込み中の一覧に張り付いて、指で送っても引き戻されるのを避ける）。
   *
   * ※ 滑らかに送る（smooth）のはやめた。毎コマ呼び直すと、そのたびに
   *   滑りが最初からやり直しになって、いつまでも着かない。
   */
  const alignSecTop = (id: string): void => {
    let left = 40
    let prev = Number.NaN
    let same = 0
    const tick = (): void => {
      const el = accSecRefs.current[id]
      if (!el) return
      el.scrollIntoView({ block: 'start' })
      const top = el.offsetTop
      if (top === prev) {
        if (++same >= 2) return // 2コマ続けて動かない＝落ち着いた
      } else same = 0
      prev = top
      if (left-- <= 0) return
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
  // テロップタブと同じ見た目のセクション見出し＋開閉ボディ
  const accSec = (
    tab: string,
    key: string,
    label: string,
    count: number | null,
    body: JSX.Element,
    onDelete?: () => void
  ): JSX.Element => {
    const open = (openAccSec[tab] ?? []).includes(key)
    return (
      <div key={key} ref={(el) => (accSecRefs.current[`${tab}:${key}`] = el)}>
        <button className={`tpl-acc ${open ? 'open' : ''}`} onClick={() => toggleAccSec(tab, key)}>
          <span className="tpl-acc-ar">{open ? '▼' : '▶'}</span>
          {label}
          {count != null ? `（${count}）` : ''}
          {onDelete && (
            <span
              className="tpl-acc-del"
              title="フォルダを削除（中のアイテムは元の場所へ戻る）"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
            >
              ✕
            </span>
          )}
        </button>
        {open && body}
      </div>
    )
  }
  // ---- SE/アイコンの ★お気に入り＋ユーザーフォルダ（テロップタブと同じ整理機能）----
  const loadLS = <T,>(key: string, fallback: T): T => {
    try {
      const s = localStorage.getItem(key)
      return s ? (JSON.parse(s) as T) : fallback
    } catch {
      return fallback
    }
  }
  const saveLS = (key: string, v: unknown): void => {
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {
      /* 容量超過等は無視 */
    }
  }

  const [seFavs, setSeFavs] = useState<string[]>(() => loadLS('giftcut.seFavorites', []))
  const [seFolders, setSeFolders] = useState<{ key: string; label: string }[]>(() =>
    loadLS('giftcut.seFolders', [])
  )
  const [seOv, setSeOv] = useState<Record<string, string>>(() => loadLS('giftcut.seOverrides', {}))
  const [iconFavs, setIconFavs] = useState<string[]>(() => loadLS('giftcut.iconFavorites', []))
  const [iconFolders, setIconFolders] = useState<{ key: string; label: string }[]>(() =>
    loadLS('giftcut.iconFolders', [])
  )
  const [iconOv, setIconOv] = useState<Record<string, string>>(() =>
    loadLS('giftcut.iconOverrides', {})
  )
  /**
   * 効果音とアイコンの「お気に入り・フォルダ」は、**やっていることが同じ**。
   *
   * 2026-08-03 まで、5組（お気に入りの入切・フォルダの付け替え・足す・消す）が
   * **本体まで丸写しで2つずつ**あった。違うのは覚え先のキーと、
   * 予約語（アイコンだけ 'lib' も使えない）だけ。
   * **片方だけ直すと、もう片方が置き去りになる**ので、違いを表にして1本にした。
   */
  const seSide = {
    favs: setSeFavs,
    ov: setSeOv,
    folders: seFolders,
    setFolders: setSeFolders,
    tab: 'se' as const,
    keys: { fav: 'giftcut.seFavorites', ov: 'giftcut.seOverrides', folders: 'giftcut.seFolders' },
    reserved: ['fav']
  }
  const iconSide = {
    favs: setIconFavs,
    ov: setIconOv,
    folders: iconFolders,
    setFolders: setIconFolders,
    tab: 'icon' as const,
    // アイコンは 'lib'（アイコン画像）も節の名前として使っているので予約語
    keys: {
      fav: 'giftcut.iconFavorites',
      ov: 'giftcut.iconOverrides',
      folders: 'giftcut.iconFolders'
    },
    reserved: ['fav', 'lib']
  }
  type Side = typeof seSide | typeof iconSide

  /** お気に入りの入切（入っていれば外す） */
  const toggleFavOn = (s: Side, id: string): void =>
    s.favs((prev) => {
      const n = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      saveLS(s.keys.fav, n)
      return n
    })
  /** その物をどのフォルダに入れるか（null で元に戻す） */
  const setFolderOn = (s: Side, id: string, key: string | null): void =>
    s.ov((prev) => {
      const n = { ...prev }
      if (key) n[id] = key
      else delete n[id]
      saveLS(s.keys.ov, n)
      return n
    })
  /** フォルダを足して、そこを開く */
  const addFolderOn = (s: Side): void =>
    askText('フォルダ名', '新しいフォルダ', (name) => {
      const key = (name || '').trim()
      if (!key || s.reserved.includes(key) || s.folders.some((f) => f.key === key)) return
      const next = [...s.folders, { key, label: key }]
      s.setFolders(next)
      saveLS(s.keys.folders, next)
      setOpenAccSec((p) => ({ ...p, [s.tab]: [key] }))
    })
  /** フォルダを消す。**中の物は消さず、元の場所へ戻す** */
  const deleteFolderOn = (s: Side, key: string): void => {
    const next = s.folders.filter((f) => f.key !== key)
    s.setFolders(next)
    saveLS(s.keys.folders, next)
    s.ov((prev) => {
      const n = Object.fromEntries(Object.entries(prev).filter(([, v]) => v !== key))
      saveLS(s.keys.ov, n)
      return n
    })
    setOpenAccSec((p) => ({ ...p, [s.tab]: (p[s.tab] ?? []).filter((x) => x !== key) }))
  }

  const toggleSeFav = (p: string): void => toggleFavOn(seSide, p)
  const toggleIconFav = (id: string): void => toggleFavOn(iconSide, id)
  const setSeFolderOf = (p: string, key: string | null): void => setFolderOn(seSide, p, key)
  const setIconFolderOf = (id: string, key: string | null): void => setFolderOn(iconSide, id, key)
  const addSeFolder = (): void => addFolderOn(seSide)
  const addIconFolder = (): void => addFolderOn(iconSide)
  const deleteSeFolder = (key: string): void => deleteFolderOn(seSide, key)
  const deleteIconFolder = (key: string): void => deleteFolderOn(iconSide, key)
  // SE/アイコン共用の右クリックメニュー（テロップの「フォルダへ移動」と同じ見た目・動作）
  const [orgMenu, setOrgMenu] = useState<{
    x: number
    y: number
    options: { label: string; checked?: boolean; act: () => void }[]
  } | null>(null)
  useEffect(() => {
    if (!orgMenu) return
    const close = (): void => setOrgMenu(null)
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOrgMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onEsc)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onEsc)
    }
  }, [orgMenu])
  // ユーザー作成フォルダ（カテゴリ）。既定の色カテゴリ + これ。
  const allCats = [...TELOP_CATS, ...customCats]
  // 実効カテゴリ＝手動移動(上書き)優先→スタイルの見た目の色で自動判定。
  // 上書き先が存在しないカテゴリ(削除フォルダ/旧・使い道カテゴリ)は無視して色判定へ＝自動移行。
  const catKeySet = new Set(allCats.map((c) => c.key))
  const catOf = (t: TelopTemplate): string => {
    const ov = catOverrides[t.name]
    if (ov && catKeySet.has(ov)) return ov
    return colorCatOf(t.style)
  }
  const addCustomCat = (): void =>
    askText('フォルダ名', '新しいフォルダ', (name) => {
      const key = (name || '').trim()
      if (!key || allCats.some((c) => c.key === key)) return
      setCustomCats([...customCats, { key, label: key }])
      persistCustomCat(key, key)
      setOpenTplSec(key)
    })
  const deleteCustomCat = (key: string): void => {
    setCustomCats(customCats.filter((c) => c.key !== key))
    persistCustomCat(key, null)
    // このフォルダに入れていたテロップは上書きを外して元カテゴリへ戻す
    persistDropCat(key)
    setCatOverrides((prev) => {
      const m = { ...prev }
      for (const n of Object.keys(m)) if (m[n] === key) delete m[n]
      return m
    })
    if (openTplSec === key) setOpenTplSec(null)
  }


  // **返すのは、外が本当に受け取っている物だけ。**
  // return の中は noUnusedLocals が見ないので、放っておくと静かに増える
  // （割る前は57個返していて、受け取られていたのは43個だった）。
  return {
    isFav, toggleFav, setTplCat, openTplSec, toggleTplSec,
    setOpenAccSec, accSec, loadLS, saveLS,
    seFavs, seFolders, seOv,
    iconFavs, setIconFavs, iconFolders, iconOv, setIconOv,
    toggleSeFav, toggleIconFav, setSeFolderOf, setIconFolderOf,
    addSeFolder, deleteSeFolder, addIconFolder, deleteIconFolder,
    orgMenu, setOrgMenu, allCats, catOf, addCustomCat, deleteCustomCat
  }
}
