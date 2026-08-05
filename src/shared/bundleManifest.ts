// 差し替え（bundle）の**荷札**を読む所。落とす前の判断だけで、通信はしない。
//
// ## なぜ荷札を別に置くか
//
// 差し替えは「その版の JS ひと揃い」なので、**落とす前に断れる**必要がある。
// 落としてから「土台が違う」と分かるのでは、300KB を無駄にするだけでなく、
// **置き場に中途半端な物が残る**。
//
// 荷札（`bundle-<版>.json`・数百バイト）を先に読んで、
//
//   版が合っているか   … 別の版の荷札を掴んでいないか
//   指紋が合っているか … Electron が上がっていたら、その差し替えは使えない
//
// を見てから本体を取りに行く。
//
// ## 「無い」と「壊れている」を分けない
//
// どちらも**同じ扱い**（インストーラで更新する）。差し替えが使えないことは
// 不具合ではなく、**普通に起きること**——ffmpeg を差し替えた版、Electron を
// 上げた版では、そもそも荷札を出さない。
// 落ちるべきなのは「使えないのに使ってしまった」場合だけ。

export interface BundleManifest {
  version: string
  fingerprint: string
  /** ZIP の中身の指紋（base64 の sha512） */
  sha512: string
  size: number
}

/** 版から、Releases に在るはずの差し替えの名前 */
export function bundleAssetNames(version: string): { zip: string; json: string } {
  return { zip: `bundle-${version}.zip`, json: `bundle-${version}.json` }
}

/**
 * 荷札を読む。**形が合わなければ null**（例外にしない——荷札が無いのは普通なので、
 * 呼ぶ側が毎回 try で囲うことになると、本当の失敗まで飲み込みやすくなる）。
 */
export function parseManifest(text: string): BundleManifest | null {
  let o: unknown
  try {
    o = JSON.parse(text)
  } catch {
    return null
  }
  if (!o || typeof o !== 'object') return null
  const m = o as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const version = str(m.version)
  const fingerprint = str(m.fingerprint)
  const sha512 = str(m.sha512)
  const size = typeof m.size === 'number' ? m.size : 0
  if (!version || !fingerprint || !sha512) return null
  // **大きさが 0 の荷札を通さない。** 通すと「0バイト落とした」で成功してしまう
  if (!(size > 0)) return null
  return { version, fingerprint, sha512, size }
}

export interface StageVerdict {
  ok: boolean
  reason: string
}

/**
 * この荷札の差し替えを落としてよいか。
 *
 * @param manifest    読めた荷札（読めなければ null を渡す）
 * @param wantVersion 更新先の版（自動更新が見つけてきた物）
 * @param fingerprint いま動いている土台の指紋
 * @param maxBytes    受け取ってよい大きさの上限
 */
export function canStage(
  manifest: BundleManifest | null,
  wantVersion: string,
  fingerprint: string,
  maxBytes = 64 * 1024 * 1024
): StageVerdict {
  if (!manifest) return { ok: false, reason: '差し替えは出ていない' }
  if (manifest.version !== wantVersion)
    return { ok: false, reason: `版が違う（荷札 ${manifest.version} / 更新先 ${wantVersion}）` }
  if (manifest.fingerprint !== fingerprint)
    return {
      ok: false,
      reason: `土台が違う（荷札 ${manifest.fingerprint} / いま ${fingerprint}）`
    }
  // **上限を置く。** 荷札は外から来るので、桁を間違えた値をそのまま信じない
  if (manifest.size > maxBytes)
    return { ok: false, reason: `大きすぎる（${manifest.size} バイト）` }
  return { ok: true, reason: `差し替えで更新できる（${Math.round(manifest.size / 1024)} KB）` }
}
