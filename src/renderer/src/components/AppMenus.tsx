// 右クリックで出る品書き（メニュー）を全部ここに集める。
//
// ## 種類は6つ
//
//   タブ / タブの一覧（≫） / テロップ / テロップ以外のクリップ /
//   テロップカードのフォルダ移動 / 並び順
//
// ## 中身は「押した1つ」に対して出す
//
// 開く前に押した物だけを選び直してある（timeline/ClipBand.tsx の OpenClipMenu）。
// ここでは選び直しはせず、いま選ばれている物に対して働く。
//
// ## 押したら必ず閉じる
//
// 閉じ忘れると、次にどこかを押したとき「まだ開いている品書き」に取られる。
// 各項目の最後で必ず閉じること。

import { useMenus } from '../state/menusContext'
import type { JSX } from 'react'
import { ContextMenu, type MenuEntries } from './ContextMenu'
import { TabSortList } from './PanelChrome'
import { LABEL_COLORS } from '../lib/labels'
import { formatCombo } from '../../../shared/shortcuts'
import type { PaneId } from '../state/usePanelLayout'
import { useDoc } from '../state/contentContext'
import { useSel } from '../state/selectionContext'
import { useNest } from '../state/useNest'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface AppMenusProps {
  /** いま開いている品書き（どれも「開いていなければ null」） */
  menu: any
  setMenu: any
  clipMenu: any
  setClipMenu: any
  tabMenu: any
  setTabMenu: any
  tabOverflow: any
  setTabOverflow: any
  tplMenu: any
  setTplMenu: any
  orgMenu: any
  setOrgMenu: any
  /** 画面の端からはみ出さない位置へ寄せる */
  clampMenu: any
  /** 区画（パネル）まわり */
  PANE_LABEL: Record<string, string>
  TAB_DEFS: any
  orderedTabs: any
  pickTab: any
  setTabOrder: any
  isPopped: (id: any) => boolean
  popPane: any
  unpopPane: any
  monitorTab: string
  rightTab: string
  /** テロップのフォルダ（カテゴリ）まわり */
  allCats: any
  customCats: any
  setTplCat: any
  isFav: any
  toggleFav: any
  /** ラベル色 */
  setLabelFor: any
  selectByLabel: any
  setClipLabel: any
  /** 編集の操作 */
  deleteSelected: any
  rippleDeleteSelected: any
  deleteSelectedSE: any
  deleteSelectedImg: any
  deleteSelectedVClip: any
  deleteVideoSegmentsLeavingGap: any
  rippleDeleteVideoSegments: any
  duplicateClipsFromMenu: any
  splitVideoAtPlayhead: any
  toggleBlankSelectedVideo: any
  findSilences: any
  silenceCut: any
  setDuckOpen: any
  /** コピーと貼り付け */
  copySelected: any
  copyAttributes: any
  pasteAttributes: any
  copiedAttrs: any
  attrSummary: any
  /** キーの割り当て（品書きに出す） */
  shortcuts: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function AppMenus(): JSX.Element {
  // **受け取らず、心臓から自分で見に行く**（区画と同じ流儀）
  const {
    menu, setMenu, clipMenu, setClipMenu, tabMenu, setTabMenu, tabOverflow, setTabOverflow,
    tplMenu, setTplMenu, orgMenu, setOrgMenu, clampMenu, PANE_LABEL, TAB_DEFS, orderedTabs,
    pickTab, setTabOrder, isPopped, popPane, unpopPane, monitorTab, rightTab, allCats,
    customCats, setTplCat, isFav, toggleFav, setLabelFor, selectByLabel, setClipLabel,
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
  {tabMenu &&
    (() => {
      const pane: PaneId = tabMenu.group === 'monitor' ? 'preview' : 'right'
      const toggle = (id: PaneId): void => {
        if (isPopped(id)) unpopPane(id)
        else popPane(id)
        setTabMenu(null)
      }
      return (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          innerRef={clampMenu}
          entries={[
            { kind: 'title', label: PANE_LABEL[pane] },
            // 切り離す＝窓にする。それだけ。「画面の中で浮かせる」と
            // 「別ウィンドウで開く」を分けていたが、窓なら本体の上にも
            // 別モニターにも置けるので、分ける意味が無かった。
            {
              kind: 'item',
              label: isPopped(pane) ? '⇤ 元の場所に戻す' : '⇱ このパネルを切り離す',
              onClick: () => toggle(pane)
            },
            { kind: 'sep' },
            // 他のパネルもここから。左パネルとタイムラインにはタブの
            // 右クリックが無いので、ここが唯一の入口になる。
            ...(['left', 'preview', 'right', 'timeline'] as PaneId[])
              .filter((id) => id !== pane)
              .map(
                (id) =>
                  ({
                    kind: 'item',
                    label: isPopped(id)
                      ? `⇤ ${PANE_LABEL[id]} を戻す`
                      : `⇱ ${PANE_LABEL[id]} を切り離す`,
                    onClick: () => toggle(id)
                  }) as const
              )
          ]}
        />
      )
    })()}

  {/* ≫: 見えていないタブと、並び替え */}
  {tabOverflow && (
    <ContextMenu
      x={tabOverflow.x}
      y={tabOverflow.y}
      innerRef={clampMenu}
      entries={[
        { kind: 'title', label: tabOverflow.hidden.length ? '見えていないタブ' : 'タブを選ぶ' },
        ...orderedTabs(tabOverflow.group, TAB_DEFS[tabOverflow.group] ?? [])
          .filter((t: { id: string }) => !tabOverflow.hidden.length || tabOverflow.hidden.includes(t.id))
          .map(
            (t: { id: string; label: string }) =>
              ({
                kind: 'item',
                label: t.label,
                onClick: () => {
                  pickTab(tabOverflow.group, t.id)
                  setTabOverflow(null)
                }
              }) as const
          ),
        // もう1つのコーナー: 並び替え。帯の上で掴んで動かす方法は残してあるが、
        // パネルが狭いと掴むタブ自体が見えない。ここなら幅に関係なく必ず変えられる。
        { kind: 'sep' },
        { kind: 'title', label: '並び替え' },
        { kind: 'note', label: '長押ししてから上下に動かす' },
        {
          kind: 'node',
          node: (
            <TabSortList
              tabs={orderedTabs(tabOverflow.group, TAB_DEFS[tabOverflow.group] ?? [])}
              active={tabOverflow.group === 'monitor' ? monitorTab : rightTab}
              onReorder={(ids: string[]) =>
                setTabOrder((p: Record<string, string[]>) => ({ ...p, [tabOverflow.group]: ids }))
              }
            />
          )
        }
      ]}
    />
  )}

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
          label: `設定をコピー（位置・大きさ・見た目）（${formatCombo(shortcuts.attrCopy)}）`,
          onClick: () => {
            copyAttributes()
            setMenu(null)
          }
        },
        !!copiedAttrs && {
          kind: 'item',
          label: `設定を貼り付け: ${attrSummary(copiedAttrs)}（${formatCombo(shortcuts.attrPaste)}）`,
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
          label: `コピー（${formatCombo(shortcuts.copy)}）`,
          onClick: () => {
            copySelected()
            setClipMenu(null)
          }
        },
        {
          kind: 'item',
          label: `複製（${formatCombo(shortcuts.duplicate)}）`,
          onClick: () => {
            duplicateClipsFromMenu(clipMenu.kind)
            setClipMenu(null)
          }
        },
        clipMenu.kind === 'seg' && {
          kind: 'item',
          label: `再生ヘッドで分割（${formatCombo(shortcuts.split)}）`,
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
          label: `設定をコピー（${formatCombo(shortcuts.attrCopy)}）`,
          onClick: () => {
            copyAttributes()
            setClipMenu(null)
          }
        },
        !!copiedAttrs && {
          kind: 'item',
          label: `設定を貼り付け: ${attrSummary(copiedAttrs)}（${formatCombo(shortcuts.attrPaste)}）`,
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
          onClick: () => {
            rippleDeleteSelected()
            setClipMenu(null)
          }
        },
        // 本編は「消すだけ（空きが残る）」と「消して詰める」の2つを出す。
        // どちらになるか分からないまま押すと、後ろのタイミングが崩れて事故になる。
        clipMenu.kind === 'seg' && {
          kind: 'item',
          label: `削除して詰める（${formatCombo(shortcuts.rippleDel)}）`,
          onClick: () => {
            rippleDeleteVideoSegments()
            setClipMenu(null)
          }
        },
        {
          kind: 'item',
          danger: true,
          label: `${clipMenu.kind === 'seg' ? '削除（詰めない）' : '削除'}（${formatCombo(shortcuts.del)}）`,
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

  {/* テロップカード: フォルダ（カテゴリ）へ移動 */}
  {tplMenu && (
    <ContextMenu
      x={tplMenu.x}
      y={tplMenu.y}
      innerRef={clampMenu}
      entries={[
        { kind: 'title', label: 'フォルダへ移動' },
        ...allCats.map(
          (c: { key: string; label: string }) =>
            ({
              kind: 'item',
              on: tplMenu.curCat === c.key,
              label: `${tplMenu.curCat === c.key ? '✓ ' : ''}${
                customCats.some((cc: { key: string }) => cc.key === c.key) ? '📁 ' : ''
              }${c.label}`,
              onClick: () => {
                setTplCat(tplMenu.name, c.key)
                setTplMenu(null)
              }
            }) as const
        ),
        { kind: 'sep' },
        {
          kind: 'item',
          label: isFav(tplMenu.name) ? '★ お気に入り解除' : '☆ お気に入りに追加',
          onClick: () => {
            toggleFav(tplMenu.name)
            setTplMenu(null)
          }
        }
      ]}
    />
  )}

  {/* SE/アイコン: フォルダ移動＋お気に入り（テロップと同じ見た目） */}
  {orgMenu && (
    <ContextMenu
      x={orgMenu.x}
      y={orgMenu.y}
      innerRef={clampMenu}
      entries={[
        { kind: 'title', label: 'フォルダへ移動' },
        ...orgMenu.options.map(
          (o: { label: string; checked?: boolean; act: () => void }) =>
            ({
              kind: 'item',
              on: o.checked,
              label: o.label,
              onClick: () => {
                o.act()
                setOrgMenu(null)
              }
            }) as const
        )
      ]}
    />
  )}
    </>
  )
}
