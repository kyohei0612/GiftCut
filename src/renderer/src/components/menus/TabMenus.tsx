// タブの右クリックと、はみ出したタブの「≫」——**区画（パネル）の置き場**の話。
//
// ## 切り離す＝窓にする。それだけ
//
// 「画面の中で浮かせる」と「別ウィンドウで開く」を分けていたが、窓なら本体の上にも
// 別モニターにも置けるので、分ける意味が無かった。
//
// ## 「≫」が並び替えの唯一の入口になることがある
//
// 帯の上で掴んで動かす方法は残してあるが、**パネルが狭いと掴むタブ自体が見えない**。
// ここなら幅に関係なく必ず変えられる。
//
// ## 押したら必ず閉じる
//
// 閉じ忘れると、次にどこかを押したとき「まだ開いている品書き」に取られる。
import type { JSX } from 'react'
import { ContextMenu } from '../ContextMenu'
import { TabSortList } from '../TabSortList'
import { useMenus } from '../../state/menusContext'
import type { PaneId } from '../../state/usePanelLayout'

export function TabMenus(): JSX.Element {
  // **受け取らず、心臓から自分で見に行く**（区画と同じ流儀）
  const {
    tabMenu, setTabMenu, tabOverflow, setTabOverflow, clampMenu, PANE_LABEL, TAB_DEFS,
    orderedTabs, pickTab, setTabOrder, isPopped, popPane, unpopPane, monitorTab, rightTab
  } = useMenus()
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
    </>
  )
}
