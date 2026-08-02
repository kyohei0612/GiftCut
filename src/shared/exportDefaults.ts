// 書き出しの既定値を決める。
//
// ## なぜ既定値を計算で出すか
//
// **書き出しは「取り込んだ物と同じ物が出る」が当たり前**で、そこを毎回
// 選ばせるのは、選び間違える機会を毎回作っているのと同じ。
// 4K の素材を読み込んだのに、既定が 1080p のまま書き出して、
// **出来上がってから気づく**——やり直しに何分もかかる所でこれが起きる。
//
// なので素材から決める。人がいじるのは「どこへ・どの名前で出すか」だけにする。
//
// ## ここに置く理由
//
// 画面を起動せずに確かめられる形にしておく。
// 「4K の素材から 1080p が選ばれていないか」は目で見ても分からない
// （出来上がったファイルを調べて初めて分かる）ので、試験で押さえる。

/** 書き出せる段（これ以外は選べない） */
export type ResP = 2160 | 1080 | 720 | 480
const STEPS: ResP[] = [480, 720, 1080, 2160]

/**
 * 素材の高さから、書き出す段を選ぶ。
 *
 * **上へは伸ばさない。** 1080 の素材を 4K で書き出しても、増えるのは
 * ファイルの大きさと書き出し時間だけで、絵は良くならない。
 * 段より少しだけ高い素材（例: 1200）は、その下の段（1080）に収める。
 *
 * 段より低い素材（例: 640×360）は一番下の段（480）に上げる。
 * 素材そのままの半端な大きさで出すと、H.264 が嫌う奇数や、
 * 端末で再生できない大きさになりうるため。
 */
export function resPFromHeight(h: number | undefined | null): ResP {
  if (!h || !Number.isFinite(h) || h <= 0) return 1080 // 分からないときは無難な所
  let best: ResP = STEPS[0]
  for (const s of STEPS) if (h >= s) best = s
  return best
}

/** 拡張子（先頭の . を含まない）を取る。無ければ空 */
function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1) : ''
}

/** パスから、拡張子を落とした名前だけを取る */
export function baseNameOf(path: string): string {
  const last = path.split(/[\\/]/).pop() ?? path
  const e = extOf(last)
  return e ? last.slice(0, -(e.length + 1)) : last
}

/**
 * 出力の名前（拡張子なし）を決める。
 *
 * **プロジェクト名がいちばん強い。** 名前を付けて保存した人は、その名前で
 * 出したいはず。付けていなければ元動画の名前を使う。
 * どちらも無ければ最後の砦（`giftcut_output`）。
 *
 * 元動画の名前をそのまま使うと**上書きの危険**があるので、呼ぶ側で
 * `uniqueName` を通して重なりを避ける。
 */
export function outputBaseName(projectPath?: string | null, videoPath?: string | null): string {
  const p = projectPath ? baseNameOf(projectPath) : ''
  if (p) return p
  const v = videoPath ? baseNameOf(videoPath) : ''
  return v || 'giftcut_output'
}

/**
 * 同じ名前が既にあるなら `(1)` `(2)` … を付けて避ける。
 *
 * **黙って上書きしない。** 書き出しは何分もかかるうえ、消えるのは
 * 「前に何分もかけて作った物」なので、取り返しがつかない。
 * しかも消えたことに気づくのは、探しに行ったときになる。
 *
 * `(1)` から始めるのは本人の指定。Windows の「(2) から」とは違うが、
 * **1本目に番号が付いていない**のは同じなので、並べたときに読み違えない。
 *
 * @param taken その名前（拡張子込み）が既にあるか
 */
export function uniqueName(base: string, ext: string, taken: (name: string) => boolean): string {
  const first = `${base}.${ext}`
  if (!taken(first)) return first
  for (let i = 1; i < 1000; i++) {
    const n = `${base}(${i}).${ext}`
    if (!taken(n)) return n
  }
  return first // ここまで来ることは無いが、名前を返さないよりはまし
}

/** フォルダと名前を1本のパスにつなぐ（区切りは元のフォルダに合わせる） */
export function joinOut(dir: string, name: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return dir.replace(/[\\/]+$/, '') + sep + name
}
