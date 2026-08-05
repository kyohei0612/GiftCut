// 報告文の組み立て。**入れない物が入っていないこと**が本題。

import { describe, it, expect } from 'vitest'
import { buildBody, issueUrl, summarize, type CrashInfo } from './crashReport'

const info: CrashInfo = {
  crashed: true,
  last: { at: '2026-08-05T12:00:00.000Z', version: '0.1.24', platform: 'win32' },
  entries: [
    {
      at: '2026-08-05T11:59:58.000Z',
      kind: 'render-process-gone',
      detail: 'oom\n  at f (C:\\Users\\<利用者>\\GiftCut\\out\\main\\index.js:1:1)'
    }
  ]
}

describe('本人に見せる一言', () => {
  it('落ちていなければ何も言わない', () => {
    expect(summarize({ crashed: false, entries: [] })).toBe('')
  })

  it('何が起きたかを言う（「落ちました」だけにしない）', () => {
    expect(summarize(info)).toContain('画面が落ちた')
  })

  // **記録が無い方がむしろ重い。**「軽い」と読ませないこと
  it('記録が無いときは、強制終了や電源断の可能性を言う', () => {
    const s = summarize({ crashed: true, last: info.last, entries: [] })
    expect(s).toContain('記録が残っていない')
    expect(s).toMatch(/強制終了|電源断|メモリ/)
  })
})

describe('issue の本文', () => {
  const body = buildBody(info, '0.1.24')

  it('版と OS と時刻が入る（無いと再現できない）', () => {
    expect(body).toContain('v0.1.24')
    expect(body).toContain('win32')
    expect(body).toContain('2026-08-05T12:00:00.000Z')
  })

  it('本人が書く欄が**先頭**にある（自動の情報で埋もれさせない）', () => {
    expect(body.indexOf('何をしていたとき')).toBeLessThan(body.indexOf('自動で入った情報'))
  })

  it('**何を入れていないかを本文に書く**（読む人が安心して送れる）', () => {
    expect(body).toContain('プロジェクトの中身')
    expect(body).toContain('利用者名は伏せて')
  })

  it('記録が無くても本文は成立する', () => {
    const b = buildBody({ crashed: true, entries: [] }, '0.1.24')
    expect(b).toContain('記録は残っていません')
  })

  // **1件で埋め尽くさない。** 古い記録まで全部入れると URL の上限に当たって
  // 途中で切れた本文で開く（開かないのではなく、切れて開くのがたちが悪い）
  it('記録は多くても5件まで', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      at: `2026-08-05T00:00:0${i}.000Z`,
      kind: 'renderer-error',
      detail: `err${i}`
    }))
    const b = buildBody({ crashed: true, entries: many }, '0.1.24')
    expect(b).toContain('err0')
    expect(b).toContain('err4')
    expect(b).not.toContain('err5')
  })
})

describe('issue を開く URL', () => {
  it('置き場と表題が入る', () => {
    const u = issueUrl(info, '0.1.24', 'kyohei0612/GiftCut')
    expect(u.startsWith('https://github.com/kyohei0612/GiftCut/issues/new')).toBe(true)
    expect(decodeURIComponent(u)).toContain('落ちました（v0.1.24）')
  })

  // URL には実質の上限がある。**超えると途中で切れた本文で開く**
  it('長すぎる記録でも URL が膨らみ切らない', () => {
    const huge = {
      crashed: true,
      entries: Array.from({ length: 5 }, () => ({
        at: '2026-08-05T00:00:00.000Z',
        kind: 'renderer-error',
        detail: 'x'.repeat(5000)
      }))
    }
    expect(issueUrl(huge, '0.1.24', 'a/b').length).toBeLessThan(20000)
  })
})
