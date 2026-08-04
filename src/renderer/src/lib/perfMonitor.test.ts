// 報告が言い当てる「いちばん疑わしいもの」の決まりごと。
//
// **しきい値を勘で動かさないための網。** 報告の言うことが日によって変わると、
// 送ってもらう意味が無くなる（読む側が結局また自分で数字を見ることになる）。
//
// ここで固定しているのは境目そのもの。**根拠は `perfMonitor.ts` の `verdicts` に書いてある。**

import { describe, expect, it } from 'vitest'
import { verdicts, type PerfSample } from './perfMonitor'

/** 何も問題が出ていない1秒（ここから1つだけ崩して、その1つが言い当てられるかを見る） */
const ok = (over: Partial<PerfSample> = {}): PerfSample => ({
  t: 1,
  fps: 60,
  worstFrameMs: 17,
  longTasks: 0,
  longTaskMs: 0,
  renders: 5,
  droppedFrames: 0,
  videoLagMs: 10,
  note: '停止',
  ...over
})

describe('いちばん疑わしいものを言い当てる', () => {
  it('**何も無ければ何も言わない**（無理に犯人を作らない）', () => {
    // 「疑わしい物が必ず1つ出る」形にすると、健康なときの報告まで
    // 何かのせいにしてしまい、本当に出たときに信用されない
    expect(verdicts([ok(), ok(), ok()])).toEqual([])
  })

  it('測っていなければ空（まだ何も分からない、が正しい）', () => {
    expect(verdicts([])).toEqual([])
  })

  it('**主スレッドを塞いでいたら「計算が重い」**（音が切れる直接の原因）', () => {
    const v = verdicts([ok({ longTaskMs: 200 }), ok({ longTaskMs: 200 })])
    expect(v.length).toBe(1)
    expect(v[0]).toContain('計算が重い')
  })

  it('コマを落としていたら「デコードが重い」（画質を下げれば直る類）', () => {
    const v = verdicts([ok({ droppedFrames: 40 })])
    expect(v[0]).toContain('デコードが重い')
  })

  it('作り直しが多ければ「画面の作りが重い」（間引きが効いていない）', () => {
    const v = verdicts([ok({ renders: 58 })])
    expect(v[0]).toContain('画面の作りが重い')
  })

  it('絵が遅れていたら「テロップだけ先に走って見える」と言う', () => {
    // 症状の言葉で書く。**利用者が口にするのはこちら**で、
    // 「videoLag が大きい」では自分の症状と結び付かない
    const v = verdicts([ok({ videoLagMs: 300 })])
    expect(v[0]).toContain('先に走って見える')
  })

  it('**重い順に並べる**（複数出たとき、上から潰せるように）', () => {
    const v = verdicts([ok({ longTaskMs: 500, renders: 50 })])
    expect(v.length).toBe(2)
    expect(v[0]).toContain('計算が重い')
  })

  it('**どれにも当てはまらないのに遅い、を黙らせない**', () => {
    // 2026-08-04 に実際にあった形。重かったのは合成レイヤーの組み直しで、
    // JS でもデコードでも作り直しでもなかった（JS は28秒中2.8秒）。
    // ここで黙ると「測ったが何も出なかった」で終わってしまう
    const v = verdicts([ok({ fps: 12 }), ok({ fps: 14 })])
    expect(v.length).toBe(1)
    expect(v[0]).toContain('描画側')
  })

  it('少し超えたくらいでは言わない（境目のすぐ内側）', () => {
    // うるさい報告は読まれなくなる。境目は `verdicts` の説明に根拠を書いてある
    expect(verdicts([ok({ longTaskMs: 90 })])).toEqual([])
    expect(verdicts([ok({ droppedFrames: 25 })])).toEqual([])
    expect(verdicts([ok({ renders: 40 })])).toEqual([])
    expect(verdicts([ok({ videoLagMs: 90 })])).toEqual([])
  })
})
