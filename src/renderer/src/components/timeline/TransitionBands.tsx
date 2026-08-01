// 本編（V1）に付いたトランジションの帯。
//
// 3種類ある。
//
//   頭ディップ … 切片の頭で明転／白から
//   尻ディップ … 切片の尻で暗転／白へ
//   クロスディゾルブ … カットをまたいで次へ溶ける
//
// ## 帯は「実際に効いている区間」に描く
//
// クロスディゾルブは **[カット - d, カット)** に描く。以前はカットを中心に
// [cut-d/2, cut+d/2] で描いていたが、プレビューも書き出しも**カットの手前 d 秒**で
// 掛かる作りなので、帯だけが半分ずれていた。
// 「貼ってある所より早く動く」と言われたのはこれ——効果が早いのではなく、
// 帯が半分後ろに描かれていた。
//
// ※ プレミアのように「カットをまたいで真ん中」に掛けるには、左のクリップが
//   尻より先のコマを持っている必要がある（のりしろ）。そこまで変えるなら
//   書き出し側の offset も一緒に直すこと。
//
// ## 出さない場合が2つある
//
//   映像なしの切片      … V1 に何も描かないので帯も出さない
//   xfade がある境界の頭 … 書き出しが xfade を優先して頭ディップを抑えるので、
//                          表示も合わせる（出すと「貼ったのに効かない」に見える）

import type { JSX, ReactNode } from 'react'
import { xfadeDurAt } from '../../../../shared/timeline'
import { bandClass, transIco, transLabel } from '../../lib/transitions'
import type { SegLayout } from '../../lib/projectTypes'

/* eslint-disable @typescript-eslint/no-explicit-any */
export function TransitionBands({
  segLayout,
  zoom,
  selectedTrans,
  onSelect,
  onResizeStart,
  onSetDur
}: {
  segLayout: SegLayout[]
  /** 横の拡大率（px/秒） */
  zoom: number
  selectedTrans: { segId: number; kind: string } | null
  onSelect: (segId: number, kind: 'in' | 'out' | 'xfade') => void
  /** 端を掴んで長さを変える。dir は伸びる向き、max はその切片で許される上限 */
  onResizeStart: (
    e: React.PointerEvent,
    startDur: number,
    dir: number,
    apply: (nd: number) => void,
    max: number
  ) => void
  onSetDur: (segId: number, kind: 'in' | 'out' | 'xfade', nd: number) => void
}): JSX.Element {
  return (
    <>
      {segLayout.flatMap((L) => {
        const boxes: ReactNode[] = []
        // 削除(映像なし)切片は V1 に何も描かないのでトランジション帯も出さない
        if ((L.seg as any).videoBlank) return boxes
        // 頭ディップ（明転/白）: [tStart, tStart+dur]。
        // 直前の境界に有効な xfade があるときは頭ディップは出さない
        if (L.seg.transIn && (L.index === 0 || xfadeDurAt(segLayout, L.index - 1) <= 0)) {
          const d = Math.min(L.seg.transIn.dur, L.len)
          const sel = selectedTrans?.segId === L.seg.id && selectedTrans.kind === 'in'
          boxes.push(
            <div
              key={`in-${L.seg.id}`}
              className={`ttrans ${bandClass(L.seg.transIn.type)} ${sel ? 'ttrans-sel' : ''}`}
              style={{ left: L.tStart * zoom, width: Math.max(d * zoom, 8) }}
              title={`頭 ${transLabel(L.seg.transIn.type)} ${d.toFixed(2)}s（クリックで選択・Deleteで削除）`}
              onPointerDown={(e) => {
                e.stopPropagation()
                if (e.button === 0) onSelect(L.seg.id, 'in')
              }}
            >
              <span className="ttrans-lb">
                {transIco(L.seg.transIn.type)} {d.toFixed(1)}s
              </span>
              <div
                className="ttrans-resize ttrans-resize-r"
                title="ドラッグで長さ変更"
                onPointerDown={(e) => {
                  onSelect(L.seg.id, 'in')
                  onResizeStart(e, L.seg.transIn!.dur, 1, (nd) => onSetDur(L.seg.id, 'in', nd), L.len)
                }}
              />
            </div>
          )
        }
        // 尻ディップ（暗転/白）: [tEnd-dur, tEnd]。その境界に xfade があるなら xfade を優先表示
        if (L.seg.transOut && xfadeDurAt(segLayout, L.index) <= 0) {
          const d = Math.min(L.seg.transOut.dur, L.len)
          const sel = selectedTrans?.segId === L.seg.id && selectedTrans.kind === 'out'
          boxes.push(
            <div
              key={`out-${L.seg.id}`}
              className={`ttrans ${bandClass(L.seg.transOut.type)} ${sel ? 'ttrans-sel' : ''}`}
              style={{ left: (L.tEnd - d) * zoom, width: Math.max(d * zoom, 8) }}
              title={`尻 ${transLabel(L.seg.transOut.type)} ${d.toFixed(2)}s（クリックで選択・Deleteで削除）`}
              onPointerDown={(e) => {
                e.stopPropagation()
                if (e.button === 0) onSelect(L.seg.id, 'out')
              }}
            >
              <span className="ttrans-lb">
                {transIco(L.seg.transOut.type)} {d.toFixed(1)}s
              </span>
              <div
                className="ttrans-resize ttrans-resize-l"
                title="ドラッグで長さ変更"
                onPointerDown={(e) => {
                  onSelect(L.seg.id, 'out')
                  onResizeStart(e, L.seg.transOut!.dur, -1, (nd) => onSetDur(L.seg.id, 'out', nd), L.len)
                }}
              />
            </div>
          )
        }
        // カット間クロスディゾルブ。帯は実際に効いている区間 [cut-d, cut) に描く
        const xd = xfadeDurAt(segLayout, L.index)
        if (xd > 0) {
          const cut = L.tEnd
          const sel = selectedTrans?.segId === L.seg.id && selectedTrans.kind === 'xfade'
          boxes.push(
            <div
              key={`xf-${L.seg.id}`}
              className={`ttrans ${bandClass(L.seg.xfade?.type ?? 'fade')} ${sel ? 'ttrans-sel' : ''}`}
              style={{ left: (cut - xd) * zoom, width: Math.max(xd * zoom, 12) }}
              title={`${transLabel(L.seg.xfade?.type)} ${xd.toFixed(2)}s（カットの手前で掛かります・クリックで選択・Deleteで削除）`}
              onPointerDown={(e) => {
                e.stopPropagation()
                if (e.button === 0) onSelect(L.seg.id, 'xfade')
              }}
            >
              <span className="ttrans-lb">
                {transIco(L.seg.xfade?.type)} {xd.toFixed(1)}s
              </span>
              <div
                className="ttrans-resize ttrans-resize-r"
                title="ドラッグで長さ変更"
                onPointerDown={(e) => {
                  onSelect(L.seg.id, 'xfade')
                  onResizeStart(
                    e,
                    xd,
                    2,
                    (nd) => onSetDur(L.seg.id, 'xfade', nd),
                    Math.min(L.len, segLayout[L.index + 1]?.len ?? L.len)
                  )
                }}
              />
            </div>
          )
        }
        return boxes
      })}
    </>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */
