// 置き場——効果音・テロップの見本・動きの見本帳が**何があるか**を読む。
//
// ## 取り込みは「足す」で、置き換えない
//
// 同じ名前が来ても前の物を消さない。作りかけを上書きされるのが一番困る。
//
// ## 入れたらその場で読み直す
//
// 入れたのに一覧が変わらないと、入ったのかどうか本人には分からない。
//
// ## 人からもらった JSON はそのまま信じない
//
// 動きの見本帳は `motion-presets/*.json`。読み直すときも**必ず sanitizeMotion を
// 通す**（壊れた形が動きの計算まで届くと画面が消える）。
//
// ## 並べ方は別ファイル（2026-08-03 に出した）
//
// 元は530行で、冒頭が自分で「置き場**と、その整理**」と2つ宣言していた。
// ★・フォルダ・畳みは `./useLibraryOrganize` へ。返す物も 11個 / 31個 に
// きれいに分かれ、**またぐ名前は0個**だった。
//
// ## 中身
//
// - `useLibraries` … 下の物を全部まとめて返す唯一の入口

import { useEffect, useState } from 'react'
import { hasMotion, sanitizeMotion } from '../lib/telopStyle'
import type { TelopTemplate } from '../lib/telopTemplates'
import type { MotionPresetFile } from '../../../shared/telopMotion'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useToastCtx } from './toastContext'

export interface UseLibrariesDeps {
  /** 名前を尋ねる小窓（自分の動きを保存するときに使う） */
  askText: (title: string, initial: string, onOk: (v: string) => void) => void
}

export function useLibraries(deps: UseLibrariesDeps) {
  const { askText } = deps
  const { cues } = useDoc()
  const { selectedIds } = useSel()
  const { showToast } = useToastCtx()

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


  // **返すのは、外が本当に受け取っている物だけ。**
  // 2026-08-03 まで57個返していたが、受け取られていたのは43個。差の14個
  // （setSeLibrary / setLocalTemplates / setMotionPresets / MY_MOTIONS_KEY /
  //   setMyMotions / putMyMotions / setOpenTplSec / openAccSec / accSecRefs /
  //   toggleAccSec / setSeFavs / setSeFolders / setSeOv / setIconFolders）は
  // このファイルの中でしか使っていなかった。**return の中は noUnusedLocals が
  // 見ない**ので、静かに増え続ける場所。
  return {
    seLibrary, refreshSE, importSeInto, localTemplates, refreshPresets,
    motionPresets, refreshMotionPresets, importMotionPresets,
    myMotions, saveMyMotion, deleteMyMotion
  }
}
