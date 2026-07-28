import { describe, it, expect } from 'vitest'
import { planUpdate } from './updatePolicy'

describe('更新をいつ当てるか', () => {
  it('何もしていなければ、少し置いて再起動する', () => {
    const p = planUpdate({ dirty: false, exporting: false }, 'v1.2.0')
    expect(p.when).toBe('now')
    expect(p.countdownSec).toBeGreaterThan(0)
    expect(p.message).toContain('v1.2.0')
  })

  it('書き出し中は再起動しない（数十分の変換を巻き添えにしない）', () => {
    const p = planUpdate({ dirty: false, exporting: true })
    expect(p.when).toBe('onQuit')
    expect(p.message).toContain('書き出し中')
  })

  it('未保存の変更があるときは再起動しない', () => {
    const p = planUpdate({ dirty: true, exporting: false })
    expect(p.when).toBe('onQuit')
    expect(p.message).toContain('保存していない')
  })

  it('書き出し中かつ未保存でも、当然待つ', () => {
    expect(planUpdate({ dirty: true, exporting: true }).when).toBe('onQuit')
  })

  it('待つときは、いつ新しくなるのかを必ず伝える', () => {
    for (const s of [
      { dirty: true, exporting: false },
      { dirty: false, exporting: true }
    ]) {
      expect(planUpdate(s).message).toContain('次にアプリを閉じたとき')
    }
  })
})
