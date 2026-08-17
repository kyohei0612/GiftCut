// **「利用者の持ち物」が何かを、1か所で決める。**
//
// プロジェクトの持ち物（動画・SE・画像＝プロジェクトファイルがパスで指している物）と違って、
// こちらは**アプリ側に貯まる**物: 自分で足した効果音、テロップ素材、動きのプリセット、
// テンプレート、そして localStorage の控え（お気に入り・自作スタイル・人物・アイコン）。
//
// 置き場は `%APPDATA%\GiftCut\` の下で、**更新しても消えない**。
// 逆に言うと**別の機械へは自動では付いていかない**ので、持ち出しに要る。
//
// ## なぜ shared に出したか
//
// この一覧は 2026-08-17 まで `main/assetPacks.ts` の中だけにあり、
// **取り込む側しか知らなかった**。持ち出す側（`main/projectPackIpc`）が
// 同じ一覧を書き写すと、片方だけ増えた日に「入れたのに入っていない」になる
// ——足すのは安全・消すのは怖い、の非対称がそのまま重複になる型（CLAUDE.md）。

/** 更新で消えない置き場（ファイルメニューから開ける物）。ZIP でもこの名前のまま入れる */
export const ASSET_FOLDERS = ['SE', 'telop-presets', 'motion-presets', 'テンプレート'] as const

/** localStorage の控え（`shared/userStore` が書く物）。userData の直下 */
export const USER_STORE_FILE = 'ユーザー設定.json'

/** まとめ ZIP の中で、アプリ側の持ち物を置く場所 */
export const SETTINGS_DIR = '設定'

/**
 * 受け取った設定を入れた結果。**約束は1か所にしか書かない**——
 * preload の `index.ts` と `index.d.ts` が両方これを引く（写すと片方だけ古くなる。
 * `main/exportTypes` と同じ理由で、2026-08-06 に一度返済している型）。
 *
 * **`main/` に置くと web 側の型検査が main 一式を引き込む**（`tsconfig.web.json` に
 * 入っていないので即エラー）。約束事は画面にも main にも要るので、ここが置き場。
 */
export interface InstalledSettings {
  /** フォルダごとの件数（SE / telop-presets / …） */
  added: Record<string, number>
  /** 控えから足した鍵の数 */
  keysAdded: number
  /** この機械に既にあって、触らなかった鍵の数 */
  keysKept: number
  error?: string
}

/**
 * 控え（`ユーザー設定.json`）を混ぜる。**受け取った側に在る鍵は触らない。**
 *
 * `shared/userStore` の決まりと同じ向きに倒してある——あちらも
 * 「localStorage に無い鍵だけファイルから戻す」で、**いま使っている方を
 * 勝手に上書きするのが一番危ない**という判断。持ち出しでも同じにする。
 *
 * ＝ **まっさらなサブPCなら丸ごとそのまま入る**（＝渡す前と同じ状態になる）。
 * 既に使っているPCなら、そちらの設定が勝つ（黙って消さない）。
 *
 * どちらだったかは呼ぶ側が言えるように、入れた鍵と残した鍵を返す。
 */
export function mergeUserStore(
  existing: Record<string, string>,
  incoming: Record<string, string>
): { merged: Record<string, string>; added: string[]; kept: string[] } {
  const merged: Record<string, string> = { ...existing }
  const added: string[] = []
  const kept: string[] = []
  for (const [k, v] of Object.entries(incoming ?? {})) {
    if (typeof v !== 'string') continue
    if (Object.prototype.hasOwnProperty.call(merged, k)) kept.push(k)
    else {
      merged[k] = v
      added.push(k)
    }
  }
  return { merged, added, kept }
}
