// **JS だけ差し替える更新（bundle）。** インストーラを走らせずに新しくする。
//
// ## 何を短くするか
//
//   いままで   落とす 1.2MB → **インストーラが 263MB を書き直す**（十数秒）→ 開き直す
//   ここ       落とす 360KB → **userData に展開する**（一瞬）→ 開き直す
//
// ※ 落とす量ではない。差分ダウンロードは元から効いていた（`引き継ぎ-差分更新.md`）。
//   潰したいのは**書き直す時間**。
//
// ## 使えないときは、黙っていままでの道へ
//
// 差し替えが使えないのは**普通に起きること**（Electron を上げた版・ffmpeg を
// 差し替えた版では、そもそも荷札を出さない）。そういう版はインストーラで更新する。
// **落ちるべきなのは「使えないのに使った」場合だけ。**
//
// ## 壊れたときに戻れること（ここが本体）
//
//   1  展開して `current.json` に `verified: false` で印を書く
//   2  次の起動で `boot.js` が**1回だけ**試す（試した印を残してから）
//   3  無事に画面が出たら `verified: true`（ここ・`markVerified`）
//   4  印が無いまま2回目に来たら＝**前回起動できなかった**。捨てて同梱へ
//
// 判断は `bootGate.js`（試験付き）。ここはファイルと通信を担当する。
import { app } from 'electron'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import https from 'node:https'
import { extractZip } from './zip'
import { logUpdate } from './updateLog'
import { bundleAssetNames, canStage, parseManifest } from '../shared/bundleManifest'
import { releaseAssetUrl } from '../shared/releaseHost'

/**
 * **読み込み係が下ろしてきた値。**
 *
 * 自分で調べ直さない（`__dirname` を見る等）。判断が2か所になると、
 * 片方だけ直した日に**正しい差し替えまで捨てられる**——しかも
 * 「毎回インストーラで更新される」だけなので、誰も気づかない。
 *
 * 開発中（`npm run dev`）は読み込み係を通らないので空になる。そのときは何もしない。
 */
export interface BootInfo {
  fingerprint: string
  builtInVersion: string
  /** 差し替えで動いているなら、その版 */
  bundleVersion: string
  bundleRoot: string
}

export function bootInfo(): BootInfo | null {
  const fingerprint = process.env.GIFTCUT_FINGERPRINT ?? ''
  const builtInVersion = process.env.GIFTCUT_BUILTIN_VERSION ?? ''
  if (!fingerprint || !builtInVersion) return null
  return {
    fingerprint,
    builtInVersion,
    bundleVersion: process.env.GIFTCUT_BUNDLE_VERSION ?? '',
    bundleRoot: process.env.GIFTCUT_BUNDLE_ROOT || join(app.getPath('userData'), 'bundle')
  }
}

/**
 * **いま動いているコードの版。**
 *
 * 差し替えで動いていると `app.getVersion()` は**同梱の版**（＝インストーラが
 * 入れた exe の版）を返すので、そのまま使うと更新を毎回やり直す。
 */
export function runningVersion(): string {
  return bootInfo()?.bundleVersion || app.getVersion()
}

/** 中身を丸ごと取る。GitHub の添付は別のホストへ飛ばされるので、転送に付いていく */
function get(url: string, left = 5): Promise<Buffer> {
  return new Promise((res, rej) => {
    https
      .get(url, { headers: { 'User-Agent': 'GiftCut' } }, (r) => {
        const code = r.statusCode ?? 0
        if (code >= 300 && code < 400 && r.headers.location) {
          r.resume()
          if (left <= 0) return rej(new Error('転送が多すぎます'))
          return res(get(new URL(r.headers.location, url).toString(), left - 1))
        }
        if (code !== 200) {
          r.resume()
          return rej(new Error(`HTTP ${code}`))
        }
        const parts: Buffer[] = []
        r.on('data', (c: Buffer) => parts.push(c))
        r.on('end', () => res(Buffer.concat(parts)))
        r.on('error', rej)
      })
      .on('error', rej)
  })
}

/**
 * その版の差し替えを置く。**置けたら true**（＝次の起動で新しくなる）。
 *
 * 置けなかったときは false を返すだけで、例外を投げない。
 * 呼ぶ側はいままでどおりインストーラの道へ進む。
 */
export async function stageBundle(version: string): Promise<boolean> {
  const info = bootInfo()
  if (!info) return false

  const names = bundleAssetNames(version)
  let manifest = null
  try {
    manifest = parseManifest((await get(releaseAssetUrl(version, names.json))).toString('utf8'))
  } catch {
    // 荷札が無い（404）＝差し替えを出していない版。**普通のこと**
  }

  const verdict = canStage(manifest, version, info.fingerprint)
  if (!verdict.ok || !manifest) {
    logUpdate(`差し替えは使わない: ${verdict.reason}`)
    return false
  }
  logUpdate(`差し替えで更新する: ${verdict.reason}`)

  const root = info.bundleRoot
  const work = join(root, `incoming-${version}`)
  const zipPath = `${work}.zip`
  const dest = join(root, version)
  try {
    mkdirSync(root, { recursive: true })
    rmSync(work, { recursive: true, force: true })

    const zip = await get(releaseAssetUrl(version, names.zip))
    // **中身を確かめてから展開する。** 途切れた物・差し替えられた物を展開すると、
    // 起動できない版を掴んで1回ぶん無駄に落ちる
    const got = createHash('sha512').update(zip).digest('base64')
    if (got !== manifest.sha512) throw new Error('中身が荷札と合いません')
    if (zip.length !== manifest.size) throw new Error(`大きさが違います（${zip.length}）`)

    writeFileSync(zipPath, zip)
    await extractZip(zipPath, work)
    rmSync(zipPath, { force: true })

    // **入口が無ければ置かない。** 置くと、起動に1回失敗してから捨てることになる
    if (!existsSync(join(work, 'main', 'index.js'))) throw new Error('入口がありません')

    rmSync(dest, { recursive: true, force: true })
    renameSync(work, dest)

    // **印は最後。** 先に書くと、展開に失敗した中途半端な物を読みに行く
    writeFileSync(
      join(root, 'current.json'),
      JSON.stringify({
        version,
        fingerprint: info.fingerprint,
        verified: false,
        tried: 0
      }),
      'utf8'
    )
    logUpdate(`差し替えを置いた v${version}（${Math.round(zip.length / 1024)} KB）`)
    return true
  } catch (e) {
    logUpdate(`差し替えを置けなかったので、いままでの道で更新する: ${e}`)
    try {
      rmSync(work, { recursive: true, force: true })
      rmSync(zipPath, { force: true })
    } catch {
      /* 片付けられなくても、印を書いていないので読まれない */
    }
    return false
  }
}

/**
 * **無事に起動できたことを記録する。**
 *
 * これが書かれないと、次の起動で `boot.js` が「前回起動できなかった」と見なして
 * 差し替えを捨て、同梱へ戻す。**書く側ではなく消す側に倒してある**ので、
 * 電源断・強制終了で書けなかった場合も安全側（同梱）へ落ちる。
 *
 * 呼ぶのは**画面が出てから**。読み込めた時点で呼ぶと、
 * 「起動はするが画面が真っ白」を確認済みにしてしまう。
 */
export function markVerified(): void {
  const info = bootInfo()
  if (!info?.bundleVersion) return
  const p = join(info.bundleRoot, 'current.json')
  try {
    const state = JSON.parse(readFileSync(p, 'utf8'))
    if (state.version !== info.bundleVersion || state.verified === true) return
    writeFileSync(p, JSON.stringify({ ...state, verified: true, tried: 0 }), 'utf8')
    logUpdate(`差し替え v${info.bundleVersion} は無事に起動できた`)
  } catch {
    /* 書けなくても動く。次の起動で同梱へ戻るだけ */
  }
}

/**
 * 使っていない置き場を片付ける（更新のたびに溜まるため）。
 *
 * **残すのは2つ。** いま動いている版と、`current.json` が指している版。
 * 動いている版だけを残すと、**さっき置いたばかりの次の版を消してしまう**
 * （置いた直後はまだ同梱で動いているので、次の版は「使っていない」に見える）。
 */
export function cleanOtherBundles(): void {
  const info = bootInfo()
  if (!info) return
  const keep = new Set([info.bundleVersion])
  try {
    const state = JSON.parse(readFileSync(join(info.bundleRoot, 'current.json'), 'utf8'))
    if (typeof state?.version === 'string') keep.add(state.version)
  } catch {
    /* 印が無ければ、動いている版だけ残す */
  }
  try {
    for (const e of readdirSync(info.bundleRoot, { withFileTypes: true })) {
      if (!e.isDirectory() || keep.has(e.name)) continue
      rmSync(join(info.bundleRoot, e.name), { recursive: true, force: true })
    }
  } catch {
    /* 置き場が無ければ片付ける物も無い */
  }
}
