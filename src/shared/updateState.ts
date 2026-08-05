// 更新の状況。**本体（main）が送り、画面（renderer）が受ける形。ここが唯一の定義。**
//
// ## なぜ shared へ出したか（2026-08-06）
//
// 同じ型が**3か所**にあった（`main/updater.ts` / `preload/index.ts` /
// `preload/index.d.ts`）。どれにも「src/main/updater.ts と同じ形」と
// コメントが書いてあったが、**同じであることを機械は見ていない。**
//
// 実際、落としている最中の実数（MB）を足したときに、
// 本体だけが新しくなって画面側は古い型のまま——**型検査が
// 「そんな項目は無い」と言って初めて気づいた**。
// 気づけたのは受け口が `any` でなかったからで、運が良かっただけ。
//
// **約束はコメントではなく型で書く。**

/** 落とす → 入れ替える の各段階 */
export type UpdateState =
  | { phase: 'checking' }
  | { phase: 'none' }
  /**
   * 落としている最中。**割合だけでなく実数（MB）も出す。**
   *
   * 「45%」だけだと、あと何秒かかるのか・そもそも大きい物なのかが分からない。
   * 120MB のうち何MBまで来たかが見えれば、待てるかどうかを本人が決められる。
   */
  | { phase: 'downloading'; version: string; percent: number; doneMB: number; totalMB: number }
  | { phase: 'ready'; version: string; when: 'now' | 'onQuit'; message: string; countdownSec: number }
  /**
   * 落とし終わって、**いま入れ替えている**（アプリを閉じてインストーラが走る）。
   *
   * ## ここに進み具合の数字は出せない
   *
   * 入れ替えは NSIS のインストーラが黙って（silent）やるので、
   * **何%終わったかを返してこない**。出せるのは「始まった」ことと経過秒だけ。
   *
   * 数字が無いからといって何も出さないと、**押した直後から無反応**に見える。
   * 2026-08-06、e2e で同じ型の勘違いが起きている（動いているのに無音で
   * 「固まってる」と報告された）。**止まっているのと区別が付く**ようにする。
   */
  | { phase: 'installing'; version: string }
  | { phase: 'error'; message: string }
