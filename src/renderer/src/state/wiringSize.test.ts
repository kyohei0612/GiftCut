// 配線と、その周りの大きいファイルが「1回で読み切れる」大きさを保っているか。
//
// ## なぜ行数を見張るのか
//
// **人ではなく、AI が読めなくなる境目がある。**
// AI がファイルを読むときは1回あたりの上限があり、超えると分割して読む。
// 分割されると「前半だけ見て答える」事故が起きる——実際に 2026-08-02 の作業で、
// 全体を読まずに grep で数えたせいで「呼ぶときに見に行く」を
// 15か所と数え間違えた（本当は21か所）。
//
// ## 上限の根拠は、理屈ではなく観測
//
//   1,295行のとき … 1回で読めず、1〜984行で切れた
//   1,182行のとき … 1回で全部読めた
//
// 境目はこの間にある。**なぜそこなのかは説明できない**（文字数では5%しか
// 違わない）ので、観測した2点だけを根拠に 1,250行 を上限とする。
// いまが 1,200行ほどなので、余裕は50行しかない。
//
// ## ここが赤くなったら
//
// **ファイルを機械的に割らないこと。** 配線は割れないと測定で出ている
// （どこで切っても106〜413個またぐ。引き継ぎ-App分割.md の「段階4・5」）。
// やることは2つのどちらか:
//
//   1. 説明の重複を削る（別ファイルへ移った物の説明が残っていないか）
//   2. 画面側の束（rightPanel / dialogs）を小さくして、配線から減らす
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 1回で読み切れる上限（観測で決めた。上の説明を読むこと） */
const MAX_LINES = 1250

const WATCHED = ['useAppWiring.tsx']

describe('1回で読み切れる大きさを保つ', () => {
  for (const name of WATCHED) {
    it(`${name} が ${MAX_LINES} 行を超えない`, () => {
      const lines = readFileSync(join(HERE, name), 'utf8').split('\n').length
      expect(lines).toBeLessThanOrEqual(MAX_LINES)
    })
  }
})
