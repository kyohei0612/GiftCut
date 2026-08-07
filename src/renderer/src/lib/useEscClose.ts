// **覆い（モーダル）を Escape で閉じる。**
//
// ## なぜ要ったか（2026-08-07）
//
// 覆いは7つあるのに、**Escape を見ている物が1つも無かった**。
// 実際に見学して気づいた——字幕ダイアログに Escape を送っても閉じず、
// その後の操作が全部その覆いに阻まれた（自動の見学が止まったのと同じ壁に、
// 初めて触る人も当たる）。
//
// Escape で閉じるのは OS 共通の作法で、**効かないと「固まった？」と読まれる**。
// 押せるボタンが見えていても、手が先に Escape へ行く人は多い。
//
// ## 走っている最中は閉じない
//
// 書き出し中・聞き取り中に Escape で消えると、
// **走っている物が見えなくなるだけ**（止まりはしない）。それは復帰できない
// 混乱を作るので、`enabled` を false にして受け付けない。
// 止めたいときは「中止」ボタンで、意思をはっきり示してもらう。
//
// ## 一番手前の1枚だけが閉じる
//
// 覆いが重なっているとき（設定の上に確認、など）、Escape で全部消えると
// 何が起きたか分からない。**最後に開いた物だけ**が受け取る——
// 開いた順に積んで、上から1枚ずつ剥がす。
import { useEffect } from 'react'

/** いま開いている覆いの積み（後ろほど手前） */
const stack: symbol[] = []

/**
 * Escape でこの覆いを閉じる。
 *
 * @param onClose 閉じるときに呼ぶ
 * @param enabled false の間は受け付けない（走っている最中など）
 */
export function useEscClose(onClose: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const me = Symbol('overlay')
    stack.push(me)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // **一番手前だけ反応する**（重なっているとき、下の覆いまで消さない）
      if (stack[stack.length - 1] !== me) return
      // 文字を打っている最中の Escape は、入力の取り消しとして使われることがある。
      // ただし打ち終わった値は残るので、覆いを閉じてよい——ここでは止めない
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    // **捕まえる側（capture）で聞く。** 画面の他の Escape 処理
    //（選択を外す・ツールを戻す）より先に受け取らないと、
    // 覆いが開いているのに裏側が反応してしまう
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      const i = stack.indexOf(me)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [onClose, enabled])
}
