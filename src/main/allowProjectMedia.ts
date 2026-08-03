// プロジェクトが指している素材を、画面へ配ってよいか判断して許可する。
//
// ## なぜ独立したファイルなのか
//
// 元は `projectFiles.ts` の中の**ローカル定義**で、しかも「テンプレートの置き場」と
// 「テンプレートの一覧」の**間に挟まっていた**（2026-08-03 まで）。
// 配信を許すかどうか＝安全に関わる判断が、**外から名前が見えない場所**に居た。
//
// 呼ぶのは4か所——プロジェクトを開く／下書きを調べる／まとめを開く／雛形を読む。
// **どれも「外から来たファイルを画面に見せる」入口**なので、判断は1か所に置く。
//
// ## 何を許すか
//
// **拡張子が合っていて、実在する物だけ。** パスをそのまま信じない
//（画面側の不具合や細工で、関係ないファイルを読ませる穴になる）。
//
// ## 同梱 SE だけ特別扱いする理由
//
// アプリに同梱した効果音は、**インストール先が変わると置き場も変わる**。
// 保存してあるパスは前のPCの物なので、無ければ今の置き場へ繋ぎ直す。
// `data` ごと書き換えるので、画面側もそのまま新しいパスを受け取る。
import { existsSync } from 'fs'
import { allowFile } from './allowList'
import { relinkBundled, seRoots } from './assetRoots'

/**
 * プロジェクトの中の素材を配信許可する。**戻り値は「元の動画が生きているか」。**
 *
 * 副作用が2つある（呼ぶ側がそれを当てにしている）:
 *   - 許した物を `allowFile` に登録する
 *   - 同梱 SE のパスを、いまの置き場へ書き換える（`data` を直に触る）
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const allowProjectMedia = (data: any): boolean => {
  let videoExists = false
  if (data && typeof data.videoPath === 'string' && data.videoPath) {
    const okExt = /\.(mp4|mov|mkv|webm|avi)$/i.test(data.videoPath)
    videoExists = okExt && existsSync(data.videoPath)
    if (videoExists) allowFile(data.videoPath)
  }
  if (data && Array.isArray(data.seClips)) {
    const roots = seRoots()
    for (const s of data.seClips) {
      if (!s || typeof s.path !== 'string' || !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(s.path)) continue
      // **同梱 SE は置き場が毎回変わる**ので、無ければ今の置き場へ繋ぎ直す。
      // data ごと書き換えるので、画面側もそのまま新しいパスを受け取る。
      s.path = relinkBundled(s.path, 'SE', roots)
      if (existsSync(s.path)) allowFile(s.path)
    }
  }
  // マルチソースの追加動画も配信許可（動画拡張子のみ）
  if (data && Array.isArray(data.sources)) {
    for (const s of data.sources) {
      if (s && typeof s.path === 'string' && /\.(mp4|mov|mkv|webm|avi)$/i.test(s.path) && existsSync(s.path))
        allowFile(s.path)
    }
  }
  // 映像レイヤークリップの動画も配信許可（動画拡張子のみ）
  if (data && Array.isArray(data.vClips)) {
    for (const c of data.vClips) {
      if (c && typeof c.path === 'string' && /\.(mp4|mov|mkv|webm|avi)$/i.test(c.path) && existsSync(c.path))
        allowFile(c.path)
    }
  }
  // 画像クリップも配信許可（画像拡張子のみ）
  if (data && Array.isArray(data.imgClips)) {
    for (const c of data.imgClips) {
      if (c && typeof c.path === 'string' && /\.(png|jpe?g|gif|webp)$/i.test(c.path) && existsSync(c.path))
        allowFile(c.path)
    }
  }
  // テンプレートのメディアビン（動画/音声/画像）も配信許可
  if (data && Array.isArray(data.mediaItems)) {
    for (const m of data.mediaItems) {
      if (
        m &&
        typeof m.path === 'string' &&
        /\.(mp4|mov|mkv|webm|avi|mp3|wav|m4a|aac|ogg|flac|png|jpe?g|gif|webp)$/i.test(m.path) &&
        existsSync(m.path)
      )
        allowFile(m.path)
    }
  }
  return videoExists
}
