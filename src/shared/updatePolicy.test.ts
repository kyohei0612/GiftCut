import { describe, it, expect } from 'vitest'
import { planUpdate } from './updatePolicy'

describe('更新をいつ当てるか', () => {
  // **こちらから再起動を促さない**（2026-08-02 に変更）。
  // 以前は「手が空いていれば5秒後に勝手に再起動」だったが、使う本人からは
  // 毎回いきなり迫られるようにしか見えない。落とすまでは黙ってやり、
  // 当てるのは本人が閉じたとき。
  it('何もしていなくても、こちらから再起動を促さない', () => {
    const p = planUpdate({ dirty: false, exporting: false }, 'v1.2.0')
    expect(p.when).toBe('onQuit')
    expect(p.countdownSec).toBe(0)
    expect(p.message).toContain('v1.2.0')
  })

  it('どの状態でも、勝手に再起動する道は無い', () => {
    for (const s of [
      { dirty: false, exporting: false },
      { dirty: true, exporting: false },
      { dirty: false, exporting: true },
      { dirty: true, exporting: true }
    ]) {
      expect(planUpdate(s).when).toBe('onQuit')
      expect(planUpdate(s).countdownSec).toBe(0)
    }
  })

  it('書き出し中は、待っている理由まで言う', () => {
    expect(planUpdate({ dirty: false, exporting: true }).message).toContain('書き出し中')
  })

  it('未保存のときも、待っている理由まで言う', () => {
    expect(planUpdate({ dirty: true, exporting: false }).message).toContain('保存していない')
  })

  it('いつ新しくなるのかは、どの状態でも必ず伝える', () => {
    for (const s of [
      { dirty: false, exporting: false },
      { dirty: true, exporting: false },
      { dirty: false, exporting: true }
    ]) {
      expect(planUpdate(s).message).toContain('次にアプリを閉じたとき')
    }
  })
})
