// タイムラインの物を右クリックしたときの品書き——**編集の操作**。
//
// ## 中身は1つの作り方から出す（2026-11-12）
//
// 前は「テロップ用」と「それ以外（本編・効果音・画像・映像レイヤー）用」を別々に
// 書いていた。片方だけ増えるので食い違っていた——テロップ側にはコピー・複製が無い／
// キーの表示が無い／「同じ色をまとめて選択」はテロップ側だけ／削除は押した種類だけ。
// 本人「映像のタイムライン右クリの挙動とテロップ右クリの挙動が別」。
// → `entriesFor(種類, 番号, 名前, 閉じ方)` の1つにして、**同じ項目は同じ場所・同じ動き**。
// 種類で違うのは、その種類にしか意味が無い項目（ダッキング・分割・先頭に並べる…）だけ。
//
// 開いている品書きの状態は今まで通り2つ（`menu`＝テロップ／`clipMenu`＝それ以外）。
// 開く所が別（state/useTelopDrag と useAppWiring の openClipMenu）なので、そこは触らない。
//
// ## 効く相手は「選んでいる全部」
//
// 開く前に、選んでいない物を押したらそれだけを選び直してある。ここでは選び直さず、
// いま選ばれている物に対して働く。**消す・消して詰める・複製はキー操作と同じ物**
//（state/useSelectionEdit の deleteSelection / rippleDeleteSelection / duplicateSelection）。
//
// ## 押したら必ず閉じる
//
// 閉じ忘れると、次にどこかを押したとき「まだ開いている品書き」に取られる。
// `entriesFor` の中では `run(やること)` を通す——やってから閉じる、を1か所に置く。
import type { JSX } from 'react'
import { ContextMenu, type MenuEntries } from '../ContextMenu'
import { LABEL_COLORS } from '../../lib/labels'
import { formatCombo } from '../../../../shared/shortcuts'
import type { LabelKind } from '../../../../shared/labelTargets'
import { useMenus } from '../../state/menusContext'
import { useDoc } from '../../state/contentContext'
import { useNest } from '../../state/useNest'
import { useDigestToHead } from '../../state/useDigestToHead'

const ICON: Record<LabelKind, string> = { telop: '🔤', seg: '🎬', se: '🔊', img: '🖼', vclip: '🎬' }

export function ClipMenus(): JSX.Element {
  // **受け取らず、心臓から自分で見に行く**（区画と同じ流儀）
  const {
    menu, setMenu, clipMenu, setClipMenu, clampMenu, setLabelFor, labelCountFor, selectByLabel,
    deleteSelection, rippleDeleteSelection, duplicateSelection,
    splitVideoAtPlayhead, toggleBlankSelectedVideo, findSilences,
    silenceCut, setDuckOpen, copySelected, copyAttributes, pasteAttributes, copiedAttrs,
    attrSummary, shortcuts
  } = useMenus()
  const { cues, segments, seClips, setSeClips, imgClips, vClips } = useDoc()
  // 「組」（ネスト）と、本編の写しを先頭に並べる（ダイジェスト）。**受け取らず自分で見に行く**——
  // 品書きに出すだけなので、心臓の配線を1本増やす価値が無い
  const { canNest, canUnnest, nest, unnest } = useNest()
  const { canCopyToHead, copyToHead } = useDigestToHead()

  /** その種類の一覧（色を引くのに使う） */
  const listOf = (kind: LabelKind): readonly { id: number; label?: string }[] =>
    ({ telop: cues, seg: segments, se: seClips, img: imgClips, vclip: vClips })[kind]

  /**
   * 品書きの中身。**テロップも、それ以外も、ここ1つから出す。**
   * @param close 閉じ方（テロップは setMenu(null)、それ以外は setClipMenu(null)）
   */
  const entriesFor = (kind: LabelKind, id: number, name: string, close: () => void): MenuEntries => {
    const run = (act: () => void) => (): void => {
      act()
      close()
    }
    const n = labelCountFor(kind, id)
    const label = listOf(kind).find((c) => c.id === id)?.label
    const se = kind === 'se' ? seClips.find((c) => c.id === id) : undefined
    return [
      // 何個に効くかは**全種類**で数える（別の種類も選んでいれば一緒に変わる）
      { kind: 'title', label: `${ICON[kind]} ${name}${n > 1 ? `（${n}個）` : ''}` },
      // ラベルカラー。どの種類にも付けられる。テロップは色が必須なので「色なし」は出さない
      {
        kind: 'swatches',
        colors: LABEL_COLORS,
        onPick: (color) => run(() => setLabelFor(kind, id, color))(),
        ...(kind === 'telop' ? {} : { onNone: run(() => setLabelFor(kind, id, undefined)) })
      },
      // 全種類を選ぶ（state/useLabelsPresets の selectByLabel）。
      // 「本編を色で分ける → まとめて選ぶ → 先頭に並べる」の2手目
      !!label && { kind: 'item', label: '同じ色をまとめて選択', onClick: run(() => selectByLabel(label)) },
      { kind: 'sep' },
      // BGM を敷くなら必須の機能なので、音のクリップの右クリックに直接置く
      !!se && {
        kind: 'item',
        label: se.duck ? '🎚 声に合わせて下げるのをやめる' : '🎚 声に合わせて下げる（ダッキング）',
        onClick: run(() => {
          const on = !se.duck
          setSeClips((prev) => prev.map((c) => (c.id === id ? { ...c, duck: on } : c)))
          if (on) {
            setDuckOpen(true)
            // 声の位置が分からないと下げようがない。まだ調べていなければ調べる
            if (!silenceCut.found && !silenceCut.busy) void findSilences()
          }
        })
      },
      // 本編の切片はコピーできない（貼る先が決まらない。写したいときは複製か、先頭に並べる）
      kind !== 'seg' && {
        kind: 'item',
        label: 'コピー',
        combo: formatCombo(shortcuts.copy),
        onClick: run(copySelected)
      },
      { kind: 'item', label: '複製', combo: formatCombo(shortcuts.duplicate), onClick: run(duplicateSelection) },
      // 選んだ本編の写しを 0秒に近い順に先頭へ詰めて並べる（冒頭のダイジェスト用）。
      // 載っているテロップ・効果音・画像も一緒に写る。決まりは shared/digest の頭
      kind === 'seg' && canCopyToHead && {
        kind: 'item',
        label: '⏮ コピーを先頭に並べる（ダイジェスト）',
        onClick: run(copyToHead)
      },
      kind === 'seg' && {
        kind: 'item',
        label: '再生ヘッドで分割',
        combo: formatCombo(shortcuts.split),
        onClick: run(splitVideoAtPlayhead)
      },
      kind === 'seg' && {
        kind: 'item',
        label: '映像だけ消す / 戻す（音と長さは残す）',
        onClick: run(toggleBlankSelectedVideo)
      },
      { kind: 'sep' },
      {
        kind: 'item',
        label: kind === 'telop' ? '設定をコピー（位置・大きさ・見た目）' : '設定をコピー',
        combo: formatCombo(shortcuts.attrCopy),
        onClick: run(copyAttributes)
      },
      !!copiedAttrs && {
        kind: 'item',
        label: `設定を貼り付け: ${attrSummary(copiedAttrs)}`,
        combo: formatCombo(shortcuts.attrPaste),
        onClick: run(pasteAttributes)
      },
      { kind: 'sep' },
      // 本編の切片（seg）は組に入れない（shared/group.ts の頭）ので、そこには出さない
      kind !== 'seg' && canNest && {
        kind: 'item',
        label: '🔗 ネストする（組にしてまとめて動かす）',
        onClick: run(nest)
      },
      kind !== 'seg' && canUnnest && { kind: 'item', label: '⛓️‍💥 組を解く', onClick: run(unnest) },
      kind !== 'seg' && (canNest || canUnnest) && { kind: 'sep' },
      // 「消して詰める」と「消すだけ」を必ず並べる。どちらになるか分からないまま押すと、
      // 後ろのタイミングが崩れて事故になる。本編は全部の段が詰まり、それ以外は同じ段の後ろだけ
      {
        kind: 'item',
        label: kind === 'seg' ? '削除して詰める' : '削除して詰める（同じ段の後ろ）',
        combo: formatCombo(shortcuts.rippleDel),
        onClick: run(rippleDeleteSelection)
      },
      {
        kind: 'item',
        danger: true,
        label: kind === 'seg' ? '削除（空きが残る）' : '削除',
        combo: formatCombo(shortcuts.del),
        onClick: run(deleteSelection)
      }
    ]
  }

  const telopText = menu ? (cues.find((c) => c.id === menu.cueId)?.text ?? '') : ''
  return (
    <>
      {/* テロップの右クリック */}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          innerRef={clampMenu}
          entries={entriesFor(
            'telop',
            menu.cueId,
            // 見出しは本文の頭だけ（長い本文で品書きが横に伸びない）
            telopText.replace(/\s+/g, ' ').slice(0, 14) || 'テロップ',
            () => setMenu(null)
          )}
        />
      )}
      {/* 本編の切片 / 効果音・BGM / 画像 / 映像レイヤーの右クリック */}
      {clipMenu && (
        <ContextMenu
          x={clipMenu.x}
          y={clipMenu.y}
          innerRef={clampMenu}
          entries={entriesFor(clipMenu.kind, clipMenu.id, clipMenu.name, () => setClipMenu(null))}
        />
      )}
    </>
  )
}
