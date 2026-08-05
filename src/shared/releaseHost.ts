// **配り先（GitHub の Releases）はここが正典。**
//
// 同じ URL を組み立てる所が3つある（差し替えの受け取り／添付の数え上げ／
// 落とす量の見積もり）。書き写すと、置き場所を変えた日に**片方だけ古くなる**。
// しかも古い方は「404 なので差し替えは出ていない」と読めてしまい、
// **黙って普通の更新に落ちる**ので誰も気づかない。
//
// 値が `electron-builder.yml` の `publish:` と一致していることは
// `releaseHost.test.ts` が見る（**両方に書いてあるのは避けられない**——
// electron-builder は自分の設定しか読まないので、突き合わせる方に倒す）。

export const RELEASE_OWNER = 'kyohei0612'
export const RELEASE_REPO = 'GiftCut'

/** 添付ひとつを直接落とす URL */
export function releaseAssetUrl(version: string, name: string): string {
  return `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/download/v${version}/${name}`
}
