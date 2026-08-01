// テロップの「色ラベル」と「見本（テンプレ）の保存」。
//
// ## なぜ同じ場所に居るか
//
// どちらも**テロップを束ねて扱う**話。色を付けて仲間にする／その見た目を
// 名前を付けて取っておく。片方だけ別の場所にあると、束ね方の決まり
// （選んでいる物へ効かせるのか、押した1つだけか）が食い違う。
//
// ## 出入りアニメの一覧もここ
//
// 帯に出す名前と、右パネルで選ばせる並びが同じ物を指す。2か所に書くと
// 「帯には出るのに選べない」種類ができる。
import { LABEL_COLORS } from '../lib/labels'
import { saveUserTemplates } from '../lib/telopTemplates'
import type { AnimIn } from '../lib/telopStyle'
import { useDoc } from './contentContext'
import { useSel } from './selectionContext'
import { useProjectStateCtx } from './projectStateContext'

/** 選べる出入りアニメ（頭=in / 尻=out に付く）。強調は範囲を持たないので別扱い */
export const TELOP_MOTIONS: { type: AnimIn; ico: string; label: string }[] = [
  { type: 'fade', ico: '🌫', label: 'フェード' },
  { type: 'pop', ico: '✨', label: 'ポップ' },
  { type: 'slideL', ico: '⬅', label: 'スライド左' },
  { type: 'slideR', ico: '➡', label: 'スライド右' },
  { type: 'slideU', ico: '⬆', label: 'スライド上' },
  { type: 'slideD', ico: '⬇', label: 'スライド下' }
]

export const motionLabel = (t: AnimIn): string =>
  TELOP_MOTIONS.find((m) => m.type === t)?.label ?? String(t)

export function useLabelsPresets() {
  const { cues, setCues } = useDoc()
  const { selectedIds, setSelectedIds, isSelected, clearSegSel } = useSel()
  const { newTelopStyle, userTemplates, setUserTemplates } = useProjectStateCtx()

  /** 使われている色だけ、件数付きで並べる（使っていない色は出さない） */
  const labelGroups = LABEL_COLORS.map((l) => ({
    ...l,
    count: cues.filter((c) => c.label === l.color).length
  })).filter((g) => g.count > 0)

  /**
   * 色を付ける。**選んでいる物があれば、そちら全部に効かせる。**
   * 押した1つだけに効くと、まとめて色分けするのに1つずつ触ることになる。
   */
  function setLabelFor(cueId: number, color: string): void {
    const targets = isSelected(cueId) ? selectedIds : [cueId]
    setCues((prev) => prev.map((c) => (targets.includes(c.id) ? { ...c, label: color } : c)))
  }

  /** その色の物を全部選ぶ。切片の選択は解く（別の種類が混ざると操作が効かない） */
  function selectByLabel(color: string): void {
    clearSegSel()
    setSelectedIds(cues.filter((c) => c.label === color).map((c) => c.id))
  }

  /**
   * いまの見た目を名前を付けて取っておく。
   * 選んでいるテロップがあればその見た目、無ければ「次に足す物」の見た目。
   */
  function savePreset(name: string): void {
    const n = name.trim()
    if (!n) return
    const selected = cues.find((c) => c.id === selectedIds[0]) ?? null
    const base = selected?.style ?? newTelopStyle
    const next = [...userTemplates, { name: n, style: structuredClone(base) }]
    setUserTemplates(next)
    saveUserTemplates(next)
  }

  return { labelGroups, setLabelFor, selectByLabel, savePreset }
}
