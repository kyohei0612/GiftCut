// 切片の連結の**形**を見る（buildSegmentVideo / buildSegmentAudio）。
//
// ## なぜ形を固定するか（2026-08-09）
//
// 前は concat=n=2 を切片の数だけ直列に繋いでいて、**それが書き出しの遅さの
// 犯人**だった（ffmpeg はコマごとに graph の全ノードを見て回るので、直列が
// 居るだけで全体が道連れになる。tv 基準の実測で、畳むだけで映像側 2.5倍）。
//
// この試験はその「畳んだ形」を固定する——**concat=n=2 の直列に戻ると赤くなる**。
// わざと flush を1本ずつに戻して赤くなることを確認済み（2026-08-09）。
//
// 意味の方（絵が変わらないこと）は、この試験では見ない。そこは
// `npm run e2e` の書き出しの章と `npm run frames` が門番。
import { describe, it, expect } from 'vitest'
import { buildSegmentVideo, buildSegmentAudio, type SegmentsCtx, type SegmentsInput } from './exportSegments'
import type { ExportSeg } from './exportTypes'

const ctx: SegmentsCtx = {
  width: 1280,
  height: 720,
  outFps: 30,
  fpsArg: '30',
  useV: (i) => `[${i}:v]`,
  useA: (i) => `[${i}:a]`,
  ssOffsetOf: () => 0
}

const seg = (srcStart: number, srcEnd: number, xfade?: { type: string; dur: number }): ExportSeg =>
  xfade ? { srcStart, srcEnd, xfade } : { srcStart, srcEnd }

const input = (segs: ExportSeg[]): SegmentsInput => ({
  segs,
  srcInput: [0],
  srcHasAudio: [true],
  audioPresent: true,
  nSrc: 1
})

describe('切片の連結は、連続する concat を1ノードに畳む', () => {
  it('xfade が無ければ、もともと1ノード（従来どおり）', () => {
    const f = buildSegmentVideo(ctx, input([seg(0, 2), seg(2, 4), seg(4, 6)]))
    expect(f).toContain('concat=n=3:v=1:a=0[vcat]')
    expect(f).not.toContain('concat=n=2')
  })

  it('xfade の後の連続する concat が、1ノードに畳まれる', () => {
    // A -(xfade)- B, C, D → xfade 1個 ＋ concat=n=3 が1個
    const f = buildSegmentVideo(
      ctx,
      input([seg(0, 2, { type: 'fade', dur: 0.5 }), seg(2, 4), seg(4, 6), seg(6, 8)])
    )
    expect(f).toContain('[sv0][sv1]xfade=transition=fade:duration=0.500:offset=1.500[vx1]')
    expect(f).toContain('[vx1][sv2][sv3]concat=n=3:v=1:a=0[vcat]')
    expect(f).not.toContain('concat=n=2')
  })

  it('最後が xfade でも、手前の畳みが [vj0] を経て繋がる', () => {
    // A, B, C -(xfade)- D → concat=n=3 で [vj0]、そこから xfade で [vcat]
    const f = buildSegmentVideo(
      ctx,
      input([seg(0, 2), seg(2, 4), seg(4, 6, { type: 'fade', dur: 0.5 }), seg(6, 8)])
    )
    expect(f).toContain('[sv0][sv1][sv2]concat=n=3:v=1:a=0[vj0]')
    // offset = 手前3切片ぶんの累計 6 - 0.5
    expect(f).toContain('[vj0][sv3]xfade=transition=fade:duration=0.500:offset=5.500[vcat]')
    expect(f).not.toContain('concat=n=2')
  })

  it('**どんな並びでも concat=n=2 の直列には戻らない**（それが犯人だった）', () => {
    // xfade を2か所に散らした10切片
    const segs = Array.from({ length: 10 }, (_, i) =>
      i === 2 || i === 6 ? seg(i * 2, i * 2 + 2, { type: 'fade', dur: 0.3 }) : seg(i * 2, i * 2 + 2)
    )
    const f = buildSegmentVideo(ctx, input(segs))
    expect(f).not.toContain('concat=n=2')
    // 接合の数: xfade 2個 ＋ 畳んだ concat 3個（[sv0..sv2] / [vx3→sv3..sv6] / [vx7→sv7..sv9]）
    expect((f.match(/xfade=/g) ?? []).length).toBe(2)
    expect((f.match(/concat=n=\d+:v=1:a=0/g) ?? []).length).toBe(3)
    expect(f).toContain('[vcat]')
  })

  it('音側も同じ畳み（acrossfade ＋ concat 1ノード）', () => {
    const f = buildSegmentAudio(
      ctx,
      input([seg(0, 2, { type: 'fade', dur: 0.5 }), seg(2, 4), seg(4, 6), seg(6, 8)])
    )
    expect(f).toContain('[sa0][sa1]acrossfade=d=0.500[ax1]')
    expect(f).toContain('[ax1][sa2][sa3]concat=n=3:v=0:a=1[acat]')
    expect(f).not.toContain('concat=n=2')
  })

  it('音側・最後が acrossfade でも [aj0] を経て繋がる', () => {
    const f = buildSegmentAudio(
      ctx,
      input([seg(0, 2), seg(2, 4), seg(4, 6, { type: 'fade', dur: 0.5 }), seg(6, 8)])
    )
    expect(f).toContain('[sa0][sa1][sa2]concat=n=3:v=0:a=1[aj0]')
    expect(f).toContain('[aj0][sa3]acrossfade=d=0.500[acat]')
  })
})

// ===========================================================================
// **貼ったばかりのクリップ（素材の頭から始まる）にも掛かること。**
//
// 受け側は本来 srcStart より d 秒手前から流す。手前が無いクリップは長らく
// 「掛けられない」扱いで、`shared/timeline` が実効長を余白で頭打ちにしていた
// ——結果、**後ろに置いた素材へは一度も掛からなかった**（報告:「2秒に設定
// したのに 0.2秒」）。足りないぶんを埋める形に変えたので、ここで形を固定する。
//
// 尺が変わっていないことは ffmpeg で別に確かめてある（`headPadOf` の説明）。
describe('頭の余白が足りない受け側は、足りないぶんを埋めて長さを合わせる', () => {
  it('余白ゼロ: 重なりぶんを丸ごと最初のコマで埋める（映像）', () => {
    // B は 0秒から始まる＝手前が1コマも無い → 0.5秒すべてを埋める
    const f = buildSegmentVideo(ctx, input([seg(0, 2, { type: 'fade', dur: 0.5 }), seg(0, 2)]))
    expect(f).toContain('tpad=start_duration=0.500:start_mode=clone')
    expect(f).toContain('[sv0][sv1]xfade=transition=fade:duration=0.500:offset=1.500[vcat]')
  })

  it('余白が少しだけ: 足りないぶんだけ埋める（0.5 − 0.2 ＝ 0.3秒）', () => {
    const f = buildSegmentVideo(ctx, input([seg(0, 2, { type: 'fade', dur: 0.5 }), seg(0.2, 2)]))
    expect(f).toContain('tpad=start_duration=0.300:start_mode=clone')
  })

  it('速度が付いていたら、素材の余白は速度で割ってから引く（2倍速）', () => {
    // srcStart 0.4 の素材を2倍速＝タイムラインで 0.2秒ぶんしか手前が無い
    const f = buildSegmentVideo(
      ctx,
      input([seg(0, 2, { type: 'fade', dur: 0.5 }), { srcStart: 0.4, srcEnd: 4, speed: 2 }])
    )
    expect(f).toContain('tpad=start_duration=0.300:start_mode=clone')
  })

  it('余白が足りていれば、埋めない（従来どおり）', () => {
    const f = buildSegmentVideo(ctx, input([seg(0, 2, { type: 'fade', dur: 0.5 }), seg(5, 7)]))
    expect(f).not.toContain('tpad=')
  })

  it('音側も同じ長さだけ無音で埋める（埋め忘れると絵と音がズレる）', () => {
    const f = buildSegmentAudio(ctx, input([seg(0, 2, { type: 'fade', dur: 0.5 }), seg(0, 2)]))
    expect(f).toContain('adelay=500:all=1')
    // 埋めるのは atempo の後（タイムライン秒で数える）・afade の前（st=0 が埋めた頭を指す）
    expect(f).toMatch(/asetpts=PTS-STARTPTS,adelay=500:all=1/)
  })

  it('音側も、余白が足りていれば埋めない', () => {
    const f = buildSegmentAudio(ctx, input([seg(0, 2, { type: 'fade', dur: 0.5 }), seg(5, 7)]))
    expect(f).not.toContain('adelay=')
  })
})
