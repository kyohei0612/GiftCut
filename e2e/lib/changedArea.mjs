// --changed: いま直している所に関わる確認だけを回す。
//
// ## なぜ要るか
//
// 通しは12分かかる。かといって毎回 --only を手で書くと、**書き忘れた所を
// 見ないまま「通った」ことにしてしまう**。変更したファイルから、見るべき確認を引く。
//
// ## 対応表に無いファイルは「分からない」と正直に出す
//
// 黙って少しだけ回して「全部通った」と読めてしまうのが一番まずい
//（それで14件を見落としたことがある）。
//
// **ファイルを増やしたら、この表にも足すこと。** 足し忘れても赤くはならない
//（そういう検査は作れていない）ので、ここだけは人が気をつける。
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')


// --changed: いま直している所に関わる確認だけを回す。
//
// 通しは長い。かといって毎回 --only を手で書くと、書き忘れた所を見ないまま進む。
// 変更したファイルから、見るべき確認を引く。
//
// **対応表に無いファイルは「分からない」と正直に出す。** 黙って少しだけ回して
// 「全部通った」と読めてしまうのが一番まずい（今日それで14件を見落としていた）。
export const AREA = [
  { re: /components\/PanelChrome/, words: ['タブ', '別ウィンドウ', 'パネル'] },
  { re: /src\/main\/index\.ts/, words: ['別ウィンドウ', '保存', '書き出し', '起動'] },
  { re: /shared\/timeline/, words: ['動かす', '削除', '元に戻す', '空き'] },
  { re: /shared\/silenceCut/, words: ['無音'] },
  { re: /shared\/keyframes|shared\/clipMotion/, words: ['モーション', '動き'] },
  // キーの受け方は章を問わず効いてくる。中でも「文字を打つ欄にいても保存は通す」を
  // 見るのはモーション（数値欄に入れた直後に保存する）なので、そこも引く。
  { re: /shared\/keymap/, words: ['ショートカット', 'キー', '保存', '動き'] },
  { re: /shared\/ducking/, words: ['ダッキング', '音'] },
  { re: /shared\/filterGraph/, words: ['書き出し', '音'] },
  { re: /lib\/srt/, words: ['字幕', 'テロップ'] },
  { re: /components\/StylePanel/, words: ['テロップ', '見た目'] },
  { re: /shared\/projectPack|main\/zip/, words: ['持ち出し', 'まとめ', '受け取っ'] },
  { re: /shared\/mediaBin/, words: ['素材', 'ビン'] },
  { re: /shared\/windowBounds/, words: ['起動'] },
  { re: /main\/updater|shared\/updatePolicy/, words: ['更新'] },
  { re: /e2e\/run\.mjs/, words: [] } // 確認そのものの変更。これだけでは何も選ばない
]
export function changedKeywords() {
  const out = { words: new Set(), unknown: [] }
  let files = []
  try {
    const a = execSync('git diff --name-only HEAD', { cwd: ROOT }).toString()
    const b = execSync('git ls-files --others --exclude-standard', { cwd: ROOT }).toString()
    files = (a + b)
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return { words: new Set(), unknown: ['（git が読めなかった）'] }
  }
  for (const f of files) {
    const hit = AREA.find((a) => a.re.test(f))
    if (hit) hit.words.forEach((w) => out.words.add(w))
    else out.unknown.push(f)
  }
  return out
}
