// 利用者がいじった物を、更新で消えない場所へファイルとして残す（画面側の担当）。
//
// 規則そのものは shared/userStore にある（画面を持たない側からも試せるように）。
// ここは localStorage との出し入れと、書く間隔だけを持つ。

import {
  changed,
  keysToRestore,
  pickUserData
} from '../../../shared/userStore'

/** いまの保存領域を、素の連想配列にする */
function snapshot(): Record<string, string> {
  const all: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k == null) continue
      const v = localStorage.getItem(k)
      if (v != null) all[k] = v
    }
  } catch {
    /* 使えない環境では何もしない */
  }
  return pickUserData(all)
}

/**
 * ファイルから戻す。**画面を作る前に済ませること。**
 *
 * 設定はどれも「最初に画面を組み立てるとき」に読まれるので、
 * あとから戻しても次に起動するまで効かない（＝「戻したのに反映されない」）。
 */
export async function restoreUserStore(): Promise<number> {
  try {
    const r = await window.giftcut?.readUserStore?.()
    if (!r?.ok || !r.data) return 0
    const add = keysToRestore(snapshot(), r.data)
    for (const [k, v] of Object.entries(add)) localStorage.setItem(k, v)
    return Object.keys(add).length
  } catch {
    return 0
  }
}

/**
 * 変わったらファイルへ写す。
 *
 * **変わった時だけ書く。** アイコンは画像そのもの（dataURL）を持っているので、
 * 毎回書くとディスクを無駄に叩く。
 */
export function startUserStoreMirror(everyMs = 4000): () => void {
  let last = snapshot()
  // 起動直後にも一度書く（初めての人にファイルを作ってあげる）
  void window.giftcut?.writeUserStore?.(last)
  const id = window.setInterval(() => {
    const now = snapshot()
    if (!changed(last, now)) return
    last = now
    void window.giftcut?.writeUserStore?.(now)
  }, everyMs)
  // 閉じる直前にも書く（最後の操作を取りこぼさない）
  const onHide = (): void => {
    const now = snapshot()
    if (changed(last, now)) {
      last = now
      void window.giftcut?.writeUserStore?.(now)
    }
  }
  window.addEventListener('pagehide', onHide)
  return () => {
    window.clearInterval(id)
    window.removeEventListener('pagehide', onHide)
  }
}
