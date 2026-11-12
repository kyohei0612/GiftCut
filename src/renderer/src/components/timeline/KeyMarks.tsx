// 帯の上に出す「打った印（キーフレーム）」◆。
//
// **タイムラインからも見えるようにする。** ここに出さないと、後から
// 「どこに打ったか」を探せない（プレミアもクリップの上に並べている）。
//
// テロップ・動画切片・画像・映像レイヤーで同じ物を使う。種類ごとに書くと、
// 「テロップには出るのにクリップには出ない」という食い違いが必ず出る。
//
// ## ◆でできること（2026-11-12 に揃えた）
//
//   クリック          その◆を選ぶ（光る）。**Delete でその◆だけ消える**
//   左右へドラッグ     その時刻の印をまとめてずらす（離したときに1回で確定）
//   右クリック        その◆を消す（前からある近道）
//
// 前は右クリックで消すことしかできず、押すと下の帯が選ばれ、そこで Delete を押すと
// **テロップごと消えた**。文字を順に出す演出（タイプライター）は◆でタイミングが
// 出るのに、動かせなかった（本人「せっかく印で出るのに調整できない」）。
//
// ## 動かしている途中は見た目だけ
//
// 1コマごとに中身を書き換えると、履歴（450ms でまとまる）が途中で何手も積まれ、
// Ctrl+Z が「少しだけ戻る」を繰り返す。**離したときに1回だけ**書く。
//
// ## 触れる印と、触れない印がある
//
// `target`（どの物の印か）を渡されたときだけ、印はマウスを受け取る。
// **既定は受け取らない。** 印は帯の上に乗っているので、常に受け取ると
// クリップを掴もうとして印を掴んでしまい、動かせない場所ができる。

import { useState, type JSX } from 'react'
import { useTimelineOps } from '../../state/timelineOpsContext'
import { useSel } from '../../state/selectionContext'
import type { KeySel } from '../../state/useSelection'

/** 動かしたとみなす最小の横の量（px）。これ未満はクリック＝選ぶだけ */
const DRAG_PX = 3

export function KeyMarks({
  /** クリップの先頭からの秒（打たれている印の時刻） */
  times,
  /** 1秒あたりの横幅 */
  zoom,
  /** クリップがタイムラインのどこから始まるか（重ねて出す説明の時刻用） */
  clipStart,
  /** クリップの長さ（秒）。印はこの外へは動かせない */
  len,
  /** どの物の印か。渡されたときだけ、選ぶ・動かす・消すができる */
  target
}: {
  times: number[]
  zoom: number
  clipStart: number
  len: number
  target?: Omit<KeySel, 't'>
}): JSX.Element | null {
  const { removeKeyAtTime, moveKeyAtTime } = useTimelineOps()
  const { selectedKey, setSelectedKey } = useSel()
  /** 掴んでいる◆（元の時刻と、いまの見た目の時刻） */
  const [drag, setDrag] = useState<{ from: number; at: number } | null>(null)
  if (!times.length) return null
  const isSel = (t: number): boolean =>
    !!target &&
    selectedKey?.kind === target.kind &&
    selectedKey.id === target.id &&
    Math.abs(selectedKey.t - t) < 1e-4

  const onDown = (t: number, e: React.PointerEvent): void => {
    if (!target || e.button !== 0) return
    // 左で押したぶんは帯へ流さない（印の上でクリップを掴み始めない・帯を選ばない）
    e.stopPropagation()
    e.preventDefault()
    const x0 = e.clientX
    let moved = false
    let at = t
    const move = (ev: PointerEvent): void => {
      const dx = ev.clientX - x0
      if (!moved && Math.abs(dx) < DRAG_PX) return
      moved = true
      // 0.01秒刻み（印の時刻は小数で持つので、刻まないと 1.2345678 のような値が残る）
      at = Math.round(Math.min(Math.max(0, t + dx / zoom), len) * 100) / 100
      setDrag({ from: t, at })
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrag(null)
      if (moved && Math.abs(at - t) > 1e-4) moveKeyAtTime({ ...target } as never, t, at)
      // 動かしても動かさなくても、離した所の◆を選んだ状態にする
      setSelectedKey({ ...target, t: moved ? at : t })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <>
      {times.map((t) => {
        const shown = drag && Math.abs(drag.from - t) < 1e-4 ? drag.at : t
        return (
          <span
            key={`kf-${t}`}
            className={`kf-mark ${target ? 'kf-mark-hot' : ''} ${isSel(t) ? 'kf-mark-sel' : ''}`}
            style={{ left: shown * zoom }}
            title={
              `動きの印（${(clipStart + shown).toFixed(2)}秒）` +
              (target ? '\nクリックで選ぶ（Delete で消す）・左右へドラッグでずらす・右クリックで消す' : '')
            }
            onContextMenu={
              target
                ? (e) => {
                    // 帯の右クリック品書きが出ないように、ここで止める
                    e.preventDefault()
                    e.stopPropagation()
                    removeKeyAtTime({ ...target } as never, t)
                    if (isSel(t)) setSelectedKey(null)
                  }
                : undefined
            }
            onPointerDown={target ? (e) => onDown(t, e) : undefined}
          />
        )
      })}
    </>
  )
}
