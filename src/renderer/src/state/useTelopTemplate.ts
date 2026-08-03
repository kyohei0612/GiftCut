// テロップの見本（テンプレート）を作る・当てる・消す。
//
// ## なぜファイルの出し入れから出したか
//
// 元は `state/useProjectFile` に居た。あちらの頭のコメントは
// 「プロジェクトの開く・保存・復元と、テンプレート」と書いているが、
// **その「テンプレート」は本文の見出しどおり“プロジェクトの雛形”のこと**で、
// ここが扱う**テロップの文字装飾**とは別物だった。
//
// 中身も違う: `runs`（文字ごとの装飾）・`strokes`・`shadows` を相似で
// 拡大縮小する話で、ファイルの読み書きが1行も出てこない
// （2026-08-03。中身は1文字も変えていない。またぐ名前は 外→中 5 / 中→外 0）。
//
// ## 枠は当てない
//
// 見本を当てるとき、**位置と箱（anchor / box）はそのまま残す**。
// 見た目だけ差し替えたいのに、置いた場所まで見本の場所へ飛ぶと
// 毎回置き直す羽目になる（`mergeTemplateKeepFrame` がその線引き）。
//
// ## 文字を選んでいれば、そこだけ
//
// 打ち直しの最中に一部を選んでいたら、色・フォント・大きさは
// **その範囲だけ**に入る（`runs`）。全部に当たると、直前に整えた所まで戻る。

import type { TelopStyle, TextRun } from '../lib/telopStyle'
import { saveUserTemplates } from '../lib/telopTemplates'
import { useDoc } from './contentContext'
import { useProjectStateCtx } from './projectStateContext'
import { useSel } from './selectionContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface UseTelopTemplateDeps {
  /** 名前を尋ねる窓を出す */
  askText: (title: string, def: string, onOk: (v: string) => void) => void
  /** いま選んでいるテロップ（無ければ null） */
  selected: any
  /** 打ち直し中に選んでいる文字の範囲 */
  curSel: any
  runColorFromStyle: any
  applyRunRange: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useTelopTemplate(deps: UseTelopTemplateDeps) {
  const { askText, selected, curSel, runColorFromStyle, applyRunRange } = deps
  const { cues, setCues } = useDoc()
  const { userTemplates, setUserTemplates, newTelopStyle, setNewTelopStyle } = useProjectStateCtx()
  const { editingId, selectedIds, setSelectedIds, setEditingId, isSelected } = useSel()

  function saveCurrentAsTemplate(): void {
    const base = selected?.style ?? newTelopStyle
    askText('テンプレート名', 'マイテロップ' + (userTemplates.length + 1), (name) => {
      if (!name) return
      const next = [...userTemplates, { name, style: structuredClone(base) }]
      setUserTemplates(next)
      saveUserTemplates(next)
    })
  }

  function deleteUserTemplate(i: number): void {
    const next = userTemplates.filter((_, k) => k !== i)
    setUserTemplates(next)
    saveUserTemplates(next)
  }

  /**
   * テロップテンプレを適用（選択があればそれに、無ければ次に足すテロップの既定に）。
   * レイアウト(anchor/box)とアニメは維持し、見た目だけ差し替える。
   */
  function applyTemplate(tpl: TelopStyle): void {
    setNewTelopStyle(tpl)
    // 編集中＋文字選択ありなら、プリセットの色/フォント/サイズを「選択文字だけ」に(runs)適用
    const editing = editingId != null ? cues.find((c) => c.id === editingId) : null
    if (editing && isSelected(editing.id)) {
      const { start, end } = curSel()
      if (end > start) {
        // プリセットを選択文字だけに適用＝塗り(グラデ優先)・背景・フォント・サイズを丸ごと反映。
        const patch: Partial<TextRun> = {}
        if (tpl.fill?.gradient && tpl.fill.gradient.stops?.length >= 2) {
          patch.gradient = tpl.fill.gradient
          patch.color = undefined
        } else {
          const col = runColorFromStyle(tpl)
          if (col) patch.color = col
          patch.gradient = undefined
        }
        patch.bgColor = tpl.background?.enabled ? tpl.background.color : undefined
        // 縁・影・結合も選択文字に反映。文字サイズは現状維持（プリセットのfontSizeは持ち込まない）。
        // 縁幅・影寸法はテロップのサイズ比 k で相似スケール（プリセットごとにfontSizeが違うため）。
        const k =
          editing.style.fontSize > 0 && tpl.fontSize > 0 ? editing.style.fontSize / tpl.fontSize : 1
        const r1 = (n: number): number => Math.round(n * 10) / 10
        patch.strokes = (tpl.strokes ?? []).map((st) => ({ ...st, width: r1(st.width * k) }))
        patch.shadows = [
          ...(tpl.shadow && tpl.shadow.enabled ? [tpl.shadow] : []),
          ...(tpl.shadows || [])
        ].map((sd) => ({
          ...sd,
          distance: r1(sd.distance * k),
          blur: r1(sd.blur * k),
          ...(sd.spread != null ? { spread: r1(sd.spread * k) } : {})
        }))
        patch.join = tpl.join
        if (tpl.fontFamily) patch.fontFamily = tpl.fontFamily
        applyRunRange(editing.id, start, end, patch)
        return
      }
    }
    if (selectedIds.length) {
      // 文字未選択で全体にプリセット適用＝部分装飾(runs)を全リセットし「見た目だけ」を載せる
      // （テキスト枠＝サイズ等は現状維持: mergeTemplateKeepFrame）。
      setCues((prev) =>
        prev.map((c) =>
          isSelected(c.id)
            ? { ...c, style: mergeTemplateKeepFrame(c.style, tpl), runs: undefined }
            : c
        )
      )
      // 編集オーバーレイを閉じる（開いたままだとテロップに被さって次のダブルクリックを奪う）。
      setEditingId(null)
    }
  }

  // プリセットを「見た目だけ」適用するマージ。テキスト枠の設定（サイズ・字間・行間・揃え・
  // アンカー・箱・アニメ）は適用前の現在値を維持する（Adobe由来プリセットは1個ずつfontSizeが
  // 違うため、丸ごと適用するとテロップのサイズが毎回変わってしまう）。
  // 縁・影・背景の寸法はサイズ比 k で相似スケールし、プリセットの見た目の均整を保つ。
  function mergeTemplateKeepFrame(cur: TelopStyle, tpl: TelopStyle): TelopStyle {
    const k = cur.fontSize > 0 && tpl.fontSize > 0 ? cur.fontSize / tpl.fontSize : 1
    const r1 = (n: number): number => Math.round(n * 10) / 10
    const scSh = <T extends { distance: number; blur: number; spread?: number }>(sd: T): T => ({
      ...sd,
      distance: r1(sd.distance * k),
      blur: r1(sd.blur * k),
      ...(sd.spread != null ? { spread: r1(sd.spread * k) } : {})
    })
    return {
      ...tpl,
      fontSize: cur.fontSize,
      tracking: cur.tracking,
      leading: cur.leading,
      align: cur.align,
      anchor: cur.anchor,
      box: cur.box,
      anim: cur.anim,
      strokes: (tpl.strokes || []).map((st) => ({ ...st, width: r1(st.width * k) })),
      shadow: tpl.shadow ? scSh(tpl.shadow) : tpl.shadow,
      shadows: tpl.shadows ? tpl.shadows.map(scSh) : tpl.shadows,
      background: tpl.background
        ? {
            ...tpl.background,
            ...(tpl.background.size != null ? { size: r1(tpl.background.size * k) } : {}),
            ...(tpl.background.corner != null ? { corner: r1(tpl.background.corner * k) } : {})
          }
        : tpl.background
    }
  }

  // テンプレをテロップにドロップして適用。落とした先が選択中の一部なら選択全部に反映。
  function applyTemplateToCue(cueId: number, tpl: TelopStyle): void {
    setNewTelopStyle(tpl)
    const targets = selectedIds.includes(cueId) && selectedIds.length ? selectedIds : [cueId]
    setCues((prev) =>
      prev.map((c) =>
        targets.includes(c.id)
          ? { ...c, style: mergeTemplateKeepFrame(c.style, tpl), runs: undefined }
          : c
      )
    )
    // **落とした先を選んでおく。** 落としたということは、次に触るのはその文字。
    // 選ばれていないと右パネルが別の物を出したままで、微調整に入るのに
    // もう一度クリックが要る（このアプリは「クリックが多い」と言われている）。
    setSelectedIds(targets)
    setEditingId(null)
  }

  return { saveCurrentAsTemplate, deleteUserTemplate, applyTemplate, applyTemplateToCue }
}
