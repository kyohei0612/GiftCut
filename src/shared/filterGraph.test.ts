// ============================================================================
// filter_complex 検証のテスト
//
// 実際に踏んだ書き出しバグを回帰テストとして固定する。ここが通らなくなったら
// 「ffmpeg を起動して初めて分かる不整合」を作り込んだということ。
// ============================================================================
import { describe, expect, it } from 'vitest'
import {
  formatGraphProblems,
  hasGraphError,
  validateFilterGraph,
  type GraphInput
} from './filterGraph'

const AV: GraphInput = { hasVideo: true, hasAudio: true }
const VIDEO_ONLY: GraphInput = { hasVideo: true, hasAudio: false, name: '無音の動画.mp4' }
const PNG: GraphInput = { hasVideo: true, hasAudio: false, name: 'telop.png' }

/** 実際の書き出しと同じ形の最小グラフ（1ソース・音声あり・テロップなし） */
const MINIMAL = [
  '[0:v]trim=start=0.000:end=5.000,setpts=(PTS-STARTPTS)/1,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1[sv0]',
  '[0:a]atrim=start=0.000:end=5.000,asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo[sa0]',
  '[sv0]null[vcat]',
  '[sa0]null[acat]',
  '[acat]volume=1.000[abase]',
  '[abase]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]',
  '[vcat]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1[base]',
  '[base]null[v]'
].join(';')

const MAPS = ['[v]', '[aout]']

describe('正常なグラフ', () => {
  it('実際の形の最小グラフは指摘ゼロ（誤検知しない＝今動く書き出しを壊さない）', () => {
    const p = validateFilterGraph(MINIMAL, { inputs: [AV], maps: MAPS })
    expect(formatGraphProblems(p)).toBe('')
    expect(p).toEqual([])
  })

  it('末尾のセミコロンや空チェーンがあっても通る', () => {
    const p = validateFilterGraph(MINIMAL + ';', { inputs: [AV], maps: MAPS })
    expect(p).toEqual([])
  })

  it('複数入力・concat・xfade・overlay を含む形も通る', () => {
    const g = [
      // 2ソース連結
      '[0:v]trim=start=0.000:end=3.000,setpts=(PTS-STARTPTS)/1,setsar=1,settb=AVTB[sv0]',
      '[1:v]trim=start=0.000:end=3.000,setpts=(PTS-STARTPTS)/1,setsar=1,settb=AVTB[sv1]',
      '[0:a]atrim=start=0.000:end=3.000,asetpts=PTS-STARTPTS[sa0]',
      '[1:a]atrim=start=0.000:end=3.000,asetpts=PTS-STARTPTS[sa1]',
      // クロスディゾルブ
      '[sv0][sv1]xfade=transition=fade:duration=0.500:offset=2.500[vcat]',
      '[sa0][sa1]acrossfade=d=0.500[acat]',
      '[acat]volume=1.000[abase]',
      // SE を1本ミックス
      '[2:a]atrim=0.000:1.000,asetpts=PTS-STARTPTS,volume=1,adelay=500|500[se0]',
      '[abase][se0]amix=inputs=2:normalize=0:dropout_transition=0[amixout]',
      '[amixout]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]',
      '[vcat]scale=1920:1080:force_original_aspect_ratio=decrease,setsar=1[base]',
      // テロップ PNG を重ねる
      '[base][3:v]overlay=0:0:enable=between(t\\,0.500\\,2.000)[v]'
    ].join(';')
    const p = validateFilterGraph(g, {
      inputs: [AV, AV, { hasVideo: false, hasAudio: true, name: 'se.wav' }, PNG],
      maps: MAPS
    })
    expect(formatGraphProblems(p)).toBe('')
  })

  it('split で分岐すれば同じ素材を2回使ってもよい（アルファ保持の形）', () => {
    const g = [
      '[1:v]scale=640:360,split[ig0a][ig0b]',
      '[ig0a]alphaextract[ia0]',
      '[ig0b]eq=brightness=0:contrast=1[ic0]',
      '[ic0][ia0]alphamerge[icv0]',
      '[0:v]null[base]',
      '[base][icv0]overlay=0:0[v]'
    ].join(';')
    const p = validateFilterGraph(g, { inputs: [AV, PNG], maps: ['[v]'] })
    expect(formatGraphProblems(p)).toBe('')
  })
})

describe('回帰: 実際に踏んだ書き出しバグ', () => {
  it('無音の動画に [N:a] を参照したら止める', () => {
    // 映像レイヤーに無音の動画を置いたとき、無条件に音声を参照して書き出しが失敗した。
    const g = MINIMAL.replace(
      '[base]null[v]',
      '[1:a]atrim=0.000:2.000,asetpts=PTS-STARTPTS,adelay=0|0[vca0];[base]null[v]'
    )
    const p = validateFilterGraph(g, { inputs: [AV, VIDEO_ONLY], maps: MAPS })
    expect(hasGraphError(p)).toBe(true)
    const e = p.find((x) => x.code === 'E_NO_AUDIO')
    expect(e).toBeTruthy()
    expect(e!.message).toContain('無音の動画.mp4')
  })

  it('音声を作ったのにミックスへ繋がっていない（条件分岐で行が飛んだ）を検出', () => {
    // 映像レイヤーの音声ミックスが if の内側にあり、[vca0] を作ったまま捨てていた。
    const g = MINIMAL.replace(
      '[base]null[v]',
      '[1:a]atrim=0.000:2.000,asetpts=PTS-STARTPTS,adelay=0|0[vca0];[base]null[v]'
    )
    const p = validateFilterGraph(g, { inputs: [AV, AV], maps: MAPS })
    const w = p.find((x) => x.code === 'W_UNUSED_LABEL')
    expect(w).toBeTruthy()
    expect(w!.message).toContain('vca0')
  })

  it('入力 index の計算ミス（範囲外）を検出', () => {
    // nSrc + pngPaths.length + k のような手計算がズレると存在しない入力を指す。
    const g = MINIMAL.replace('[base]null[v]', '[base][7:v]overlay=0:0[v]')
    const p = validateFilterGraph(g, { inputs: [AV], maps: MAPS })
    const e = p.find((x) => x.code === 'E_INPUT_RANGE')
    expect(e).toBeTruthy()
    expect(e!.message).toContain('存在しない入力 7')
  })

  it('綴り間違い/定義漏れのラベルを検出', () => {
    const g = MINIMAL.replace('[abase]loudnorm', '[abaze]loudnorm')
    const p = validateFilterGraph(g, { inputs: [AV], maps: MAPS })
    expect(p.some((x) => x.code === 'E_UNDEFINED_LABEL' && x.message.includes('abaze'))).toBe(true)
    expect(p.some((x) => x.code === 'W_UNUSED_LABEL' && x.message.includes('abase'))).toBe(true)
  })

  it('同じラベルを2回消費したら止める（split を忘れた形）', () => {
    const g = [
      '[0:v]null[base]',
      '[base]eq=brightness=0.1[b1]',
      '[base]eq=brightness=0.2[b2]',
      '[b1][b2]overlay=0:0[v]'
    ].join(';')
    const p = validateFilterGraph(g, { inputs: [AV], maps: ['[v]'] })
    const e = p.find((x) => x.code === 'E_MULTI_CONSUME')
    expect(e).toBeTruthy()
    expect(e!.message).toContain('base')
  })

  it('同じ入力パッド [0:v] を2回使ったら止める（split を通していない）', () => {
    // 1つの素材を複数クリップで使うときは split/asplit で分ける必要がある。
    // プレースホルダの置換が1回分しか払い出されないと、この形になる。
    const g = [
      '[0:v]trim=start=0.000:end=2.000[sv0]',
      '[0:v]trim=start=5.000:end=7.000[sv1]',
      '[sv0][sv1]concat=n=2:v=1:a=0[v]'
    ].join(';')
    const p = validateFilterGraph(g, { inputs: [AV], maps: ['[v]'] })
    const e = p.find((x) => x.code === 'E_MULTI_CONSUME')
    expect(e).toBeTruthy()
    expect(e!.message).toContain('0:v')
  })

  it('split=2 を通していれば同じ入力を2クリップで使ってよい', () => {
    // resolveInputLabels が実際に生成する形
    const g = [
      '[0:v]split=2[xV0_0][xV0_1]',
      '[xV0_0]trim=start=0.000:end=2.000[sv0]',
      '[xV0_1]trim=start=5.000:end=7.000[sv1]',
      '[sv0][sv1]concat=n=2:v=1:a=0[v]'
    ].join(';')
    const p = validateFilterGraph(g, { inputs: [AV], maps: ['[v]'] })
    expect(formatGraphProblems(p)).toBe('')
  })

  it('同じラベルを2回定義したら止める', () => {
    const g = ['[0:v]null[base]', '[0:a]anull[base]', '[base]null[v]'].join(';')
    const p = validateFilterGraph(g, { inputs: [AV], maps: ['[v]'] })
    expect(p.some((x) => x.code === 'E_DUP_DEFINE')).toBe(true)
  })

  it('-map の対象が無ければ止める（音声が無い動画を書き出す事故）', () => {
    const p = validateFilterGraph(MINIMAL, { inputs: [AV], maps: ['[v]', '[aout_typo]'] })
    const e = p.find((x) => x.code === 'E_MAP_MISSING')
    expect(e).toBeTruthy()
  })

  it('映像を持たない入力から [N:v] を取ろうとしたら止める', () => {
    const g = '[0:v]null[base];[base][1:v]overlay=0:0[v]'
    const p = validateFilterGraph(g, {
      inputs: [AV, { hasVideo: false, hasAudio: true, name: 'se.wav' }],
      maps: ['[v]']
    })
    expect(p.some((x) => x.code === 'E_NO_VIDEO')).toBe(true)
  })
})

describe('壊れた入力でも例外を投げない', () => {
  it('空文字', () => {
    const p = validateFilterGraph('', { inputs: [AV] })
    expect(p[0].code).toBe('E_EMPTY')
  })

  it('空のラベル', () => {
    const p = validateFilterGraph('[0:v]null[]', { inputs: [AV] })
    expect(p.some((x) => x.code === 'E_EMPTY_LABEL')).toBe(true)
  })

  it('入力一覧が空でも落ちない', () => {
    const p = validateFilterGraph(MINIMAL, { inputs: [] })
    expect(hasGraphError(p)).toBe(true)
    expect(() => formatGraphProblems(p)).not.toThrow()
  })

  it('maps 未指定でも落ちない', () => {
    const p = validateFilterGraph(MINIMAL, { inputs: [AV] })
    // [v] と [aout] が誰にも使われない警告は出るが error は無い
    expect(hasGraphError(p)).toBe(false)
  })

  it("'-map 0:a?' の疑問符付き表記を誤検知しない（テロップ無しの書き出しで実際に使う形）", () => {
    // 音声をフィルタで加工しないときは入力から直接 map する。'?' は
    // 「無ければ無視」の意味なので、無音素材でもエラーにしてはいけない。
    const g = '[0:v]null[base];[base]null[v]'
    const p = validateFilterGraph(g, { inputs: [VIDEO_ONLY], maps: ['[v]', '0:a?'] })
    expect(formatGraphProblems(p)).toBe('')
  })

  it("グラフ内の '[0:a?]' 参照も誤検知しない", () => {
    const g = '[0:v]null[base];[0:a?]anull[aout];[base]null[v]'
    const p = validateFilterGraph(g, { inputs: [VIDEO_ONLY], maps: ['[v]', '[aout]'] })
    expect(formatGraphProblems(p)).toBe('')
  })

  it('括弧付き/なしどちらの map 表記も受ける', () => {
    const a = validateFilterGraph(MINIMAL, { inputs: [AV], maps: ['[v]', '[aout]'] })
    const b = validateFilterGraph(MINIMAL, { inputs: [AV], maps: ['v', 'aout'] })
    expect(a).toEqual(b)
  })
})
