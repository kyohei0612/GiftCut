// 心臓（context）の受け口の型を、**詰めている実体から引く**ための1行道具。
//
// ## なぜ要るか
//
// 区画（左・右・プレビュー・タイムライン）は prop を受けず、心臓を自分で見に行く。
// その受け口（`*Context.tsx` の interface）は**全部 `any` で手書きされていた**——
// 341件。`any` なので、存在しない物を触っても、引数の数を間違えても、
// 型検査が素通りする。2026-08-03 の不具合11件のうち2件がその型
// （「宣言だけあって実体が無い」。`draggingEmphasisRef` が実例）。
//
// ## 手で341件書き直さない
//
// 詰めているのは `useAppWiring` の1か所だけなので、そこから引ける。
// 注釈を外して実測したら **84件中83件に本物の型が付いた**
// （＝手書きの `any` は情報を捨てていただけだった）。
//
// ## 腐らない
//
// 実体が引っ越した・名前が変わったら `W['名前']` がその場で赤くなる。
// 説明だけ取り残されることが原理的に起きない
// （`telopAnim.ts` に本体の無い取説が残っていた失敗と同じ型を、ここでは踏めない）。
//
// ## 各 context の interface を1行の `= W` にしない理由
//
// **キーごとの説明が全部消えるため。** 受け口の説明はそのキーの真上にあるべきで、
// 型だけを引いて説明は残す、というのがこの形。
import type { useAppWiring } from './useAppWiring'

/** `useAppWiring` が詰めている心臓の中身。`type W = Wired<'previewCtx'>` の形で使う */
export type Wired<K extends keyof ReturnType<typeof useAppWiring>> =
  ReturnType<typeof useAppWiring>[K]
