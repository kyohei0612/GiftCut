// 作業する所（左・プレビュー・右・タイムライン）の並べ方。
//
// ## ここは「置き方」だけ
//
// 中身は4つの区画がそれぞれ心臓から自分で見に行くので、ここに残るのは
// **どこに何を置くか・境目をどう掴むか**だけ。中身の受け渡しが混ざっていた
// ときは、置き方を直したいのに300行を読む必要があった。
import { PaneHost } from '../PanelChrome'
import { LeftPanel } from '../LeftPanel'
import { PreviewArea } from './PreviewArea'
import { RightPanelArea } from './RightPanelArea'
import { TimelineArea } from '../timeline/TimelineArea'
import type { PaneId } from '../../state/usePanelLayout'

export interface WorkspaceProps {
  PANE_LABEL: Record<PaneId, string>
  isPopped: (id: PaneId) => boolean
  paneGeom: Record<string, unknown>
  unpopPane: (id: PaneId) => void
  startResize: (which: 'left' | 'right' | 'timeline', e: React.PointerEvent) => void
}

export function Workspace({
  PANE_LABEL,
  isPopped,
  paneGeom,
  unpopPane,
  startResize
}: WorkspaceProps): React.JSX.Element {
  return (
    <div className="workspace">
      <div className="upper">
        <PaneHost
          id="left"
          title={PANE_LABEL.left}
          popped={isPopped('left')}
          geom={paneGeom.left as never}
          onClose={() => unpopPane('left')}
        >
          <LeftPanel />
        </PaneHost>

        <div className="resizer resizer-v" onPointerDown={(e) => startResize('left', e)} />

        {/* **真ん中だけは、出て行くと横幅が丸ごと余る**（左右は幅が決まっていて、
            伸び縮みするのはここだけ）。何も置かないと画面の6割が空になり、
            壊れたように見えるので、行き先の案内と戻すボタンを置く。 */}
        <PaneHost
          id="preview"
          title={PANE_LABEL.preview}
          popped={isPopped('preview')}
          geom={paneGeom.preview as never}
          onClose={() => unpopPane('preview')}
          placeholder={
            <section className="panel pane-away" style={{ flex: '1 1 0', minWidth: 0 }}>
              <div className="pane-away-box">
                <div className="pane-away-title">
                  ⧉ {PANE_LABEL.preview} は別ウィンドウで開いています
                </div>
                <button className="float-dock" onClick={() => unpopPane('preview')}>
                  ⇤ 本体へ戻す
                </button>
              </div>
            </section>
          }
        >
          <PreviewArea />
        </PaneHost>

        <div className="resizer resizer-v" onPointerDown={(e) => startResize('right', e)} />

        <RightPanelArea />
      </div>

      <div className="resizer resizer-h" onPointerDown={(e) => startResize('timeline', e)} />

      <PaneHost
        id="timeline"
        title={PANE_LABEL.timeline}
        popped={isPopped('timeline')}
        geom={paneGeom.timeline as never}
        onClose={() => unpopPane('timeline')}
      >
        <TimelineArea />
      </PaneHost>
    </div>
  )
}
