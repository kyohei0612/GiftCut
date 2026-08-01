// テロップの見た目を変える。**「全部に効かせる」か「選んだ文字だけ」か**の振り分けが本体。
//
// ## 選んだ文字だけに効かせる（runs）
//
// 文字を打ち替えている最中にエディタで一部を選んでいるときは、色・塗り・背景・縁・影・
// フォント・大きさをその範囲だけに付ける（`runs`）。位置揃えのような**形の話は
// 範囲では持てない**ので、選んでいても全体に効かせる。
//
// 付け方は「重ねる」。文字ごとの実効スタイルへ一度ばらしてから範囲に上書きし、
// 続きが同じ物を1つにまとめ直す。**上書きではなく重ねる**ので、
// 色→グラデ→背景…と別々に付けても前のが消えない。
//
// ## 選択範囲は2か所から読む
//
// textarea の生の選択が畳まれていない（何か選んでいる）ならそれを使い、
// 畳まれていたら**最後に覚えた範囲**（`editorSel`）を使う。
// 左のパネルを押した瞬間に textarea から焦点が外れて選択が畳まれるので、
// 生の選択だけを見ていると「選んで、パネルで色を選ぶ」が成立しない。
//
// 覚えた範囲は、打ち替える相手が変わったら捨てる。
// 残っていると、別のテロップで何も選んでいないのに一部だけに色が付く。

import { useEffect, useRef, useState } from 'react'
import { adjustRuns, runAtIndex, splitRunRemoving, styleWithRun } from '../lib/textRuns'
import type { TelopStyle, TextRun } from '../lib/telopStyle'
import type { Cue } from '../lib/srt'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useProjectStateCtx } from './projectStateContext'

export interface TelopLook {
  updateSelectedText: (text: string) => void
  /** いま左のパネルに出すべき見た目（選んだ文字があればその実効値） */
  panelStyleFor: (cue: Cue | null | undefined) => TelopStyle
  updateSelectedStyle: (style: TelopStyle) => void
  applyRunRange: (cueId: number, start: number, end: number, patch: Partial<TextRun>) => void
  clearRunsInSelection: (cueId: number) => void
  /** 打ち替え中のテロップの、いまの選択範囲 */
  curSel: () => { start: number; end: number }
  /** 打ち替え用の textarea。生の選択を読むために要る */
  editorTextRef: React.MutableRefObject<HTMLTextAreaElement | null>
  setEditorSel: React.Dispatch<React.SetStateAction<{ start: number; end: number }>>
}

export function useTelopLook(): TelopLook {
  const { cues, setCues } = useDoc()
  const { selectedIds, isSelected, editingId } = useSel()
  const { newTelopStyle } = useProjectStateCtx()
  /** 選んでいるうちの1つめ。文字の打ち替えは常にこれが相手 */
  const primaryId = selectedIds[0] ?? null

  function updateSelectedText(text: string): void {
    if (primaryId == null) return
    setCues((prev) =>
      prev.map((c) => (c.id === primaryId ? { ...c, text, runs: adjustRuns(c.runs, c.text, text) } : c))
    )
  }
  // 現在の選択文字に対応する実効スタイル（編集中＋選択ありのみ。それ以外はテロップ全体）。
  // 選択はライブ(textarea)優先→なければ editorSel。curSel と同じ基準で routing と表示を一致させる。
  function panelStyleFor(cue: Cue | null | undefined): TelopStyle {
    if (!cue) return newTelopStyle
    if (editingId === cue.id) {
      const ta = editorTextRef.current
      const sel =
        ta && ta.selectionEnd > ta.selectionStart
          ? { start: ta.selectionStart, end: ta.selectionEnd }
          : editorSel
      if (sel.end > sel.start) return styleWithRun(cue.style, runAtIndex(cue.runs, sel.start))
    }
    return cue.style
  }
  function updateSelectedStyle(style: TelopStyle): void {
    if (!selectedIds.length) return
    // 編集中＋エディタで文字選択がある時は、塗り(単色/グラデ)・背景・縁・影・結合・フォント・サイズの
    // 変更を「選択文字だけ」に(runs)適用。位置揃え等の構造系は従来どおり全体に適用。
    // 全体の影リスト（primary + shadows[]）を1配列に。
    const shListOf = (st: TelopStyle): TextRun['shadows'] => [
      ...(st.shadow && st.shadow.enabled ? [st.shadow] : []),
      ...(st.shadows || [])
    ]
    const editing = editingId != null ? cues.find((c) => c.id === editingId) : null
    if (editing && isSelected(editing.id)) {
      const { start, end } = curSel()
      if (end > start) {
        // 比較基準＝「選択文字の実効スタイル」（全体ではなく選択の現在値から差分を取る）。
        // パネルは1操作で複数プロパティを同時変更する（例: サイズ変更→縁/影も相似スケール）ため、
        // 「最初の差分1つ」ではなく“変わった全項目”を1パッチにまとめて run に適用する。
        const cur = styleWithRun(editing.style, runAtIndex(editing.runs, start))
        const patch: Partial<TextRun> = {}
        let changed = false
        // 塗り（グラデ優先。単色↔グラデは相互にクリア）
        if (JSON.stringify(style.fill?.gradient) !== JSON.stringify(cur.fill?.gradient)) {
          patch.gradient = style.fill?.gradient
          patch.color = undefined
          changed = true
        } else if (style.fill?.color && style.fill.color !== cur.fill?.color) {
          patch.color = style.fill.color
          patch.gradient = undefined
          changed = true
        }
        // 背景ハイライト
        const curBg = cur.background?.enabled ? cur.background.color : undefined
        const nextBg = style.background?.enabled ? style.background.color : undefined
        if (curBg !== nextBg) {
          patch.bgColor = nextBg
          changed = true
        }
        // 縁（選択文字だけ置換）
        if (JSON.stringify(style.strokes) !== JSON.stringify(cur.strokes)) {
          patch.strokes = style.strokes
          changed = true
        }
        // 影（primary+配列を1リストに）
        if (JSON.stringify(shListOf(style)) !== JSON.stringify(shListOf(cur))) {
          patch.shadows = shListOf(style)
          changed = true
        }
        // 角の結合
        if ((style.join ?? 'miter') !== (cur.join ?? 'miter')) {
          patch.join = style.join
          changed = true
        }
        if (style.fontFamily && style.fontFamily !== cur.fontFamily) {
          patch.fontFamily = style.fontFamily
          changed = true
        }
        // サイズ倍率は base(テロップ全体) 基準で算出（cur は既に倍率適用済みのため分母に使わない）
        if (style.fontSize && editing.style.fontSize && style.fontSize !== cur.fontSize) {
          patch.sizeScale = style.fontSize / editing.style.fontSize
          changed = true
        }
        if (changed) {
          applyRunRange(editing.id, start, end, patch)
          return
        }
        // フォールスルー（構造系: 行間/字間/揃え/太字/背景サイズ等の変更）。
        // パネルの style は「選択文字の実効値」ベースなので、そのまま全体に書くと選択文字の
        // 塗り/縁/影/フォント/サイズがテロップ全体に化ける。→ run管理プロパティは各テロップ自身の値へ戻す。
        setCues((prev) =>
          prev.map((c) =>
            isSelected(c.id)
              ? {
                  ...c,
                  style: {
                    ...style,
                    fontSize: c.style.fontSize,
                    fontFamily: c.style.fontFamily,
                    join: c.style.join,
                    strokes: c.style.strokes,
                    shadow: c.style.shadow,
                    shadows: c.style.shadows,
                    fill: {
                      ...style.fill,
                      color: c.style.fill.color,
                      gradient: c.style.fill.gradient,
                      gradStash: c.style.fill.gradStash
                    },
                    background: {
                      ...style.background,
                      enabled: c.style.background.enabled,
                      color: c.style.background.color
                    }
                  }
                }
              : c
          )
        )
        return
      }
    }
    setCues((prev) => prev.map((c) => (isSelected(c.id) ? { ...c, style } : c)))
  }
  // ---- 部分装飾（runs）: 編集エディタの選択範囲にスタイルを適用 ----
  // 適用時に textarea の live 選択を直接読む（状態のタイミング問題を回避）。
  const editorTextRef = useRef<HTMLTextAreaElement | null>(null)
  const [editorSel, setEditorSel] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  // 編集対象が変わったら選択記録をリセット（前のテロップの選択範囲が残り、
  // 別テロップで文字未選択のままパネルを触った時に誤って部分適用されるのを防ぐ）
  useEffect(() => {
    setEditorSel({ start: 0, end: 0 })
  }, [editingId])
  // 現在の選択。textareaのlive選択が有効(非collapse)ならそれ、畳まれていたら直近記録(editorSel)へ。
  // 左パネルのFillPicker等をクリックしてtextareaがblur/collapseしても選択文字を失わないため。
  const curSel = (): { start: number; end: number } => {
    const ta = editorTextRef.current
    if (ta && ta.selectionEnd > ta.selectionStart) return { start: ta.selectionStart, end: ta.selectionEnd }
    return editorSel
  }
  // 文字範囲 [start,end) に部分装飾 patch を「マージ」適用。
  // 文字ごとの実効スタイルへ平坦化→範囲にpatchを重ね→連続同一を1runに再結合。
  // これで色→グラデ→背景…と別プロパティを重ねても前の装飾が消えない（patchのundefined値はその項目をクリア）。
  function applyRunRange(cueId: number, start: number, end: number, patch: Partial<TextRun>): void {
    if (end <= start) return
    setCues((prev) =>
      prev.map((c) => {
        if (c.id !== cueId) return c
        const n = c.text.length
        const s = Math.max(0, start)
        const e = Math.min(n, end)
        if (e <= s) return c
        // 各文字の実効スタイル（後勝ち＝runAt相当）
        const styleAt: (Partial<TextRun> | null)[] = new Array(n).fill(null)
        for (const r of c.runs ?? []) {
          const { start: _rs, end: _re, ...rest } = r
          void _rs
          void _re
          for (let i = Math.max(0, r.start); i < Math.min(n, r.end); i++)
            styleAt[i] = { ...(styleAt[i] || {}), ...rest }
        }
        for (let i = s; i < e; i++) styleAt[i] = { ...(styleAt[i] || {}), ...patch }
        // 連続同一を1runに再結合（全項目nullは装飾なしとして落とす）
        const runs: TextRun[] = []
        let lastKey = ''
        for (let i = 0; i < n; i++) {
          const st = styleAt[i]
          const active = st && Object.values(st).some((v) => v != null)
          if (!active) {
            lastKey = ''
            continue
          }
          const key = JSON.stringify(st)
          if (key === lastKey) runs[runs.length - 1].end = i + 1
          else {
            runs.push({ start: i, end: i + 1, ...(st as Partial<TextRun>) })
            lastKey = key
          }
        }
        return { ...c, runs: runs.length ? runs : undefined }
      })
    )
  }
  function clearRunsInSelection(cueId: number): void {
    const { start, end } = curSel()
    if (end <= start) return
    setCues((prev) =>
      prev.map((c) => {
        if (c.id !== cueId) return c
        const runs = (c.runs ?? []).flatMap((r) => splitRunRemoving(r, start, end))
        return { ...c, runs: runs.length ? runs : undefined }
      })
    )
  }

  return {
    updateSelectedText,
    panelStyleFor,
    updateSelectedStyle,
    applyRunRange,
    clearRunsInSelection,
    curSel,
    editorTextRef,
    setEditorSel
  }
}
