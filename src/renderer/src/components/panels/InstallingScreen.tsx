// 「今すぐ更新して再起動」を押した直後に出す全画面。
//
// ## これは「入れ替え中」の表示ではない（2026-08-06 に書き直した）
//
// 最初そのつもりで作ったが、**実態と違った。** `quitAndInstall` の中身はこう:
//
// ```
// install(...)                    インストーラ（別プロセス）を起動して
// setImmediate(() => app.quit())  **すぐ閉じる**
// ```
//
// つまりこの画面が映るのは**窓が閉じるまでの一瞬**で、本当の入れ替えは
// **窓が無い状態**で走る。「入れ替え中ずっと出ている」は嘘だった。
//
// ## では何のために出すか
//
// **押したことが届いた、を伝えるため。** これが無いと、押してから窓が消えるまでの
// 間に何も変わらず「押せていないのでは」と思わせる。役目はそこまでで、
// **その先の十数秒は画面に何も出せない**（アプリが終了しているので当然）。
//
// ## 待ちを消す方法は1つだけ
//
// **押さないこと。** 普通に閉じれば `autoInstallOnAppQuit` が閉じた後に当てるので、
// 待っているのはもう本人ではない。「今すぐ」は**いま新しい版が要る人**のための道。

import type { JSX } from 'react'

export function InstallingScreen(): JSX.Element {
  return (
    <div className="installing" role="alertdialog" aria-live="polite">
      <div className="installing-box">
        <div className="installing-title">いったん閉じて、新しい GiftCut に入れ替えます</div>
        <div className="installing-sub">
          入れ替えに十数秒かかります。その間このアプリは閉じているので、
          <b>画面には何も出ません</b>。終わると自動で開きます。
        </div>
      </div>
    </div>
  )
}
