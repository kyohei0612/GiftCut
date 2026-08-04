// 右パネルの区画。**タブの枠だけ**を持つ。
//
// ## 見た目は各タブ、配線は各タブのフック
//
//   見た目  components/panels/*Tab.tsx
//   配線    state/use*Tab.ts       ← **そのタブに何が要るかの一覧はここ**
//
// ここが見るのは「どのタブを出すか」と「タブ帯」だけ。
//
// ## 前はここが配線も抱えていた（2026-08-04 に出した。410 → 130行）
//
// 心臓から81個を取り出し、名前を付け替え、**タブごとの糊まで JSX の中に書いて**
// 5つへ配っていた。アイコンタブだけで52行のうち35行が
// 「選んでいるテロップに付ける」「右クリックの品書き」の中身だった。
//
// 困るのは行数ではなく、**「そのタブに何が要るか」がどこにも書いていない**こと。
// 81個の束から拾う所と、糊と、JSX が同じ場所で混ざっていた。
//
// ※ **タブのフックは必ず上で呼ぶ**（下の `use*Tab()` の並び）。
//   出すタブの中で呼ぶと、タブを切り替えるたびにフックの数が変わる。

import type { JSX } from 'react'
import { PaneHost } from '../PaneWindow'
import { PanelTabs } from '../PanelTabs'
import { ProjectBinTab } from './ProjectBinTab'
import { TelopTemplatesTab } from './TelopTemplatesTab'
import { IconLibraryTab } from './IconLibraryTab'
import { SeLibraryTab } from './SeLibraryTab'
import { TransitionsTab } from './TransitionsTab'
import { useLayout } from '../../state/layoutContext'
import { PANE_LABEL } from '../../state/usePanelLayout'
import { useRightPanel } from '../../state/rightPanelContext'
// タブごとの配線。**何が要るかの一覧は、それぞれのフックの返り値**
import { useIconTab } from '../../state/useIconTab'
import { useTelopTab } from '../../state/useTelopTab'
import { useSeTab } from '../../state/useSeTab'
import { useTransitionsTab } from '../../state/useTransitionsTab'
import { useProjectBinTab } from '../../state/useProjectBinTab'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface RightPanelAreaProps {
  [k: string]: any
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function RightPanelArea(): JSX.Element {
  // **受け取らず、心臓から自分で見に行く**（他の区画と同じ流儀）
  // タブ帯に要る物だけ（**中身の物は1つも受け取らない**）
  const {
    orderedTabs, TAB_DEFS, pickTab, setTabOrder, setTabMenu, setTabOverflow, rightTab
  } = useRightPanel()
  const { isPopped, paneGeom, unpopPane, rightW } = useLayout()
  // **タブごとの配線は state/use*Tab に1つずつ。** 何が要るかの一覧はそれぞれの返り値。
  // **必ずここで呼ぶ。** 出すタブの中で呼ぶと、タブを切り替えるたびに
  // フックの数が変わって React の規則を破る（一度そう書いて気づいた）
  const projectBinTab = useProjectBinTab()
  const telopTab = useTelopTab()
  const iconTab = useIconTab()
  const seTab = useSeTab()
  const transitionsTab = useTransitionsTab()
  return (
      <PaneHost id="right" title={PANE_LABEL.right} popped={isPopped('right')}
        geom={paneGeom.right} onClose={() => unpopPane('right')}>
      {/* --- 右: プロジェクト --- */}
      {/* data-editor-safe: ここを押してもテロップの打ち直しは閉じない。
          見た目を直しに来ただけなので、閉じると打ちかけの文字と選択が失われる
          （決まりは state/useDismissOnOutside の「閉じない場所」） */}
      <section
        className="panel"
        data-editor-safe=""
        style={{ width: rightW, flex: '0 0 auto' }}
      >
        <PanelTabs
          group="right"
          tabs={orderedTabs('right', TAB_DEFS.right)}
          active={rightTab}
          onPick={(id) => pickTab('right', id)}
          onTabMenu={(e, grp, id, label) => {
            e.preventDefault()
            e.stopPropagation()
            setTabOverflow(null)
            setTabMenu({ x: e.clientX, y: e.clientY, group: grp, id, label })
          }}
          onOverflow={(e, grp, hidden) => {
            e.stopPropagation()
            setTabMenu(null)
            setTabOverflow({ x: e.clientX, y: e.clientY, group: grp, hidden })
          }}
          onReorder={(ids) => setTabOrder((prev: Record<string, string[]>) => ({ ...prev, right: ids }))}
        />
        {/* --- 右: プロジェクト（素材の置き場）--- 中身は components/panels/ProjectBinTab.tsx */}
        {rightTab === 'project' && <ProjectBinTab {...projectBinTab} />}

        {/* --- テロップテンプレ --- 中身は components/panels/TelopTemplatesTab.tsx */}
        {rightTab === 'telop' && (
          <TelopTemplatesTab {...telopTab} />
        )}

        {/* --- アイコン（画像置き場）--- 中身は components/panels/IconLibraryTab.tsx */}
        {rightTab === 'icon' && (
          <IconLibraryTab {...iconTab} />
        )}

        {/* --- SE（効果音の置き場）--- 中身は components/panels/SeLibraryTab.tsx */}
        {rightTab === 'se' && (
          <SeLibraryTab {...seTab} />
        )}

        {/* --- トランジション --- 中身は components/panels/TransitionsTab.tsx。
            動画クリップもテロップも「頭・間・尻のどこにでも置ける」同じ扱い。 */}
        {rightTab === 'transition' && <TransitionsTab {...transitionsTab} />}
      </section>
      </PaneHost>
  )
}
