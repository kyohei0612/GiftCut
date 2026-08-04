// 重ねる段の決まりごと。**いちばん怖いのは「絵が黙って変わる」**ので、
// 目で気づけない類だけをここで押さえる。
//
// 実際に起きた壊れ方: `overlay` の色空間を書き忘れると既定の `yuv420` に落ちる。
// 落ちても ffmpeg は何も言わないし、書き出しも成功する。変わるのは**絵だけ**で、
// しかもテロップの縁が数値で 1〜6 ずれる程度なので、見比べても気づけない。

import { describe, expect, it } from 'vitest'
import {
  overlayImages,
  overlayTelopFrames,
  overlayTelopSeqs,
  overlayVideoClips,
  type OverlayCtx
} from './exportOverlays'

const ctx: OverlayCtx = {
  width: 1920,
  height: 1080,
  outFps: 30,
  fpsArg: ',fps=30',
  useV: (i) => `[${i}:v]`,
  ssOffsetOf: () => 0
}

describe('重ねる段', () => {
  /**
   * 4段ぶんの filter をまとめて作る。**1つでも欠けると意味が無い**ので、
   * 段ごとに分けて確かめるのではなく、全部つないだ物を見る。
   */
  const allSteps = (): string[] => [
    overlayVideoClips(
      ctx,
      [{ path: 'v.mp4', tStart: 1, srcStart: 0, srcEnd: 2 }],
      [1],
      [true],
      '[base]'
    ).filter,
    overlayImages(ctx, [{ path: 'i.png', tStart: 0, duration: 3 }], [2], '[base]').filter,
    overlayTelopSeqs(ctx, [{ start: 0, end: 2, fps: 30, pngs: ['a.png', 'b.png'] }], [3], '[base]')
      .filter,
    overlayTelopFrames(ctx, [{ png: 't0.png', start: 0, end: 1 }], [4], '[base]').filter
  ]

  it('**どの段も rgb で重ねる**（既定の yuv420 に落ちると絵が変わる）', () => {
    // yuv420 は重ねる絵の色差を 2x2 に間引いてから混ぜるので、
    // プレビュー（canvas）と計算が違う。手で確かめた値は exportOverlays.ts の冒頭。
    for (const f of allSteps()) {
      for (const ov of f.split(';').filter((s) => s.includes('overlay='))) {
        expect(ov, `format=rgb が付いていない段がある: ${ov}`).toContain(':format=rgb')
      }
    }
  })

  it('**混ぜる色空間が段ごとに違わない**（境目で rgb ⇄ yuv の変換が挟まる）', () => {
    // 1段でも別の色空間になっていると、ffmpeg がその境目で変換を入れる。
    // 段の数だけ往復するので、テロップが数百枚あると致命的に遅くなる。
    const kinds = new Set<string>()
    for (const f of allSteps()) {
      for (const ov of f.split(';').filter((s) => s.includes('overlay='))) {
        kinds.add(/:format=(\w+)/.exec(ov)?.[1] ?? '（無指定＝yuv420）')
      }
    }
    expect([...kinds]).toEqual(['rgb'])
  })

  it('切り詰めたテロップは、焼いたときの左上へ戻す', () => {
    // x/y を落とすと、テロップが左上に寄って出る。**書き出してからしか分からない**
    const f = overlayTelopFrames(
      ctx,
      [{ png: 't0.png', start: 0, end: 1, x: 640, y: 880 }],
      [4],
      '[base]'
    ).filter
    expect(f).toContain('overlay=640:880')
  })

  it('x/y が無いテロップは 0:0（全画面PNG＝切り詰める前の形）', () => {
    // 古いプロジェクトや、切り詰めが効かなかった枚も同じ道を通る
    const f = overlayTelopFrames(ctx, [{ png: 't0.png', start: 0, end: 1 }], [4], '[base]').filter
    expect(f).toContain('overlay=0:0')
  })

  it('テロップが1枚も無ければ、最後のラベルだけ [v] に揃える', () => {
    // ここが抜けると「[v] が定義されていない」で書き出しが始まる前に落ちる
    const step = overlayTelopFrames(ctx, [], [], '[base]')
    expect(step.last).toBe('[v]')
    expect(step.filter).toContain('null[v]')
  })
})
