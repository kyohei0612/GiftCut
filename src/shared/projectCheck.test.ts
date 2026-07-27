// ============================================================================
// プロジェクト整合性チェックのテスト
//
// 一番大事なのは「正常なプロジェクトで指摘ゼロ」。誤検知が出ると、
// 本物の不整合が埋もれてチェック自体が無意味になる。
// ============================================================================
import { describe, expect, it } from 'vitest'
import { checkProject, formatProjectProblems, hasProjectError } from './projectCheck'

/** 実際の保存形式に沿った正常なプロジェクト */
function validProject(): Record<string, unknown> {
  return {
    version: 1,
    videoPath: 'C:/videos/main.mp4',
    srtPath: null,
    sources: [{ id: 1, path: 'C:/videos/main.mp4', name: 'main.mp4' }],
    ratio: '16:9',
    tracks: [
      { id: 'V3', name: '映像3', kind: 'video' },
      { id: 'V2', name: 'テロップ', kind: 'video' },
      { id: 'V1', name: '本編', kind: 'video' },
      { id: 'A1', name: '本編音声', kind: 'audio' },
      { id: 'A2', name: 'SE', kind: 'audio' },
      { id: 'A3', name: '映像3の音声', kind: 'audio' }
    ],
    trackStates: { V1: { locked: false }, A1: { muted: false } },
    cues: [
      { id: 1, start: 0.5, end: 2, text: 'ひとつめ', track: 'V2' },
      { id: 2, start: 3, end: 5, text: 'ふたつめ', track: 'V2' }
    ],
    segments: [
      { id: 1, srcId: 1, srcStart: 0, srcEnd: 10 },
      { id: 2, srcId: 1, srcStart: 20, srcEnd: 30, speed: 2, xfade: { type: 'fade', dur: 0.5 } },
      { id: 3, srcId: 1, srcStart: 40, srcEnd: 45 }
    ],
    seClips: [{ id: 1, path: 'C:/se/pop.wav', name: 'pop', tStart: 1, duration: 0.5, track: 'A2' }],
    imgClips: [
      { id: 1, path: 'C:/img/a.png', name: 'a', tStart: 2, duration: 3, track: 'V2' },
      { id: 2, path: 'C:/img/b.png', name: 'b', tStart: 6, duration: 2, track: 'V2' }
    ],
    vClips: [
      {
        id: 1,
        path: 'C:/videos/pip.mp4',
        name: 'pip',
        track: 'V3',
        tStart: 1,
        srcStart: 0,
        srcEnd: 4
      }
    ],
    markers: [{ id: 1, t: 3.5 }],
    mediaItems: [{ path: 'C:/videos/main.mp4', name: 'main.mp4', kind: 'video', folder: null }]
  }
}

describe('正常なプロジェクト', () => {
  it('指摘ゼロ（誤検知しない）', () => {
    const p = checkProject(validProject())
    expect(formatProjectProblems(p)).toBe('不整合は見つかりませんでした。')
  })

  it('空白（クリップ移動でできる隙間）を含んでいても指摘ゼロ', () => {
    // クリップを後ろへ動かすと、元の位置に空白切片ができる。空白は
    // srcId を持たず、長さも元動画の尺と無関係（元素材より長いこともある）。
    // これを「壊れた切片」と誤検知すると、動かすたびに警告が出て
    // 本物の不整合が埋もれる。
    const d = validProject()
    d.segments = [
      { id: 10, srcStart: 0, srcEnd: 120, videoBlank: true, muted: true, gap: true },
      { id: 1, srcId: 1, srcStart: 0, srcEnd: 10 }
    ]
    const p = checkProject(d)
    expect(formatProjectProblems(p)).toBe('不整合は見つかりませんでした。')
  })

  it('空のプロジェクト（新規状態）でも指摘ゼロ', () => {
    const p = checkProject({
      version: 1,
      videoPath: null,
      tracks: [],
      cues: [],
      segments: [],
      seClips: [],
      imgClips: [],
      vClips: [],
      markers: []
    })
    expect(p).toEqual([])
  })

  it('同じトラックにテロップが時間的に重なっていても指摘しない（重ね表示は使い方の一つ）', () => {
    const d = validProject()
    d.cues = [
      { id: 1, start: 0, end: 5, text: '下', track: 'V2' },
      { id: 2, start: 1, end: 3, text: '上', track: 'V2' }
    ]
    expect(checkProject(d)).toEqual([])
  })
})

describe('参照の不整合（消したのに残っている）', () => {
  it('存在しないトラックに載っているクリップ', () => {
    const d = validProject()
    ;(d.imgClips as Record<string, unknown>[])[0].track = 'V9'
    const p = checkProject(d)
    const e = p.find((x) => x.code === 'E_CLIP_TRACK_MISSING')
    expect(e).toBeTruthy()
    expect(e!.message).toContain('V9')
    expect(e!.where).toBe('imgClips[0]')
  })

  it('存在しないソースを指す切片（マルチソースの孤児）', () => {
    const d = validProject()
    ;(d.segments as Record<string, unknown>[])[1].srcId = 99
    const p = checkProject(d)
    expect(p.some((x) => x.code === 'E_SEG_SRC_MISSING' && x.message.includes('99'))).toBe(true)
  })

  it('映像レイヤーに対の音声トラックが無い（V3↔A3 のリンク崩れ）', () => {
    const d = validProject()
    d.tracks = (d.tracks as { id: string }[]).filter((t) => t.id !== 'A3')
    const p = checkProject(d)
    const e = p.find((x) => x.code === 'E_VCLIP_NO_PAIR')
    expect(e).toBeTruthy()
    expect(e!.message).toContain('A3')
  })

  it('映像トラックの並びが番号順でない（V4 が V3 の下に入った）', () => {
    // 退避トラックを番号を無視した位置に挿入すると、番号が大きいほど前面という
    // 前提が壊れる。V4 のテロップが V3 の画像の後ろに隠れて理由が分からなくなる。
    const d = validProject()
    d.tracks = [
      { id: 'V3', name: 'V3', kind: 'video' },
      { id: 'V4', name: 'V4', kind: 'video' },
      { id: 'V2', name: 'V2', kind: 'video' },
      { id: 'V1', name: 'V1', kind: 'video' },
      { id: 'A1', name: 'A1', kind: 'audio' },
      { id: 'A2', name: 'A2', kind: 'audio' },
      { id: 'A3', name: 'A3', kind: 'audio' }
    ]
    const p = checkProject(d)
    expect(p.some((x) => x.code === 'W_TRACK_ORDER' && x.message.includes('V3'))).toBe(true)
  })

  it('音声トラックの並びが番号順でない（A4 が A3 の上に入った）', () => {
    const d = validProject()
    d.tracks = [
      { id: 'V3', name: 'V3', kind: 'video' },
      { id: 'V2', name: 'V2', kind: 'video' },
      { id: 'V1', name: 'V1', kind: 'video' },
      { id: 'A1', name: 'A1', kind: 'audio' },
      { id: 'A2', name: 'A2', kind: 'audio' },
      { id: 'A4', name: 'A4', kind: 'audio' },
      { id: 'A3', name: 'A3', kind: 'audio' }
    ]
    expect(checkProject(d).some((x) => x.code === 'W_TRACK_ORDER')).toBe(true)
  })

  it('消したトラックの状態が残っている', () => {
    const d = validProject()
    d.trackStates = { V1: {}, V7: { muted: true } }
    const p = checkProject(d)
    expect(p.some((x) => x.code === 'W_TRACKSTATE_ORPHAN' && x.message.includes('V7'))).toBe(true)
  })

  it('srcId を持つ切片があるのにソース一覧が空', () => {
    const d = validProject()
    d.sources = []
    const p = checkProject(d)
    expect(p.some((x) => x.code === 'E_NO_SOURCES')).toBe(true)
  })
})

describe('時間の不整合', () => {
  it('長さ 0 以下の切片', () => {
    const d = validProject()
    ;(d.segments as Record<string, unknown>[])[0].srcEnd = 0
    expect(checkProject(d).some((x) => x.code === 'E_SEG_EMPTY')).toBe(true)
  })

  it('負の開始位置', () => {
    const d = validProject()
    ;(d.imgClips as Record<string, unknown>[])[0].tStart = -1
    expect(checkProject(d).some((x) => x.code === 'E_CLIP_NEGATIVE')).toBe(true)
  })

  it('不正な速度', () => {
    const d = validProject()
    ;(d.segments as Record<string, unknown>[])[0].speed = 0
    expect(checkProject(d).some((x) => x.code === 'E_SEG_SPEED')).toBe(true)
  })

  it('長さ 0 のトランジション', () => {
    const d = validProject()
    ;(d.segments as Record<string, unknown>[])[0].transIn = { type: 'fade', dur: 0 }
    expect(checkProject(d).some((x) => x.code === 'E_TRANS_DUR')).toBe(true)
  })

  it('最後の切片に次クリップとのトランジションが残っている', () => {
    const d = validProject()
    ;(d.segments as Record<string, unknown>[])[2].xfade = { type: 'fade', dur: 0.5 }
    expect(checkProject(d).some((x) => x.code === 'W_XFADE_ORPHAN')).toBe(true)
  })

  it('同じトラックで実体クリップが重なっている（警告）', () => {
    const d = validProject()
    ;(d.imgClips as Record<string, unknown>[])[1].tStart = 3 // 0番は 2〜5 なので重なる
    const p = checkProject(d)
    const w = p.find((x) => x.code === 'W_CLIP_OVERLAP')
    expect(w).toBeTruthy()
    expect(w!.severity).toBe('warning')
  })

})

describe('ID の重複', () => {
  it('切片の id 重複', () => {
    const d = validProject()
    ;(d.segments as Record<string, unknown>[])[1].id = 1
    expect(checkProject(d).some((x) => x.code === 'E_SEG_DUP')).toBe(true)
  })

  it('クリップの id 重複', () => {
    const d = validProject()
    ;(d.imgClips as Record<string, unknown>[])[1].id = 1
    expect(checkProject(d).some((x) => x.code === 'E_CLIP_DUP')).toBe(true)
  })

  it('トラックの id 重複', () => {
    const d = validProject()
    ;(d.tracks as { id: string }[]).push({ id: 'V1', name: 'にせV1', kind: 'video' })
    expect(checkProject(d).some((x) => x.code === 'E_TRACK_DUP')).toBe(true)
  })

  it('ソースの id 重複', () => {
    const d = validProject()
    ;(d.sources as unknown[]).push({ id: 1, path: 'C:/videos/other.mp4', name: 'other' })
    expect(checkProject(d).some((x) => x.code === 'E_SOURCE_DUP')).toBe(true)
  })
})

describe('壊れた入力でも例外を投げない', () => {
  it('null / 文字列 / 配列', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      const p = checkProject(bad)
      expect(hasProjectError(p)).toBe(true)
      expect(() => formatProjectProblems(p)).not.toThrow()
    }
  })

  it('配列のはずが違う型でも落ちない', () => {
    const p = checkProject({ tracks: 'nope', segments: null, imgClips: 3, cues: {} })
    expect(() => formatProjectProblems(p)).not.toThrow()
  })

  it('要素が null でも落ちない', () => {
    const d = validProject()
    ;(d.segments as unknown[])[0] = null
    ;(d.imgClips as unknown[])[0] = null
    const p = checkProject(d)
    expect(p.some((x) => x.code === 'E_SEG_SHAPE')).toBe(true)
    expect(p.some((x) => x.code === 'E_CLIP_SHAPE')).toBe(true)
  })

  it('パスが空文字', () => {
    const d = validProject()
    ;(d.sources as Record<string, unknown>[])[0].path = ''
    expect(checkProject(d).some((x) => x.code === 'E_SOURCE_PATH')).toBe(true)
  })
})
