import { describe, it, expect } from 'vitest'
import { buildExportPayload, pairedAudioTrack, type BuildInput } from './exportPayload'

const base = (over: Partial<BuildInput> = {}): BuildInput => ({
  videoPath: 'C:\\動画\\本編.mp4',
  sources: [{ id: 1, path: 'C:\\動画\\本編.mp4' }],
  size: { width: 1920, height: 1080 },
  frames: [],
  segments: [{ srcStart: 0, srcEnd: 10 }],
  seClips: [],
  vClips: [],
  imgClips: [],
  tracks: [{ id: 'V3' }, { id: 'V2' }, { id: 'V1' }, { id: 'A1' }, { id: 'A2' }, { id: 'A3' }],
  hidden: () => false,
  v1Hidden: false,
  gainOf: () => 1,
  speedOf: (s) => s.speed ?? 1,
  srcDurationOf: () => undefined,
  xfadeDurAt: () => 0,
  totalLen: (segs) => segs.reduce((n, s) => n + (s.srcEnd - s.srcStart) / (s.speed ?? 1), 0),
  loudnormLUFS: -14,
  fps: 30,
  crf: 18,
  tailEnds: [],
  ...over
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const get = (p: Record<string, unknown>, k: string): any => p[k]

describe('尺の決め方', () => {
  it('後ろに何も無ければ、本編の長さそのまま', () => {
    const p = buildExportPayload(base())
    expect(p.extendSec).toBe(0)
    expect(p.totalDurationSec).toBe(10)
  })

  it('本編より後ろにテロップや効果音があれば、そのぶん伸ばす', () => {
    const p = buildExportPayload(base({ tailEnds: [13.5, 8] }))
    expect(p.extendSec).toBeCloseTo(3.5)
    expect(p.totalDurationSec).toBeCloseTo(13.5)
  })

  it('素材より長い切片は、素材の実尺まで切り詰めてから数える', () => {
    // 画面上は 0〜10秒だが、素材は6秒しか無い
    const p = buildExportPayload(base({ srcDurationOf: () => 6 }))
    expect(get(p, 'segments')[0].srcEnd).toBe(6)
    expect(p.totalDurationSec).toBe(6)
  })

  it('速度を上げた切片は、そのぶん短く数える', () => {
    const p = buildExportPayload(
      base({ segments: [{ srcStart: 0, srcEnd: 10, speed: 2 }] })
    )
    expect(p.totalDurationSec).toBe(5)
    expect(get(p, 'segments')[0].speed).toBe(2)
  })
})

describe('見えていない物は焼かない', () => {
  it('👁 で消した画像は入らない', () => {
    const p = buildExportPayload(
      base({
        imgClips: [
          { path: 'a.png', track: 'V2', tStart: 0, duration: 2 },
          { path: 'b.png', track: 'V3', tStart: 0, duration: 2 }
        ],
        hidden: (t) => t === 'V3'
      })
    )
    expect(get(p, 'images').map((i: { path: string }) => i.path)).toEqual(['a.png'])
  })

  it('映像レイヤーの 👁 は映像だけ消す（音は残す）', () => {
    const p = buildExportPayload(
      base({
        vClips: [{ path: 'v.mp4', track: 'V2', tStart: 0, srcStart: 0, srcEnd: 3, vol: 1 }],
        hidden: () => true
      })
    )
    expect(get(p, 'vClips')[0].opacity).toBe(0)
    expect(get(p, 'vClips')[0].volume).toBe(1)
  })

  it('本編を消したら、映像は黒にする（音は残る）', () => {
    const p = buildExportPayload(base({ v1Hidden: true }))
    expect(get(p, 'segments')[0].videoBlank).toBe(true)
    expect(get(p, 'segments')[0].muted).toBe(false)
  })
})

describe('重ねる順', () => {
  it('下のトラックから順に渡す（上のトラックが前面になる）', () => {
    const p = buildExportPayload(
      base({
        imgClips: [
          { path: 'up.png', track: 'V3', tStart: 0, duration: 1 },
          { path: 'down.png', track: 'V2', tStart: 0, duration: 1 }
        ]
      })
    )
    // 先に描く物＝下。あとから描く物が上に乗る
    expect(get(p, 'images').map((i: { path: string }) => i.path)).toEqual(['down.png', 'up.png'])
  })
})

describe('音量', () => {
  it('効果音は トラック音量×マスター を掛けて渡す', () => {
    const p = buildExportPayload(
      base({
        seClips: [
          { path: 'se.wav', track: 'A2', tStart: 0, duration: 1, volume: 0.5, fadeIn: 0, fadeOut: 0 }
        ],
        gainOf: (t) => (t === 'A2' ? 0.5 : 1)
      })
    )
    expect(get(p, 'seClips')[0].volume).toBeCloseTo(0.25)
  })

  it('上げすぎは 4倍で止める（音が割れるのを防ぐ）', () => {
    const p = buildExportPayload(
      base({
        seClips: [
          { path: 'se.wav', track: 'A2', tStart: 0, duration: 1, volume: 2, fadeIn: 0, fadeOut: 0 }
        ],
        gainOf: () => 5
      })
    )
    expect(get(p, 'seClips')[0].volume).toBe(4)
  })

  it('消音した映像レイヤーは 0', () => {
    const p = buildExportPayload(
      base({
        vClips: [
          { path: 'v.mp4', track: 'V2', tStart: 0, srcStart: 0, srcEnd: 1, vol: 1, muted: true }
        ]
      })
    )
    expect(get(p, 'vClips')[0].volume).toBe(0)
  })

  it('声に合わせて下げる指定があるクリップにだけ、式を渡す', () => {
    const p = buildExportPayload(
      base({
        seClips: [
          { path: 'bgm.mp3', track: 'A3', tStart: 0, duration: 9, volume: 1, fadeIn: 0, fadeOut: 0, duck: true },
          { path: 'se.wav', track: 'A2', tStart: 0, duration: 1, volume: 1, fadeIn: 0, fadeOut: 0 }
        ],
        duckExpr: 'if(lt(t,1),1,0.25)'
      })
    )
    expect(get(p, 'seClips')[0].duckExpr).toBe('if(lt(t,1),1,0.25)')
    expect(get(p, 'seClips')[1].duckExpr).toBeUndefined()
  })
})

describe('何も調整していない値は渡さない（フィルタを増やさない）', () => {
  it('等倍・無回転・切り抜きなしは undefined', () => {
    const p = buildExportPayload(
      base({
        imgClips: [
          {
            path: 'a.png',
            track: 'V2',
            tStart: 0,
            duration: 1,
            zoom: { scale: 1, x: 0, y: 0 },
            adjust: { b: 1, c: 1, s: 1 },
            crop: { l: 0, r: 0, t: 0, b: 0 },
            opacity: 1
          }
        ]
      })
    )
    const im = get(p, 'images')[0]
    expect(im.zoom).toBeUndefined()
    expect(im.adjust).toBeUndefined()
    expect(im.crop).toBeUndefined()
    expect(im.opacity).toBeUndefined()
  })

  it('少しでも触っていれば渡す', () => {
    const p = buildExportPayload(
      base({
        imgClips: [
          {
            path: 'a.png',
            track: 'V2',
            tStart: 0,
            duration: 1,
            zoom: { scale: 1.2, x: 0, y: 0 },
            opacity: 0.5
          }
        ]
      })
    )
    expect(get(p, 'images')[0].zoom).toEqual({ scale: 1.2, x: 0, y: 0 })
    expect(get(p, 'images')[0].opacity).toBe(0.5)
  })
})

describe('複数の元動画', () => {
  it('切片の srcId を、渡す入力の並びの番号に直す', () => {
    const p = buildExportPayload(
      base({
        sources: [
          { id: 5, path: 'a.mp4' },
          { id: 9, path: 'b.mp4' }
        ],
        segments: [
          { srcStart: 0, srcEnd: 1, srcId: 9 },
          { srcStart: 0, srcEnd: 1, srcId: 5 },
          { srcStart: 0, srcEnd: 1 } // 未指定＝主ソース
        ]
      })
    )
    expect(get(p, 'segments').map((s: { srcIdx: number }) => s.srcIdx)).toEqual([1, 0, 0])
  })

  it('知らない srcId は主ソースへ寄せる（別の動画にすり替えない）', () => {
    const p = buildExportPayload(
      base({ segments: [{ srcStart: 0, srcEnd: 1, srcId: 999 }] })
    )
    expect(get(p, 'segments')[0].srcIdx).toBe(0)
  })
})

describe('対の音声トラック', () => {
  it('V2 の音は A2、V3 は A3', () => {
    expect(pairedAudioTrack('V2')).toBe('A2')
    expect(pairedAudioTrack('V3')).toBe('A3')
  })
})
