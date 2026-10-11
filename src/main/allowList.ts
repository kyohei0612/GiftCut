// `gcfile://` で画面へ配ってよいファイルの名簿。
//
// ## なぜ名簿が要るか
//
// 画面（renderer）はブラウザなので、ローカルのファイルをそのままは読めない。
// そこで `gcfile://` という専用の入口を作って渡しているが、**素通しにすると
// 画面側から PC のどのファイルでも読めてしまう。**
//
// なので「本人がダイアログで選んだ物」と「アプリが自分で作った物」だけを
// ここに登録し、名簿に無いパスは断る。
//
// ## 足し忘れると「読み込んだのに真っ黒」になる
//
// 断られたことは画面側からは分かりにくく、**エラーも出ずに何も映らない**。
// 新しくファイルを渡す道を作ったら、必ず `allowFile()` を通すこと。
import { normalize } from 'path'

const allowed = new Set<string>()

/**
 * 名簿に入った瞬間に呼ばれる相手（`main/fileWatch` の見張り）。
 * ここから直接 import しないのは、この名簿が Electron を知らない純粋な物だから
 * （試験から読める）。繋ぐのは index.ts
 */
let onAllow: ((p: string) => void) | null = null
export function setAllowHook(fn: (p: string) => void): void {
  onAllow = fn
}

/** この先を画面へ配ってよいことにする */
export function allowFile(p: string): void {
  allowed.add(normalize(p))
  onAllow?.(p)
}

/** 名簿にあるか（`gcfile://` の受け口と、各ハンドラの入口で見る） */
export function isAllowed(p: string): boolean {
  return allowed.has(normalize(p))
}
