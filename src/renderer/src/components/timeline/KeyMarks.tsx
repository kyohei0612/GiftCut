// 帯の上に出す「打った印（キーフレーム）」。
//
// **タイムラインからも見えるようにする。** ここに出さないと、後から
// 「どこに打ったか」を探せない（プレミアもクリップの上に並べている）。
//
// テロップ・動画切片・画像・映像レイヤーで同じ物を使う。種類ごとに書くと、
// 「テロップには出るのにクリップには出ない」という食い違いが必ず出る。

import type { JSX } from 'react'

export function KeyMarks({
  /** クリップの先頭からの秒（打たれている印の時刻） */
  times,
  /** 1秒あたりの横幅 */
  zoom,
  /** クリップがタイムラインのどこから始まるか（重ねて出す説明の時刻用） */
  clipStart
}: {
  times: number[]
  zoom: number
  clipStart: number
}): JSX.Element | null {
  if (!times.length) return null
  return (
    <>
      {times.map((t) => (
        <span
          key={`kf-${t}`}
          className="kf-mark"
          style={{ left: t * zoom }}
          title={`動きの印（${(clipStart + t).toFixed(2)}秒）`}
        />
      ))}
    </>
  )
}
