// **拡大の基準点**（「どこへ向かって寄るか」）を出す・動かす・当てる。
//
// ## 画面だけの持ち物
//
// プロジェクトには保存しない。動かした結果は今までどおりの x/y へ書き込むので、
// **書き出し側には新しい式が1つも増えない**（理由は `shared/clipMotion` の
// `zoomOffsetForAnchor` の真上）。
//
// ## 誰に付いている基準点かも一緒に持つ
//
// 別のクリップを選んだときに、その子の位置を勝手に書き換えないため。
//
// ## 出すときは、いまの絵から取り直す
//
// `anchorOfZoom` で取り直すので、保存も持ち物も増えない。等倍のときは
// どこを基準にしていたか絵に残らないため真ん中から始まる。
//
// ## 印（キーフレーム）が付いていたら、印を動かす
//
// 印が無ければ固定値を書き換えるが、**印があるのに固定値を動かすと、
// 再生した瞬間に元へ戻る**（印の値が勝つため）。
//
// ## なぜ ./usePreviewManip から出したか（2026-08-04）
//
// あちらは526行で、どの話題もこの群を土台にしていた（掴んで動かす側も、
// 選ぶ側も、同じ物を返していた）。**またぐからこそ土台**なので先に出した。
// 測ったら心臓（context）は1つも要らず、要るのは deps 3つと
// あちらの小物3つだけだった（`引き継ぎ-心臓の分け直し.md`）。
//
// ## 中身
//
// - `usePreviewAnchor` … 下をまとめて返す唯一の入口
// - `toggleZoomAnchor` … 「拡大の中心」を出す／しまう
// - `applyZoomAnchor` … 基準点を当てて、寄り先を書き換える
// - `onZoomAnchorStart` … 基準点そのものを掴んで動かす
import { useEffect, useState } from 'react'
import { clamp } from '../../../shared/timeline'
import { hasKeys, putKey, type Keys } from '../../../shared/keyframes'
import {
  zoomAt,
  zoomOffsetForAnchor,
  anchorOfZoom,
  MIN_MOTION_SCALE,
  type Anchor,
  type Zoom
} from '../../../shared/clipMotion'
import { DEFAULT_ZOOM } from '../lib/clipLook'
import type { ReframeTarget } from '../lib/projectTypes'
import type { UsePreviewManipDeps } from './usePreviewManip'

// **deps の型は手で書かない。** 呼ぶ側の定義から引く
//（引数の数を間違えても通ってしまうのを防ぐ。08-04 に別の所で3か所ズレた）
export type UsePreviewAnchorDeps = Pick<
  UsePreviewManipDeps,
  'screenRef' | 'reframeTargetRef' | 'patchClipMotion'
> & {
  /** 印を読む・打つときの時刻（クリップの先頭からの秒）。**./usePreviewManip の物を借りる** */
  clipTimeOf: (t: ReframeTarget) => number
  /** 印を使わないときの寄り先を書き換える。**同上** */
  setFixedZoom: (t: ReframeTarget, z: Zoom) => void
  /** その段に鍵が掛かっているか。**同上** */
  lockedFor: (t: ReframeTarget) => boolean
}

export function usePreviewAnchor(deps: UsePreviewAnchorDeps) {
  const {
    screenRef, reframeTargetRef, patchClipMotion, clipTimeOf, setFixedZoom, lockedFor
  } = deps

  // 拡大の基準点（「どこへ向かって寄るか」）。**画面だけの持ち物**で、
  // プロジェクトには保存しない。動かした結果は今までどおりの x/y へ書き込むので、
  // 書き出し側には新しい式が1つも増えない（`shared/clipMotion` の
  // `zoomOffsetForAnchor` の真上に、なぜそうするかを書いてある）。
  // null＝出していない。**誰に付いている基準点かも一緒に持つ**（別のクリップを
  // 選んだときに、その子の位置を勝手に書き換えないため）。
  const [zoomAnchor, setZoomAnchor] = useState<(Anchor & { kind: string; id: number }) | null>(null)

  /**
   * 「拡大の中心」を出す／しまう。
   *
   * 出すときは**いまの絵から基準点を取り直す**（`anchorOfZoom`）ので、
   * 保存も持ち物も増えない。等倍のときはどこを基準にしていたか絵に残らないため
   * 真ん中から始まる。
   */
  function toggleZoomAnchor(): void {
    const tgt = reframeTargetRef.current
    if (!tgt) return
    setZoomAnchor((a) => (a ? null : anchorFor(tgt)))
  }

  /** その相手の、いまの絵が示している基準点 */
  const anchorFor = (t: ReframeTarget): Anchor & { kind: string; id: number } => ({
    ...anchorOfZoom(zoomAt(t.zoom, t.motion, clipTimeOf(t))),
    kind: t.kind,
    id: t.id
  })

  /**
   * **基準点を出している間は、拡大がどこで変わっても、その点へ向くように引き直す。**
   *
   * 四隅を掴む以外にも拡大が変わる道はいくつもある（モーションタブの数値欄・
   * 属性の貼り付け・見本帳）。そこを通ったときだけ中心へ寄ってしまうと、
   * せっかく決めた基準点が「掴んだときだけ効く飾り」になる。
   *
   * 輪にならない理由: 引き直した先は**この式の不動点**なので、当たった次の回は
   * 「もう合っている」で何もしない。合わせに行くのは相手が動いたときだけ。
   *
   * ※ 元に戻す（Ctrl+Z）は、拡大の変更と位置の引き直しで**2回ぶん**積まれる。
   *   1回にまとめるには拡大を変える側を全部通す形にする必要があり、そちらの方が
   *   道が増える（＝壊れる所が増える）ので、ここでは受け入れている。
   */
  useEffect(() => {
    if (!zoomAnchor) return
    const tgt = reframeTargetRef.current
    if (!tgt || lockedFor(tgt)) return
    // 別の物を選んだら、その子の絵から取り直す（前の子の基準点で書き換えない）
    if (tgt.kind !== zoomAnchor.kind || tgt.id !== zoomAnchor.id) {
      setZoomAnchor(anchorFor(tgt))
      return
    }
    const z = zoomAt(tgt.zoom, tgt.motion, clipTimeOf(tgt))
    // **等倍のときは何もしない。** 等倍では基準点がどこであれ位置は 0 なので、
    // 合わせに行くと「等倍のまま横へずらす」ができなくなる（0 へ引き戻される）。
    // マーカーは「次に寄せたい先」として置いたまま
    if (Math.abs(z.scale - 1) < 1e-6) return
    const want = zoomOffsetForAnchor(zoomAnchor, z.scale)
    if (Math.abs(z.x - want.x) < 1e-6 && Math.abs(z.y - want.y) < 1e-6) return
    applyZoomAnchor(zoomAnchor)
  })

  /**
   * 基準点を、いまある位置（x/y）へ書き込む。**掴んだ物1つだけに効く。**
   *
   * まとめて効かせないのは拡大と同じ理由——基準点はそれぞれの絵の中の場所なので、
   * 揃えたつもりでばらばらに飛ぶ。
   */
  function applyZoomAnchor(a: Anchor): void {
    const tgt = reframeTargetRef.current
    if (!tgt || lockedFor(tgt)) return
    const m = tgt.motion
    if (hasKeys(m?.sc)) {
      // **拡大に印があるときは、位置も「同じ時刻」に打つ。**
      // その場の1点だけ打つと、寄っていく途中で基準点がずれていく。
      // x は s の一次式（`zoomOffsetForAnchor`）なので、同じ時刻・同じつなぎ方で
      // 打てば間もぴたりと合う。
      // ※ ベジェの接線（速度・影響）までは写していない。手で打つぶんは e しか
      //   使わないので今は足りる。向こうから写し取った動きをクリップに載せる日が
      //   来たら、ここも接線ごと写す必要がある。
      for (const k of m!.sc!) {
        const off = zoomOffsetForAnchor(a, Math.max(MIN_MOTION_SCALE, k.v))
        patchClipMotion(tgt.kind, tgt.id, 'x', (ks: Keys | undefined) => putKey(ks, k.t, off.x, k.e))
        patchClipMotion(tgt.kind, tgt.id, 'y', (ks: Keys | undefined) => putKey(ks, k.t, off.y, k.e))
      }
      return
    }
    const base = tgt.zoom ?? DEFAULT_ZOOM
    setFixedZoom(tgt, { ...base, ...zoomOffsetForAnchor(a, base.scale) })
  }

  /** 基準点のマーカーを掴んで動かす */
  function onZoomAnchorStart(e: React.PointerEvent): void {
    if (e.button !== 0) return
    const tgt = reframeTargetRef.current
    if (!tgt) return
    e.stopPropagation()
    e.preventDefault()
    const rect = screenRef.current?.getBoundingClientRect()
    if (!rect) return
    // 枠の中だけ。外へ出せる作りにもできるが、「どこへ向かって寄るか」は
    // 映っている場所を指す道具なので、外に置けても指す先が無い
    const at = (ev: { clientX: number; clientY: number }): Anchor => ({
      x: clamp((ev.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((ev.clientY - rect.top) / rect.height, 0, 1)
    })
    const onMove = (ev: PointerEvent): void => {
      const a = at(ev)
      setZoomAnchor({ ...a, kind: tgt.kind, id: tgt.id })
      applyZoomAnchor(a)
    }
    const onUp = (ev: PointerEvent): void => {
      onMove(ev)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // **返すのは、外が本当に受け取っている物だけ。**
  //（`anchorFor` は中でしか使っていないので返さない）
  return { zoomAnchor, setZoomAnchor, toggleZoomAnchor, applyZoomAnchor, onZoomAnchorStart }
}
