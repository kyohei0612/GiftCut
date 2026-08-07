// **覆い（モーダル）は Escape で閉じる。**
//
// ## なぜ機械で見るか（2026-08-07）
//
// 覆いが7つあって、**Escape を見ている物が1つも無かった**。
// 気づいたのは、画面を撮って回る見学を書いたとき——字幕ダイアログに
// Escape を送っても閉じず、その後の操作が全部止まった。
// **自動の見学が当たった壁に、初めて触る人も当たる。**
//
// 覆いは今後も増える。増やす人が毎回この作法を思い出す前提にすると、
// また同じ穴が空く（このリポジトリで4回起きた型）。**足した瞬間に落とす。**
//
// ## わざと外している物がある
//
//   書き出しの進捗   Escape で消えても**処理は止まらない**。見えなくなるだけで戻れない
//   前回の作業の復元 「復元する／破棄する」の二択。Escape がどちらなのか決まらない
//
// 外すのは構わないが、**理由をここに書く**こと（黙って外れていると、
// 次の人には「忘れている」のか「わざと」なのか読めない）。
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(__dirname, '..', 'renderer', 'src', 'components', 'dialogs')

/** Escape を付けないと決めた物（名前と、その理由） */
const 除外: Record<string, string> = {
  ExportProgressBox: '走っている書き出しは止まらない。消えると見えなくなるだけ',
  RestorePrompt: '復元する／破棄するの二択。Escape がどちらか決まらない'
}

/** 覆いを出している部品を、ファイルから拾う */
function 覆いを出す部品(src: string): string[] {
  const 名 = [...src.matchAll(/export function (\w+)/g)].map((m) => ({
    name: m[1],
    at: m.index ?? 0
  }))
  const 出す: string[] = []
  for (const [i, f] of 名.entries()) {
    const 終わり = i + 1 < 名.length ? 名[i + 1].at : src.length
    if (src.slice(f.at, 終わり).includes('className="export-overlay"')) 出す.push(f.name)
  }
  return 出す
}

describe('覆いは Escape で閉じる', () => {
  const ファイル = readdirSync(DIR).filter((f) => f.endsWith('.tsx'))

  it('**Escape を見ていない覆いが無い**（外すなら、この試験に理由を書く）', () => {
    const 抜け: string[] = []
    for (const f of ファイル) {
      const src = readFileSync(join(DIR, f), 'utf8')
      const 名 = [...src.matchAll(/export function (\w+)/g)].map((m) => ({
        name: m[1],
        at: m.index ?? 0
      }))
      for (const [i, fn] of 名.entries()) {
        const 終わり = i + 1 < 名.length ? 名[i + 1].at : src.length
        const 本体 = src.slice(fn.at, 終わり)
        if (!本体.includes('className="export-overlay"')) continue
        if (除外[fn.name]) continue
        if (!本体.includes('useEscClose')) 抜け.push(`${f}  ${fn.name}`)
      }
    }
    expect(
      抜け,
      '覆いを出しているのに Escape を見ていない:\n' +
        抜け.join('\n') +
        '\n\n`useEscClose(onClose)` を呼ぶか、外す理由をこの試験の「除外」に書くこと'
    ).toEqual([])
  })

  it('**除外の名簿が腐っていない**（消えた部品が残り続けない）', () => {
    const 全部 = ファイル.flatMap((f) => 覆いを出す部品(readFileSync(join(DIR, f), 'utf8')))
    const 幽霊 = Object.keys(除外).filter((n) => !全部.includes(n))
    expect(幽霊, `もう無い部品が除外に残っている: ${幽霊.join(' / ')}`).toEqual([])
  })

  it('覆いは1つ以上ある（探し方が壊れたら気づく）', () => {
    const 全部 = ファイル.flatMap((f) => 覆いを出す部品(readFileSync(join(DIR, f), 'utf8')))
    expect(全部.length).toBeGreaterThanOrEqual(5)
  })
})
