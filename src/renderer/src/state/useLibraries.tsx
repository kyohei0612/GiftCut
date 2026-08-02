// 置き場（効果音・テロップテンプレ・動きの見本帳）と、その整理（お気に入り・フォルダ・畳み）。
//
// ## 取り込みは「足す」で、置き換えない
//
// 同じ名前が来ても前の物を消さない。作りかけを上書きされるのが一番困る。
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
// ## 覚えるのは localStorage
//
// 開いている畳み・お気に入り・並び順など、**作業の続きに要る物だけ**。
// 中身そのもの（プロジェクト）はここでは扱わない。

import { useEffect, useRef, useState, type JSX } from 'react'
import { nextOpenSecs } from '../../../shared/accordion'
import { hasMotion, sanitizeMotion } from '../lib/telopStyle'
import {
  TELOP_CATS,
  colorCatOf,
  saveCatOverrides,
  saveCustomCats,
  saveFavorites,
  type TelopTemplate
} from '../lib/telopTemplates'
import type { MotionPresetFile } from '../../../shared/telopMotion'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useToastCtx } from './toastContext'
import { useProjectStateCtx } from './projectStateContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface UseLibrariesDeps {
  /** 名前を尋ねる小窓（自分の動きを保存するときに使う） */
  askText: (title: string, initial: string, onOk: (v: string) => void) => void
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useLibraries(deps: UseLibrariesDeps) {
  const { askText } = deps
  const { cues } = useDoc()
  const { selectedIds } = useSel()
  const { showToast } = useToastCtx()
  const {
    favorites, setFavorites, catOverrides, setCatOverrides, customCats, setCustomCats
  } = useProjectStateCtx()



  const [seLibrary, setSeLibrary] = useState<{ category: string; name: string; path: string }[]>([])
  /**
   * SE を置き場へ入れる。
   *
   *   何も渡さない … ファイルを選ぶ
   *   'folder'     … フォルダを選ぶ（そのフォルダごと分類になる）
   *   パスの配列   … 掴んで落とされた物
   *
   * **入れたらその場で読み直す。** 入れたのに一覧が変わらないと、
   * 入ったのかどうか本人には分からない。
   */
  async function importSeInto(arg?: 'folder' | string[]): Promise<void> {
    const r =
      arg === 'folder'
        ? await window.giftcut?.importSeFolder?.()
        : await window.giftcut?.importSe?.(Array.isArray(arg) ? arg : undefined)
    if (!r || r.canceled) return
    if (!r.ok) {
      showToast(`入れられませんでした。\n${r.error ?? ''}`)
      return
    }
    refreshSE()
    showToast(
      `SE に ${r.files}件${r.folders ? `（フォルダ ${r.folders}個）` : ''}入れました。` +
        'そのまま使えます。'
    )
  }
  const refreshSE = (): void => {
    void window.giftcut?.listSE?.()?.then((r) => {
      if (r?.ok) setSeLibrary(r.items)
    })
  }
  useEffect(() => {
    refreshSE()
  }, [])
  // ローカルのテロップテンプレ集（GiftCut/telop-presets/ = Geba等。配布に含めない）
  const [localTemplates, setLocalTemplates] = useState<TelopTemplate[]>([])
  const refreshPresets = (): void => {
    void window.giftcut?.listTelopPresets?.()?.then((r) => {
      if (r?.ok && Array.isArray(r.items)) setLocalTemplates(r.items as TelopTemplate[])
    })
  }
  // ---- 動きの見本帳（Premiere から写し取ったプリセット）----
  //
  // 置き場は motion-presets/*.json（取り込むと userData に書かれる）。
  // **読み直すときも必ず sanitizeMotion を通す**。人からもらった JSON を
  // そのまま信じると、壊れた形が動きの計算まで届いて画面が消える。
  const [motionPresets, setMotionPresets] = useState<MotionPresetFile[]>([])
  const refreshMotionPresets = (): void => {
    void window.giftcut?.listMotionPresets?.()?.then((r) => {
      if (!r?.ok || !Array.isArray(r.items)) return
      const items: MotionPresetFile[] = []
      for (const raw of r.items) {
        const o = raw as { name?: unknown; motion?: unknown; partial?: unknown; endsHidden?: unknown }
        if (typeof o?.name !== 'string') continue
        // **動きが空でも捨てない。** 名前だけでも並べて、押されたら理由を言う。
        // どれを使うか（配布に載せるか）を決めるのは人で、こちらが先に間引かない。
        items.push({
          name: o.name,
          motion: sanitizeMotion(o.motion) ?? {},
          ...(Array.isArray(o.partial) ? { partial: o.partial.map(String) } : {}),
          ...(o.endsHidden ? { endsHidden: true } : {})
        })
      }
      setMotionPresets(items)
    })
  }
  useEffect(() => {
    refreshMotionPresets()
  }, [])
  const importMotionPresets = (): void => {
    void window.giftcut?.importMotionPresets?.()?.then((r) => {
      if (!r || r.canceled) return
      if (!r.ok) {
        showToast(`取り込めませんでした: ${r.error ?? '不明なエラー'}`)
        return
      }
      refreshMotionPresets()
      // 一覧に出るのは**ちゃんと出る物だけ**なので、その数を主役にする。
      // 隠したぶんも数だけは言う（黙って減らすと「取り込めていない」に見える）。
      const full = (r.imported ?? 0) - (r.partial ?? 0) - (r.empty ?? 0)
      const hidden = (r.partial ?? 0) + (r.empty ?? 0)
      showToast(
        `${full} 個 使えるようになりました` +
          (hidden
            ? `（まだ出ない ${hidden} 個は隠してあります。一覧の「まだ出ない物も」で見られます）`
            : '')
      )
    })
  }

  /**
   * 自分で作って名前を付けて保存した動き。
   *
   * 置き場は取り込んだ物（userData の motion-presets/）とは分ける。
   * **混ぜると、取り込み直しで自分の物まで消える**うえ、配布に載せてよい物
   * （自分で作った物）と載せられない物（写し取った物）の区別が付かなくなる。
   * 中身は小さいので、設定と同じ所に置く（更新しても消えない）。
   */
  const MY_MOTIONS_KEY = 'giftcut.myMotions'
  const loadMyMotions = (): MotionPresetFile[] => {
    try {
      const raw = JSON.parse(localStorage.getItem(MY_MOTIONS_KEY) ?? '[]')
      if (!Array.isArray(raw)) return []
      const out: MotionPresetFile[] = []
      for (const o of raw) {
        // 人が触れる場所に置いてあるので、読み直すときも必ず通す
        if (typeof o?.name !== 'string') continue
        const m = sanitizeMotion(o.motion)
        if (m) out.push({ name: o.name, motion: m })
      }
      return out
    } catch {
      return []
    }
  }
  const [myMotions, setMyMotions] = useState<MotionPresetFile[]>(loadMyMotions)
  const putMyMotions = (next: MotionPresetFile[]): void => {
    setMyMotions(next)
    try {
      localStorage.setItem(MY_MOTIONS_KEY, JSON.stringify(next))
    } catch {
      showToast('自分の動きを保存できませんでした（保存領域がいっぱいの可能性）')
    }
  }
  /** いま選んでいるテロップの動きを、名前を付けて残す */
  function saveMyMotion(): void {
    const cue = cues.find((c) => selectedIds.includes(c.id))
    if (!cue) {
      showToast('テロップを選んでから保存してください。')
      return
    }
    const m = cue.motion
    if (!hasMotion(m)) {
      showToast('このテロップにはまだ動きが付いていません。')
      return
    }
    askText('この動きの名前', '', (v) => {
      const name = v.trim()
      if (!name) return
      // 同じ名前は上書き（増やし続けると一覧が使い物にならなくなる）
      const next = myMotions.filter((p) => p.name !== name)
      next.push({ name, motion: structuredClone(m!) })
      next.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
      putMyMotions(next)
      showToast(`「${name}」を自分の動きに保存しました。`)
    })
  }
  const deleteMyMotion = (name: string): void => {
    putMyMotions(myMotions.filter((p) => p.name !== name))
  }

  // お気に入り（★）とカテゴリ上書き（ローカル保存）
  const isFav = (name: string): boolean => favorites.includes(name)
  const toggleFav = (name: string): void =>
    setFavorites((prev) => {
      const next = prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
      saveFavorites(next)
      return next
    })
  const setTplCat = (name: string, cat: string): void =>
    setCatOverrides((prev) => {
      const next = { ...prev, [name]: cat }
      saveCatOverrides(next)
      return next
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
  const toggleSeFav = (p: string): void =>
    setSeFavs((prev) => {
      const n = prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
      saveLS('giftcut.seFavorites', n)
      return n
    })
  const toggleIconFav = (id: string): void =>
    setIconFavs((prev) => {
      const n = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      saveLS('giftcut.iconFavorites', n)
      return n
    })
  const setSeFolderOf = (p: string, key: string | null): void =>
    setSeOv((prev) => {
      const n = { ...prev }
      if (key) n[p] = key
      else delete n[p]
      saveLS('giftcut.seOverrides', n)
      return n
    })
  const setIconFolderOf = (id: string, key: string | null): void =>
    setIconOv((prev) => {
      const n = { ...prev }
      if (key) n[id] = key
      else delete n[id]
      saveLS('giftcut.iconOverrides', n)
      return n
    })
  const addSeFolder = (): void =>
    askText('フォルダ名', '新しいフォルダ', (name) => {
      const key = (name || '').trim()
      if (!key || key === 'fav' || seFolders.some((f) => f.key === key)) return
      const next = [...seFolders, { key, label: key }]
      setSeFolders(next)
      saveLS('giftcut.seFolders', next)
      setOpenAccSec((p) => ({ ...p, se: [key] }))
    })
  const deleteSeFolder = (key: string): void => {
    const next = seFolders.filter((f) => f.key !== key)
    setSeFolders(next)
    saveLS('giftcut.seFolders', next)
    setSeOv((prev) => {
      const n = Object.fromEntries(Object.entries(prev).filter(([, v]) => v !== key))
      saveLS('giftcut.seOverrides', n)
      return n
    })
    setOpenAccSec((p) => ({ ...p, se: (p.se ?? []).filter((x) => x !== key) }))
  }
  const addIconFolder = (): void =>
    askText('フォルダ名', '新しいフォルダ', (name) => {
      const key = (name || '').trim()
      if (!key || key === 'fav' || key === 'lib' || iconFolders.some((f) => f.key === key)) return
      const next = [...iconFolders, { key, label: key }]
      setIconFolders(next)
      saveLS('giftcut.iconFolders', next)
      setOpenAccSec((p) => ({ ...p, icon: [key] }))
    })
  const deleteIconFolder = (key: string): void => {
    const next = iconFolders.filter((f) => f.key !== key)
    setIconFolders(next)
    saveLS('giftcut.iconFolders', next)
    setIconOv((prev) => {
      const n = Object.fromEntries(Object.entries(prev).filter(([, v]) => v !== key))
      saveLS('giftcut.iconOverrides', n)
      return n
    })
    setOpenAccSec((p) => ({ ...p, icon: (p.icon ?? []).filter((x) => x !== key) }))
  }
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
      const next = [...customCats, { key, label: key }]
      setCustomCats(next)
      saveCustomCats(next)
      setOpenTplSec(key)
    })
  const deleteCustomCat = (key: string): void => {
    const next = customCats.filter((c) => c.key !== key)
    setCustomCats(next)
    saveCustomCats(next)
    // このフォルダに入れていたテロップは上書きを外して元カテゴリへ戻す
    setCatOverrides((prev) => {
      const m = { ...prev }
      for (const n of Object.keys(m)) if (m[n] === key) delete m[n]
      saveCatOverrides(m)
      return m
    })
    if (openTplSec === key) setOpenTplSec(null)
  }

  return {
    seLibrary, setSeLibrary, refreshSE, importSeInto, localTemplates, setLocalTemplates, refreshPresets,
    motionPresets, setMotionPresets, refreshMotionPresets, importMotionPresets,
    MY_MOTIONS_KEY, myMotions, setMyMotions, putMyMotions, saveMyMotion, deleteMyMotion,
    isFav, toggleFav, setTplCat, openTplSec, setOpenTplSec, toggleTplSec,
    openAccSec, setOpenAccSec, accSecRefs, toggleAccSec, accSec, loadLS, saveLS,
    seFavs, setSeFavs, seFolders, setSeFolders, seOv, setSeOv,
    iconFavs, setIconFavs, iconFolders, setIconFolders, iconOv, setIconOv,
    toggleSeFav, toggleIconFav, setSeFolderOf, setIconFolderOf,
    addSeFolder, deleteSeFolder, addIconFolder, deleteIconFolder,
    orgMenu, setOrgMenu, allCats, catOf, addCustomCat, deleteCustomCat
  }
}
