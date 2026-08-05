// キーボードショートカットの割り当て。
//
// ## なぜ画面から出すか
//
// **どのキーが何をするかは、画面を起動しなくても読めるべき物。**
// 既定の割り当て・環境設定に並べる一覧・見やすい表記への直し方は、
// どれも画面の都合と関係がない。App.tsx に置いておくと、キーを1つ足すのに
// 1万行のファイルを開くことになる。
//
// キーを受けるかどうかの判定（文字を打っている最中は通さない等）は
// shared/keymap にある。ここは「割り当て表」だけを持つ。

/**
 * 既定の割り当て。
 *
 * **Premiere に合わせてある所は、合わせた理由を消さないこと。**
 */
export const DEFAULT_SHORTCUTS = {
  toolSelect: 'v',
  toolRazor: 'c',
  toggleSnap: 's',
  playPause: 'space',
  shuttleFwd: 'l',
  shuttleStop: 'k',
  shuttleRev: 'j',
  gotoStart: 'home',
  gotoEnd: 'end',
  frameBack: 'arrowleft',
  frameFwd: 'arrowright',
  frameBack5: 'shift+arrowleft',
  frameFwd5: 'shift+arrowright',
  del: 'd',
  rippleDel: 'f',
  attrCopy: 'ctrl+alt+c',
  attrPaste: 'ctrl+alt+v',
  // Premiere 準拠: Q=リップルトリム前方 / W=リップルトリム後方。
  // 以前は A / F だったが、Premiere の A は非破壊のトラック選択ツールなので
  // 「押したら映像が削られる」事故になっていた。
  rippleToPrevCut: 'q',
  rippleToNextCut: 'w',
  selectAll: 'ctrl+a',
  deselect: 'escape',
  undo: 'ctrl+z',
  redo: 'ctrl+y',
  copy: 'ctrl+c',
  cut: 'ctrl+x',
  paste: 'ctrl+v',
  duplicate: 'ctrl+d',
  split: 'ctrl+k', // Premiere の「編集点を追加」と同じ
  addTelop: 't',
  addMarker: 'm',
  saveProject: 'ctrl+s',
  openProject: 'ctrl+o',
  exportVideo: 'ctrl+m', // Premiere と同じ「書き出し」
  // Premiere と同じ = / -。**軸は再生ヘッド**——手がマウスに無いので、
  // カーソルを軸にしても狙えない（ホイールはカーソル基準のまま。入口ごとに変えてある）
  zoomIn: '=',
  zoomOut: '-'
}
export type ShortcutId = keyof typeof DEFAULT_SHORTCUTS
export type Shortcuts = Record<ShortcutId, string>

/**
 * 環境設定に並べる一覧。
 *
 * **ここに無い操作は、割り当てを変えられない。** 割り当てを足したら
 * こちらにも足すこと（DEFAULT_SHORTCUTS にだけ足すと、既定のまま固定になる）。
 */
export const ACTION_LIST: { id: ShortcutId; label: string; group: string }[] = [
  { id: 'openProject', label: 'プロジェクトを開く', group: 'ファイル' },
  { id: 'saveProject', label: 'プロジェクトを保存', group: 'ファイル' },
  { id: 'exportVideo', label: '動画を書き出し', group: 'ファイル' },
  { id: 'toolSelect', label: '選択ツール', group: 'ツール' },
  { id: 'toolRazor', label: 'レザーツール', group: 'ツール' },
  { id: 'toggleSnap', label: 'スナップ切替', group: 'ツール' },
  { id: 'playPause', label: '再生 / 一時停止', group: '再生' },
  { id: 'shuttleFwd', label: '早送りシャトル', group: '再生' },
  { id: 'shuttleStop', label: '停止シャトル', group: '再生' },
  { id: 'shuttleRev', label: '逆再生シャトル', group: '再生' },
  { id: 'gotoStart', label: '先頭へ', group: '再生' },
  { id: 'gotoEnd', label: '末尾へ', group: '再生' },
  { id: 'frameBack', label: '1フレーム戻る', group: '再生' },
  { id: 'frameFwd', label: '1フレーム進む', group: '再生' },
  { id: 'frameBack5', label: '5フレーム戻る', group: '再生' },
  { id: 'frameFwd5', label: '5フレーム進む', group: '再生' },
  { id: 'split', label: '再生ヘッドで分割', group: '編集' },
  { id: 'attrCopy', label: '設定をコピー（位置・変形・色など）', group: '編集' },
  { id: 'attrPaste', label: '設定を貼り付け（選んだクリップ全部へ）', group: '編集' },
  { id: 'del', label: '削除（詰めない。Delete / Backspace も同じ）', group: '編集' },
  { id: 'rippleDel', label: '削除して詰める（Shift+Delete も同じ）', group: '編集' },
  { id: 'rippleToPrevCut', label: '前の編集点まで詰めて削除（リップルトリム前方）', group: '編集' },
  { id: 'rippleToNextCut', label: '次の編集点まで詰めて削除（リップルトリム後方）', group: '編集' },
  { id: 'selectAll', label: '全選択', group: '編集' },
  { id: 'deselect', label: '選択解除', group: '編集' },
  { id: 'undo', label: '元に戻す', group: '編集' },
  { id: 'redo', label: 'やり直し', group: '編集' },
  { id: 'copy', label: 'コピー', group: '編集' },
  { id: 'cut', label: '切り取り', group: '編集' },
  { id: 'paste', label: '貼り付け', group: '編集' },
  { id: 'duplicate', label: '複製', group: '編集' },
  { id: 'addTelop', label: 'テロップを追加', group: '編集' },
  { id: 'addMarker', label: 'マーカーを追加', group: '編集' },
  { id: 'zoomIn', label: 'タイムラインを拡大（再生ヘッド基準）', group: '表示' },
  { id: 'zoomOut', label: 'タイムラインを縮小（再生ヘッド基準）', group: '表示' }
]

/**
 * 覚えている割り当ての置き場所。
 *
 * **既定を土台にして上書きする。** 丸ごと差し替えにすると、
 * 新しく足した操作が「割り当て無し」で読み込まれ、押しても何も起きなくなる。
 */
export const SC_KEY = 'giftcut.shortcuts'

/** 保存してある割り当てを読む（壊れていれば既定に戻す） */
export function loadShortcuts(): Shortcuts {
  try {
    return { ...DEFAULT_SHORTCUTS, ...JSON.parse(localStorage.getItem(SC_KEY) || '{}') }
  } catch {
    return { ...DEFAULT_SHORTCUTS }
  }
}

/**
 * コンボを見やすい表記に（"ctrl+z" → "Ctrl+Z"、"arrowleft" → "←"）。
 *
 * 矢印を記号にするのは、環境設定の一覧とボタンの説明の両方で使うため。
 * "arrowleft" のまま出すと、押すキーが分からない。
 */
export function formatCombo(combo: string): string {
  const map: Record<string, string> = {
    ctrl: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
    space: 'Space',
    arrowleft: '←',
    arrowright: '→',
    arrowup: '↑',
    arrowdown: '↓',
    delete: 'Delete',
    backspace: 'Backspace',
    escape: 'Esc',
    home: 'Home',
    end: 'End'
  }
  return combo
    .split('+')
    .map((p) => map[p] ?? p.toUpperCase())
    .join('+')
}
