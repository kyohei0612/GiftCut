// 更新を**入れ替えている最中**の全画面表示。
//
// ## なぜ細い帯ではないか
//
// ここから先はインストーラの仕事で、**触っても何もできない**。
// 触れる見た目のまま置くと、押しても反応しない画面を触らせることになる。
//
// ## なぜ数字（何%）が無いか
//
// 入れ替えは NSIS が黙って（silent）やるので、**何%終わったかを返してこない**
// （理由は `shared/updateState.ts`）。出せるのは経過秒だけ。
//
// **数字が無いからといって何も出さない、はしない。** 押した直後から十数秒
// 無反応に見えるのが一番まずい——2026-08-06、e2e でまったく同じ勘違いが起きた
// （動いているのに無音で「固まってる」と報告された）。
// 経過秒が増えていれば、**止まっているのとは区別が付く。**

import { useEffect, useState, type JSX } from 'react'

/** ここを超えたら「思ったより長い」と言う（秒）。実測で十数秒なので、その倍 */
const LONG_SEC = 40

export function InstallingScreen(): JSX.Element {
  const [sec, setSec] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setSec((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="installing" role="alertdialog" aria-live="polite">
      <div className="installing-box">
        <div className="installing-title">新しい GiftCut に入れ替えています</div>
        <div className="installing-sub">
          終わると自動で開きます。**このまま閉じないでください。**
        </div>
        {/* 進み具合の代わりに経過秒。**止まっているのと区別が付けばよい** */}
        <div className="installing-sec">{sec} 秒</div>
        {sec >= LONG_SEC && (
          // **長引いたときに黙らない。** 「待てばいいのか、おかしいのか」が
          // 分からないまま待たせるのが一番つらい
          <div className="installing-long">
            いつもより時間がかかっています。もう少し待っても変わらないときは、
            アプリを閉じてもう一度開いてください（更新は次に閉じたときにも当たります）。
          </div>
        )}
      </div>
    </div>
  )
}
