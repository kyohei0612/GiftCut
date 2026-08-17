// 「利用者の持ち物」を **ZIP へ詰める／置き場へ入れる** ためのファイル操作。
//
// 何が持ち物かは `shared/userAssets` が決める。ここは**ディスクを触る係**だけ。
//
// ## 入れる側は、必ず戻せるようにする
//
// 途中で失敗して**半端に入った状態が残るのが一番困る**（「取り込めませんでした」と
// 言われたのに一部だけ入っている）。だから書いた物を1つ残らず控えて、
// 失敗したら消す。**元から在った物は上書きしても控えに入れない**——
// 戻すときに、相手の元々の物まで消してしまうため。
//
// ## 2か所から呼ばれる
//
//   素材パック（`assetPacks.ts`）        … 素材だけの ZIP を取り込む
//   まとめプロジェクト（`projectPackIpc`）… 素材＋設定ごと持ち出した ZIP を開く
//
// 元は前者の中に閉じていて、後者を作るときに**写しかけた**。
// 写すと片方だけ直る（CLAUDE.md の「知識が2か所」）ので、出してある。
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'

/** ZIP に詰める1件（`writeZip` がそのまま受け取れる形） */
export interface ZipEntry {
  name: string
  from: string
}

/**
 * フォルダの中身を ZIP の並びにする（入れ子もそのまま）。
 * 無いフォルダは空を返す（**持っていない物は、無くて正常**）。
 */
export function listForZip(dir: string, zipPrefix: string): ZipEntry[] {
  if (!existsSync(dir)) return []
  const out: ZipEntry[] = []
  const walk = (from: string, prefix: string): void => {
    for (const name of readdirSync(from)) {
      const src = join(from, name)
      const st = statSync(src)
      if (st.isDirectory()) walk(src, `${prefix}/${name}`)
      else out.push({ name: `${prefix}/${name}`, from: src })
    }
  }
  walk(dir, zipPrefix)
  return out
}

/**
 * フォルダごと足す（同じ名前は上書き。相手にしか無い物はそのまま残す）。
 * 書いた物は `written` に積む——**戻すときに使う**。
 */
export function mergeDir(from: string, to: string, written: string[]): number {
  let n = 0
  mkdirSync(to, { recursive: true })
  for (const name of readdirSync(from)) {
    const src = join(from, name)
    const dst = join(to, name)
    const st = statSync(src)
    if (st.isDirectory()) n += mergeDir(src, dst, written)
    else {
      // すでに有る物は控えに入れない（戻すときに、相手の物まで消さないため）
      if (!existsSync(dst)) written.push(dst)
      copyFileSync(src, dst)
      n++
    }
  }
  return n
}

/** 入れた物を消して、元の状態へ戻す */
export function rollbackWritten(written: string[]): void {
  for (const f of written) {
    try {
      rmSync(f, { force: true })
    } catch {
      /* 消せない物は残るが、できる限り戻す */
    }
  }
}
