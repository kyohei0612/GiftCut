// タイムラインの物を右クリックしたときの品書き——**編集の操作**。
//
// テロップ用と、それ以外（動画切片・SE/BGM・画像）用の2つ。
//
// ## 中身は「押した1つ」に対して出す
//
// 開く前に押した物だけを選び直してある（`timeline/ClipBand.tsx` の OpenClipMenu）。
// ここでは選び直しはせず、いま選ばれている物に対して働く。
//
// ## 組（ネスト）の項目は、両方に同じ物を出す
//
// 別々に書くと、片方だけ増えて「テロップからは組めるのに音からは組めない」になる。
// だから `nestEntries` を1つ作って両方から呼ぶ。
//
// ## 押したら必ず閉じる
//
// 閉じ忘れると、次にどこかを押したとき「まだ開いている品書き」に取られる。
import type { JSX } from 'react'
import { ContextMenu, type MenuEntries } from '../ContextMenu'
import { LABEL_COLORS } from '../../lib/labels'
import { formatCombo } from '../../../../shared/shortcuts'
import { useMenus } from '../../state/menusContext'
import { useDoc } from '../../state/contentContext'
import { useSel } from '../../state/selectionContext'
import { useNest } from '../../state/useNest'

export function ClipMenus(): JSX.Element {
  // **受け取らず、心臓から自分で見に行く**（区画と同じ流儀）
  const {
    menu, setMenu, clipMenu, setClipMenu, clampMenu, setLabelFor, selectByLabel, setClipLabel,
    deleteSelected, rippleDeleteSelected, deleteSelectedSE, deleteSelectedImg,
    deleteSelectedVClip, deleteVideoSegmentsLeavingGap, rippleDeleteVideoSegments,
    duplicateClipsFromMenu, splitVideoAtPlayhead, toggleBlankSelectedVideo, findSilences,
    silenceCut, setDuckOpen, copySelected, copyAttributes, pasteAttributes, copiedAttrs,
    attrSummary, shortcuts
  } = useMenus()
  const { cues, seClips, setSeClips } = useDoc()
  const { isSelected, selectedIds } = useSel()
  // 「組」（ネスト）。**受け取らず自分で見に行く**——品書きに出すのは
  // 「いま組にできるか／解けるか」だけなので、心臓の配線を1本増やす価値が無い
  const { canNest, canUnnest, nest, unnest } = useNest()
  /**
   * 品書きに出す「ネストする」「組を解く」。
   *
   * **テロップの品書きにも、それ以外の品書きにも同じ物を出す。**
   * 別々に書くと、片方だけ増えて「テロップからは組めるのに音からは組めない」になる。
   */
  const nestEntries = (close: () => void): MenuEntries => [
    canNest && {
      kind: 'item',
      label: '🔗 ネストする（組にしてまとめて動かす）',
      onClick: () => {
        nest()
        close()
      }
    },
    canUnnest && {
      kind: 'item',
      label: '⛓️‍💥 組を解く',
      onClick: () => {
        unnest()
        close()
      }
    },
    (canNest || canUnnest) && { kind: 'sep' }
  ]
  return (
    <>
      {/* テロップの右クリック */}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          innerRef={clampMenu}
          entries={[
            {
              kind: 'title',
              label: `ラベルカラー${
                isSelected(menu.cueId) && selectedIds.length > 1 ? `（${selectedIds.length}個）` : ''
              }`
            },
            {
              kind: 'swatches',
              colors: LABEL_COLORS,
              onPick: (color) => {
                setLabelFor(menu.cueId, color)
                setMenu(null)
              }
            },
            { kind: 'sep' },
            {
              kind: 'item',
              label: '同じ色をまとめて選択',
              onClick: () => {
                const c = cues.find((x) => x.id === menu.cueId)
                if (c) selectByLabel(c.label)
                setMenu(null)
              }
            },
            { kind: 'sep' },
            {
              kind: 'item',
              label: '設定をコピー（位置・大きさ・見た目）',
              combo: formatCombo(shortcuts.attrCopy),
              onClick: () => {
                copyAttributes()
                setMenu(null)
              }
            },
            !!copiedAttrs && {
              kind: 'item',
              label: `設定を貼り付け: ${attrSummary(copiedAttrs)}`,
              combo: formatCombo(shortcuts.attrPaste),
              onClick: () => {
                pasteAttributes()
                setMenu(null)
              }
            },
            { kind: 'sep' },
            ...nestEntries(() => setMenu(null)),
            {
              kind: 'item',
              label: 'リップル削除（詰める）',
              onClick: () => {
                rippleDeleteSelected()
                setMenu(null)
              }
            },
            {
              kind: 'item',
              label: '選択を削除',
              danger: true,
              onClick: () => {
                deleteSelected()
                setMenu(null)
              }
            }
          ]}
        />
      )}

      {/* 動画切片 / SE・BGM / 画像 の右クリック（テロップ以外の共通操作） */}
      {clipMenu && (
        <ContextMenu
          x={clipMenu.x}
          y={clipMenu.y}
          innerRef={clampMenu}
          entries={[
            {
              kind: 'title',
              label: `${clipMenu.kind === 'se' ? '🔊' : clipMenu.kind === 'img' ? '🖼' : '🎬'} ${clipMenu.name}`
            },
            // ラベルカラー: どのクリップにも付けられる
            {
              kind: 'swatches',
              colors: LABEL_COLORS,
              onPick: (color) => {
                setClipLabel(clipMenu.kind, clipMenu.id, color)
                setClipMenu(null)
              },
              onNone: () => {
                setClipLabel(clipMenu.kind, clipMenu.id, undefined)
                setClipMenu(null)
              }
            },
            // BGM を敷くなら必須の機能なので、音のクリップの右クリックに直接置く
            clipMenu.kind === 'se' && {
              kind: 'item',
              label: seClips.find((c) => c.id === clipMenu.id)?.duck
                ? '🎚 声に合わせて下げるのをやめる'
                : '🎚 声に合わせて下げる（ダッキング）',
              onClick: () => {
                const on = !seClips.find((c) => c.id === clipMenu.id)?.duck
                setSeClips((prev) =>
                  prev.map((c) => (c.id === clipMenu.id ? { ...c, duck: on } : c))
                )
                setClipMenu(null)
                if (on) {
                  setDuckOpen(true)
                  // 声の位置が分からないと下げようがない。まだ調べていなければ調べる
                  if (!silenceCut.found && !silenceCut.busy) void findSilences()
                }
              }
            },
            clipMenu.kind !== 'seg' && {
              kind: 'item',
              label: 'コピー',
              combo: formatCombo(shortcuts.copy),
              onClick: () => {
                copySelected()
                setClipMenu(null)
              }
            },
            {
              kind: 'item',
              label: '複製',
              combo: formatCombo(shortcuts.duplicate),
              onClick: () => {
                duplicateClipsFromMenu(clipMenu.kind)
                setClipMenu(null)
              }
            },
            clipMenu.kind === 'seg' && {
              kind: 'item',
              label: '再生ヘッドで分割',
              combo: formatCombo(shortcuts.split),
              onClick: () => {
                splitVideoAtPlayhead()
                setClipMenu(null)
              }
            },
            clipMenu.kind === 'seg' && {
              kind: 'item',
              label: '映像だけ消す / 戻す（音と長さは残す）',
              onClick: () => {
                toggleBlankSelectedVideo()
                setClipMenu(null)
              }
            },
            { kind: 'sep' },
            {
              kind: 'item',
              label: '設定をコピー',
              combo: formatCombo(shortcuts.attrCopy),
              onClick: () => {
                copyAttributes()
                setClipMenu(null)
              }
            },
            !!copiedAttrs && {
              kind: 'item',
              label: `設定を貼り付け: ${attrSummary(copiedAttrs)}`,
              combo: formatCombo(shortcuts.attrPaste),
              onClick: () => {
                pasteAttributes()
                setClipMenu(null)
              }
            },
            { kind: 'sep' },
            // 本編の切片（seg）は組に入れない（shared/group.ts の頭）ので、そこには出さない
            ...(clipMenu.kind === 'seg' ? [] : nestEntries(() => setClipMenu(null))),
            // 本編以外は「消して同じトラックの後続を詰める」も選べる
            // （本編の削除は元から詰める動作なので出さない）
            clipMenu.kind !== 'seg' && {
              kind: 'item',
              label: 'リップル削除（このトラックの後続を詰める）',
              combo: formatCombo(shortcuts.rippleDel),
              onClick: () => {
                rippleDeleteSelected()
                setClipMenu(null)
              }
            },
            // 本編は「消すだけ（空きが残る）」と「消して詰める」の2つを出す。
            // どちらになるか分からないまま押すと、後ろのタイミングが崩れて事故になる。
            clipMenu.kind === 'seg' && {
              kind: 'item',
              label: '削除して詰める',
              combo: formatCombo(shortcuts.rippleDel),
              onClick: () => {
                rippleDeleteVideoSegments()
                setClipMenu(null)
              }
            },
            {
              kind: 'item',
              danger: true,
              label: clipMenu.kind === 'seg' ? '削除（詰めない）' : '削除',
              combo: formatCombo(shortcuts.del),
              onClick: () => {
                // **組に入っている物は、種類をまたいで全部消す。**
                // 押した種類だけ消すと、組の片割れが取り残されて
                // 「消したのに音だけ残る」になる（キーの Delete は元から全種類を消す）
                if (canUnnest) {
                  deleteSelected()
                  deleteSelectedSE()
                  deleteSelectedImg()
                  deleteSelectedVClip()
                } else if (clipMenu.kind === 'vclip') deleteSelectedVClip()
                else if (clipMenu.kind === 'seg') deleteVideoSegmentsLeavingGap()
                else if (clipMenu.kind === 'se') deleteSelectedSE()
                else deleteSelectedImg()
                setClipMenu(null)
              }
            }
          ]}
        />
      )}
    </>
  )
}
