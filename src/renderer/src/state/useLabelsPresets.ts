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
import { DEFAULT_LABEL, LABEL_COLORS } from '../lib/labels'
// **保存は「その1件の操作」だけ**（画面の一覧を丸ごと書かない。理由は lib 側の説明）
import { persistUserTemplateAdd } from '../lib/telopTemplates'
import type { AnimIn } from '../lib/telopStyle'
// 「どれに付けるか」の判定は shared/labelTargets に1つだけ（2本の道が食い違っていた）
import { labelTargetCount, labelTargets, type LabelKind } from '../../../shared/labelTargets'
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
  const {
    cues, setCues, segments, setSegments, seClips, setSeClips, imgClips, setImgClips, vClips, setVClips
  } = useDoc()
  const {
    selectedIds, setSelectedIds, clearSegSel, setSelectedVideoIds, setSelectedSeIds,
    setSelectedImgIds, setSelectedVClipIds,
    selectedVideoIds, selectedAudioIds, selectedSeIds, selectedImgIds, selectedVClipIds
  } = useSel()
  const { newTelopStyle, userTemplates, setUserTemplates } = useProjectStateCtx()

  /**
   * 使われている色だけ、件数付きで並べる（使っていない色は出さない）。
   * **件数は全種類で数える**——押すと全種類を選ぶ（selectByLabel）ので、テロップだけ
   * 数えると「3」と出て7個選ばれる／本編だけに付けた色が一覧に出ない
   */
  const labelGroups = LABEL_COLORS.map((l) => ({
    ...l,
    count: [cues, segments, seClips, imgClips, vClips].reduce(
      (n, xs: readonly { label?: string }[]) => n + xs.filter((c) => c.label === l.color).length,
      0
    )
  })).filter((g) => g.count > 0)

  /** いま選んでいる物を、色付けの判定（shared/labelTargets）が読む形に */
  const labelSel = () => ({
    telop: selectedIds,
    // 本編は映像側と音声側で選択が別々。どちらで選んでいても同じ切片に付ける
    seg: [...new Set([...selectedVideoIds, ...selectedAudioIds])],
    se: selectedSeIds,
    img: selectedImgIds,
    vclip: selectedVClipIds
  })

  /**
   * 色を付ける。**どの種類にも付けられる**（本編・効果音・画像・映像レイヤー。
   * 素材が増えると見分けが付かなくなるので、色で分類できるようにしてある）。
   *
   * **選んでいる物を右クリックしたなら、選んでいる全部・全種類に効かせる。**
   * 押した1つだけに効くと、まとめて色分けするのに1つずつ触ることになる。
   * 2026-11-08 まではテロップとそれ以外で道が2本に分かれていて、種類をまたいで
   * 選ぶと右クリックした種類しか変わらなかった。判定は shared/labelTargets に1つ。
   *
   * `color` が undefined なら「色なし」。テロップの色は必須なので既定色に戻す。
   */
  function setLabelFor(kind: LabelKind, id: number, color: string | undefined): void {
    const t = labelTargets(labelSel(), kind, id)
    const paint = <C extends { id: number; label?: string }>(ids: number[]) =>
      (prev: C[]): C[] => (ids.length ? prev.map((c) => (ids.includes(c.id) ? { ...c, label: color } : c)) : prev)
    if (t.telop.length)
      setCues((prev) =>
        prev.map((c) => (t.telop.includes(c.id) ? { ...c, label: color ?? DEFAULT_LABEL } : c))
      )
    setSegments(paint(t.seg))
    setSeClips(paint(t.se))
    setImgClips(paint(t.img))
    setVClips(paint(t.vclip))
  }

  /** 色を付けたら何個に効くか（品書きの見出し「（N個）」用） */
  function labelCountFor(kind: LabelKind, id: number): number {
    return labelTargetCount(labelTargets(labelSel(), kind, id))
  }

  /**
   * その色の物を**全種類**選ぶ（テロップ・本編・効果音・画像・映像レイヤー）。
   *
   * 2026-11-11 まではテロップしか選ばず、本編は選び直しで解いていた。色は全種類に
   * 付けられるのに（setLabelFor）、選ぶ側だけテロップ限定だったので、
   * 「見せ場の本編を色で分ける → まとめて選ぶ → 先頭に並べる（useDigestToHead）」が
   * 途中で止まっていた。種類をまたいだ選択は範囲選択・Ctrl+A でも普通に起きる。
   */
  function selectByLabel(color: string): void {
    const ids = <C extends { id: number; label?: string }>(xs: readonly C[]) =>
      xs.filter((c) => c.label === color).map((c) => c.id)
    clearSegSel()
    setSelectedIds(ids(cues))
    // 本編は映像側で選ぶ（右クリックで開く品書きと同じ。state/useAppWiring の openClipMenu）
    setSelectedVideoIds(ids(segments))
    setSelectedSeIds(ids(seClips))
    setSelectedImgIds(ids(imgClips))
    setSelectedVClipIds(ids(vClips))
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
    const t = { name: n, style: structuredClone(base) }
    setUserTemplates([...userTemplates, t])
    // **画面の一覧を丸ごと保存しない**（プロジェクト由来が混ざっているため）。
    // ここは `useTelopTemplate.saveCurrentAsTemplate` と**同じことをする2つ目の道**
    // ——片方だけ直すと、こちらから足したときだけ焼き付く
    persistUserTemplateAdd(t)
  }

  return { labelGroups, setLabelFor, labelCountFor, selectByLabel, savePreset }
}
