import { describe, it, expect } from 'vitest'
import {
  comboFromEvent,
  isSlider,
  isTypingTarget,
  resolveShortcut,
  shouldBlur,
  type KeyState
} from './keymap'

const SHORTCUTS = {
  del: 'd',
  rippleDel: 'f',
  undo: 'ctrl+z',
  redo: 'ctrl+y',
  playPause: 'space',
  split: 'ctrl+k',
  saveProject: 'ctrl+s'
}
const state = (over: Partial<KeyState> = {}): KeyState => ({
  shortcuts: SHORTCUTS,
  capturing: false,
  exporting: false,
  modalOpen: false,
  ...over
})
const key = (k: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({ key: k, ...mods }) as KeyboardEvent

describe('押されたキーの形', () => {
  it('修飾キーは ctrl+alt+shift の順に並べる', () => {
    expect(comboFromEvent(key('K', { ctrlKey: true, shiftKey: true }))).toBe('ctrl+shift+k')
    expect(comboFromEvent(key('z', { ctrlKey: true }))).toBe('ctrl+z')
  })
  it('スペースは space', () => {
    expect(comboFromEvent(key(' '))).toBe('space')
  })
  it('修飾キーそのものは操作にしない', () => {
    expect(comboFromEvent(key('Shift', { shiftKey: true }))).toBe('')
  })
  it('Mac の Cmd は Ctrl と同じ扱い', () => {
    expect(comboFromEvent(key('z', { metaKey: true }))).toBe('ctrl+z')
  })
})

describe('文字を打っている最中は通さない', () => {
  it('入力欄・テキスト欄・選択欄では効かない', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(resolveShortcut(key('d'), { tag }, state())).toBeNull()
    }
  })

  it('報告された不具合: つまみは文字を打つ欄ではないので、ショートカットが効く', () => {
    // 音量つまみを触った直後にスペースを押しても再生できなかった
    const t = { tag: 'INPUT', type: 'range' }
    expect(isSlider(t)).toBe(true)
    expect(isTypingTarget(t)).toBe(false)
    expect(resolveShortcut(key(' '), t, state())).toBe('playPause')
  })

  it('つまみやボタンで受けたら、フォーカスは手放す（次のキーも吸われ続けないように）', () => {
    expect(shouldBlur({ tag: 'INPUT', type: 'range' })).toBe(true)
    expect(shouldBlur({ tag: 'BUTTON' })).toBe(true)
    expect(shouldBlur({ tag: 'DIV' })).toBe(false)
  })
})

describe('文字を打っている最中でも保存だけは通す', () => {
  const ctrlS = key('s', { ctrlKey: true })

  it('報告された不具合: 数値欄に値を入れた直後でも Ctrl+S で保存できる', () => {
    // モーションタブの数値欄で Enter → そのまま Ctrl+S が効かず、
    // 欄の外をクリックしてからでないと保存できなかった
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(resolveShortcut(ctrlS, { tag, type: 'number' }, state())).toBe('saveProject')
    }
  })

  it('元に戻す・やり直しは通さない（欄の中の取り消しと衝突する）', () => {
    const t = { tag: 'INPUT', type: 'number' }
    expect(resolveShortcut(key('z', { ctrlKey: true }), t, state())).toBeNull()
    expect(resolveShortcut(key('y', { ctrlKey: true }), t, state())).toBeNull()
    expect(resolveShortcut(key('z', { ctrlKey: true, shiftKey: true }), t, state())).toBeNull()
  })

  it('削除・再生・分割も、これまでどおり通さない', () => {
    const t = { tag: 'INPUT', type: 'text' }
    expect(resolveShortcut(key('d'), t, state())).toBeNull()
    expect(resolveShortcut(key('Delete'), t, state())).toBeNull()
    expect(resolveShortcut(key(' '), t, state())).toBeNull()
    expect(resolveShortcut(key('k', { ctrlKey: true }), t, state())).toBeNull()
  })

  it('保存で受けても、フォーカスは欄に残す（続きが打てなくなるので）', () => {
    expect(shouldBlur({ tag: 'INPUT', type: 'number' })).toBe(false)
    expect(shouldBlur({ tag: 'TEXTAREA' })).toBe(false)
  })

  it('保存を「s」に割り当て直したら通さない（打った文字が保存になってしまう）', () => {
    const s = state({ shortcuts: { ...SHORTCUTS, saveProject: 's' } })
    expect(resolveShortcut(key('s'), { tag: 'INPUT', type: 'text' }, s)).toBeNull()
    // 欄の外では、これまでどおり効く
    expect(resolveShortcut(key('s'), {}, s)).toBe('saveProject')
  })

  it('変換の途中では保存しない（確定していない文字が入らないまま保存される）', () => {
    const t = { tag: 'INPUT', type: 'text' }
    expect(resolveShortcut(key('s', { ctrlKey: true, isComposing: true }), t, state())).toBeNull()
  })

  it('ダイアログを開いている間は、入力欄の保存も通さない', () => {
    const t = { tag: 'INPUT', type: 'number' }
    expect(resolveShortcut(ctrlS, t, state({ modalOpen: true }))).toBeNull()
    expect(resolveShortcut(ctrlS, t, state({ capturing: true }))).toBeNull()
    expect(resolveShortcut(ctrlS, t, state({ exporting: true }))).toBeNull()
  })
})

describe('何かを開いている間', () => {
  it('ダイアログ中は Esc だけ通す', () => {
    const s = state({ modalOpen: true })
    expect(resolveShortcut(key('d'), {}, s)).toBeNull()
    // Esc は通る（割り当てが無ければ null だが、止められてはいない）
    expect(resolveShortcut(key('Escape'), {}, { ...s, shortcuts: { esc: 'escape' } })).toBe('esc')
  })
  it('キー割当中・書き出し中は何も通さない', () => {
    expect(resolveShortcut(key('d'), {}, state({ capturing: true }))).toBeNull()
    expect(resolveShortcut(key('d'), {}, state({ exporting: true }))).toBeNull()
  })
})

describe('別名', () => {
  it('Backspace は Delete として扱う', () => {
    expect(resolveShortcut(key('Backspace'), {}, state())).toBe('del')
    expect(resolveShortcut(key('Delete'), {}, state())).toBe('del')
  })
  it('Shift+Delete は「消して詰める」', () => {
    expect(resolveShortcut(key('Delete', { shiftKey: true }), {}, state())).toBe('rippleDel')
    expect(resolveShortcut(key('Backspace', { shiftKey: true }), {}, state())).toBe('rippleDel')
  })
  it('Ctrl+Shift+Z もやり直し', () => {
    expect(resolveShortcut(key('z', { ctrlKey: true, shiftKey: true }), {}, state())).toBe('redo')
  })
  it('割り当ててあるキーが優先（別名に食われない）', () => {
    const s = state({ shortcuts: { ...SHORTCUTS, myAction: 'delete' } })
    expect(resolveShortcut(key('Delete'), {}, s)).toBe('myAction')
  })
})

describe('割り当ての通り', () => {
  it('割り当てたキーで、その操作が返る', () => {
    expect(resolveShortcut(key('d'), {}, state())).toBe('del')
    expect(resolveShortcut(key('f'), {}, state())).toBe('rippleDel')
    expect(resolveShortcut(key('k', { ctrlKey: true }), {}, state())).toBe('split')
  })
  it('割り当てが無いキーは何もしない', () => {
    expect(resolveShortcut(key('q'), {}, state())).toBeNull()
  })
})
