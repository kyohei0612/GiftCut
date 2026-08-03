// 同梱素材（効果音・テロップの見本）が「いまどこに居るか」。
//
// ## なぜ繋ぎ直しが要るか
//
// 身内用の exe は起動ごとに別の一時フォルダへ展開されるので、プロジェクトに
// 保存されたパスは**その回限り**になる。次に開くとファイルが無い＝音が鳴らない。
// しかも**同梱の素材を使ったときだけ**起きるので原因が見えにくい。
//
// **プロジェクトを開く側（./projectFiles）と、素材を並べる側（./index）の両方が要る**
// ので、ここに置いてある。
import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { relinkBundledPath } from '../shared/relinkBundled'

/**
 * 同梱素材のパスを、いまの置き場へ繋ぎ直す。
 *
 * ## なぜ要るか（実際に起きた壊れ方）
 *
 * 家庭用の exe（portable）は**起動のたびに自分をランダムな一時フォルダへ展開する**。
 * そこに置いた SE を使うと、プロジェクトには
 *
 *     C:/…/Temp/3HBMBwOyIyB8apVvBvy5DY9nFbX/resources/SE/…/ショック①.mp3
 *
 * という**その回限りのパス**が残る。閉じるとそのフォルダは消えるので、
 * 次に開いたときファイルが無い＝音が鳴らない。しかも
 * **同梱の素材を使ったときだけ**起きるので原因が見えにくい。
 *
 * 「SE より後ろの相対部分」さえ合っていれば同じ物なので、いまの置き場から探し直す。
 */
export const relinkBundled = (p: string, folder: 'SE' | 'telop-presets', roots: string[]): string =>
  relinkBundledPath(p, folder, roots, existsSync)

/**
 * 素材の置き場を、**あるものだけ**並べて返す。
 *
 * ## 3か所を必ず全部見る
 *
 *   `appPath`        … 開発中はリポジトリ直下
 *   `resourcesPath`  … **exe 1つで配る版**は、素材を中に同梱する（解凍させないため）
 *   `userData`       … 使う人が自分で入れた物（更新でも消えない）
 *
 * **見つかった1つ目で打ち切ってはいけない。** 同梱ぶんが入っている版で、
 * userData に足した物が永遠に出てこなくなる。
 *
 * ## なぜ1本にまとめてあるか
 *
 * 2026-08-03 まで、同じ並びが **`assetLibrary` の中に3回**書かれていた
 * （効果音・テロップの見本・動きの見本帳）。**そのうち動きの見本帳だけ
 * `resourcesPath` が抜けていて**、exe 1つで配る版では同梱した動きが
 * 1つも出てこなかった。**3回書けば、1回は抜ける。**
 */
export const assetRoots = (folder: string): string[] =>
  [
    join(app.getAppPath(), folder),
    join(process.resourcesPath ?? '', folder),
    join(app.getPath('userData'), folder)
  ].filter((r) => existsSync(r))

/** SE の置き場（se:list と同じ候補） */
export const seRoots = (): string[] => assetRoots('SE')
