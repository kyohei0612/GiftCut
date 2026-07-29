// 押されたキーを「どの操作か」に決めるところ。
//
// **実行はしない。** 何をするかは画面側（App）が持ち、ここは
// 「このキーは受けるのか / 受けるならどの操作か」だけを決める。
// この判断にこそ細かい決まりが溜まっていて、間違えると
// 「打っている文字が削除になる」「つまみを触ったあとスペースで再生できない」
// といった、原因の分かりにくい事故になる。
//
// 決まりごと:
//   - 文字を打つ欄（input/textarea/select）にいる間は、ショートカットを通さない
//   - **ただし、つまみ（input[type=range]）は文字を打つ欄ではない。**
//     ここを一律に止めていたため、音量つまみを触った直後は矢印キーで
//     再生ヘッドではなくつまみが動き、スペースでも再生できなかった
//   - **保存だけは、文字を打つ欄にいても通す**（ALLOW_WHILE_TYPING）。
//     数値欄に値を入れた直後の Ctrl+S が効かず、欄の外をクリックしてからで
//     ないと保存できなかった。保存は打っている文字への操作ではないので、
//     Premiere や一般的なアプリと同じく通してよい
//   - 何かを開いている間（ダイアログ・キー割当中・書き出し中）は Esc だけ通す
//   - Backspace は Delete の別名。Ctrl+Shift+Z は「やり直し」の別名
//   - 削除は2種類:  D / Delete = 消すだけ（空きが残る）
//                   F / Shift+Delete = 消して詰める

export interface KeyState {
  /** 操作 → キーの割り当て */
  shortcuts: Record<string, string>
  /** 環境設定でキーを割り当て中 */
  capturing: boolean
  /** 書き出し中（進行中の処理と混線させない） */
  exporting: boolean
  /** 何かを開いている（Esc だけ通す） */
  modalOpen: boolean
}

/** 押されたキーを "ctrl+shift+z" のような形にする */
export function comboFromEvent(e: {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  const key = e.key === ' ' ? 'space' : e.key.toLowerCase()
  // 修飾キーそのものは操作にしない
  if (key === 'control' || key === 'shift' || key === 'alt' || key === 'meta') return ''
  parts.push(key)
  return parts.join('+')
}

export interface KeyTarget {
  /** フォーカスがある要素の種類（INPUT / TEXTAREA / BUTTON など） */
  tag?: string
  /** INPUT のとき、その type */
  type?: string
}

/** つまみ（音量・拡大など）。文字を打つ欄ではないので、ショートカットを優先する */
export function isSlider(t: KeyTarget): boolean {
  return t.tag === 'INPUT' && t.type === 'range'
}

/** 文字を打っている最中か（ここにいる間はショートカットを通さない） */
export function isTypingTarget(t: KeyTarget): boolean {
  if (isSlider(t)) return false
  return t.tag === 'INPUT' || t.tag === 'TEXTAREA' || t.tag === 'SELECT'
}

/**
 * 文字を打っている最中でも通してよい操作。
 * 入れてよいのは「今打っている文字への操作ではない」ものだけ。
 *   - saveProject: 何を打っていても意味が変わらない。数値欄に値を入れた直後に
 *     そのまま Ctrl+S できないのは、明らかに不便だった
 *   - **undo / redo は入れてはいけない。** 入力欄が持っている「打った文字の
 *     取り消し」と衝突して、打ち直したい1文字ではなくタイムラインの編集が
 *     巻き戻る（しかも取り消したはずの文字は欄に残ったまま）
 *   - del / copy / paste なども同じ理由で入れない
 */
const ALLOW_WHILE_TYPING = new Set(['saveProject'])

/** 修飾キーの無い1文字か（"s" など、打てば文字になってしまう割り当て） */
function isPlainCharacter(combo: string): boolean {
  const parts = combo.split('+')
  const key = parts[parts.length - 1]
  if (parts.includes('ctrl') || parts.includes('alt')) return false
  // "escape" や "f12" のような名前付きキーは文字ではない
  return [...key].length === 1
}

/**
 * その操作を、文字を打っている最中でも通してよいか。
 * combo も見るのは、キー割当を変えられるから。保存を "s" に割り当てた人が
 * テロップに「s」と打っただけで保存が走る、という事故を防ぐ。
 */
export function isAllowedWhileTyping(id: string | null, combo: string): boolean {
  if (!id || !ALLOW_WHILE_TYPING.has(id)) return false
  return !isPlainCharacter(combo)
}

/**
 * このキーをどの操作として扱うか。
 * null = 何もしない（画面側はそのまま通す）。
 */
export function resolveShortcut(
  e: {
    key: string
    ctrlKey?: boolean
    metaKey?: boolean
    altKey?: boolean
    shiftKey?: boolean
    /** かな漢字変換の途中か */
    isComposing?: boolean
  },
  target: KeyTarget,
  state: KeyState
): string | null {
  if (state.capturing) return null
  if (state.exporting) return null
  if (state.modalOpen && e.key !== 'Escape') return null
  // 変換の途中は、まだ確定していない文字が残っている。ここで保存を通すと
  // 「打ったつもりの文字が入っていないファイル」が黙って保存される
  if (e.isComposing) return null

  const combo = comboFromEvent(e)
  if (!combo) return null
  // Backspace は delete の別名として扱う
  const norm = combo.replace(/\bbackspace\b/, 'delete')
  const ids = Object.keys(state.shortcuts)
  let id = ids.find((k) => state.shortcuts[k] === combo || state.shortcuts[k] === norm) ?? null
  if (!id && norm === 'delete') id = 'del'
  if (!id && (combo === 'shift+delete' || combo === 'shift+backspace')) id = 'rippleDel'
  // Ctrl+Shift+Z も「やり直し」の別名（Premiere / 一般的な慣習）
  if (!id && combo === 'ctrl+shift+z') id = 'redo'
  // 文字を打っている最中は、打っている文字への操作でないものだけ通す。
  // どの操作かを決めてから見るのは、キー割当を変えられるから
  // （"ctrl+s" が保存とは限らない）。
  if (isTypingTarget(target) && !isAllowedWhileTyping(id, combo)) return null
  return id
}

/**
 * ショートカットとして処理すると決めたら、フォーカスを手放すべきか。
 * 残したままだと、次のキーもボタンやつまみに吸われ続ける。
 *
 * 文字を打つ欄では手放さない。そこにいるのは打つためなので、
 * 保存したとたんに欄から出されると続きが打てなくなる（一般的なアプリも
 * Ctrl+S でフォーカスを奪わない）。値が消える心配も無い：この欄は
 * 打つたびに反映していて、欄から出るまで保留している値は無い。
 */
export function shouldBlur(target: KeyTarget): boolean {
  return target.tag === 'BUTTON' || isSlider(target)
}
