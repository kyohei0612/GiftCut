// 帯の上に出す「打った印（キーフレーム）」。
//
// **タイムラインからも見えるようにする。** ここに出さないと、後から
// 「どこに打ったか」を探せない（プレミアもクリップの上に並べている）。
//
// テロップ・動画切片・画像・映像レイヤーで同じ物を使う。種類ごとに書くと、
// 「テロップには出るのにクリップには出ない」という食い違いが必ず出る。
//
// ## 触れる印と、触れない印がある
//
// 消す手段を渡されたときだけ、印はマウスを受け取る（形も指に変わる）。
// **既定は受け取らない。** 印は帯の上に乗っているので、常に受け取ると
// クリップを掴もうとして印を掴んでしまい、動かせない場所ができる。

import type { JSX } from 'react'

export function KeyMarks({
  /** クリップの先頭からの秒（打たれている印の時刻） */
  times,
  /** 1秒あたりの横幅 */
  zoom,
  /** クリップがタイムラインのどこから始まるか（重ねて出す説明の時刻用） */
  clipStart,
  /**
   * その印を消す。渡されたときだけ印が触れるようになる。
   *
   * **消すのは右クリック。** 左クリックにすると、クリップを選ぼうとして
   * 印に当たった瞬間に消える（打った物が黙って消えるのが一番困る）。
   */
  onRemove
}: {
  times: number[]
  zoom: number
  clipStart: number
  onRemove?: (t: number) => void
}): JSX.Element | null {
  if (!times.length) return null
  return (
    <>
      {times.map((t) => (
        <span
          key={`kf-${t}`}
          className={`kf-mark ${onRemove ? 'kf-mark-hot' : ''}`}
          style={{ left: t * zoom }}
          title={
            `動きの印（${(clipStart + t).toFixed(2)}秒）` +
            (onRemove ? '\n右クリックでこの印を消します' : '')
          }
          onContextMenu={
            onRemove
              ? (e) => {
                  // 帯の右クリック品書きが出ないように、ここで止める
                  e.preventDefault()
                  e.stopPropagation()
                  onRemove(t)
                }
              : undefined
          }
          // 左で押したぶんは帯へ流さない（印の上でクリップを掴み始めない）
          onPointerDown={onRemove ? (e) => e.stopPropagation() : undefined}
        />
      ))}
    </>
  )
}
