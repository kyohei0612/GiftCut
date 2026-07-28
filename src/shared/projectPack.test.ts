import { describe, it, expect } from 'vitest'
import { collectMediaPaths, planPack, relinkProject, MEDIA_DIR } from './projectPack'

const proj = {
  version: 1,
  videoPath: 'C:\\動画\\本編.mp4',
  srtPath: 'C:\\字幕\\台本.srt',
  sources: [{ id: 1, path: 'C:\\動画\\本編.mp4', name: '本編.mp4' }],
  seClips: [
    { id: 1, path: 'C:\\SE\\ドン.wav', tStart: 0 },
    { id: 2, path: 'D:\\BGM\\曲.mp3', tStart: 3 }
  ],
  imgClips: [{ id: 1, path: 'C:\\画像\\ロゴ.png' }],
  vClips: [{ id: 1, path: 'C:\\動画\\差し込み.mp4' }],
  mediaItems: [
    { path: 'C:\\動画\\本編.mp4', name: '本編.mp4', kind: 'video' },
    { path: 'C:\\SE\\ドン.wav', name: 'ドン.wav', kind: 'audio' }
  ],
  projectPath: 'C:\\Users\\自分\\書類\\作りかけ.gcproj',
  cues: [{ id: 1, text: 'テロップ', start: 0, end: 1 }]
}

describe('使っている素材を集める', () => {
  it('動画・字幕・SE・画像・映像レイヤー・ビンを、重複なく集める', () => {
    expect(collectMediaPaths(proj)).toEqual([
      'C:\\動画\\本編.mp4',
      'C:\\字幕\\台本.srt',
      'C:\\SE\\ドン.wav',
      'D:\\BGM\\曲.mp3',
      'C:\\画像\\ロゴ.png',
      'C:\\動画\\差し込み.mp4'
    ])
  })

  it('元のプロジェクトには触らない', () => {
    const before = JSON.stringify(proj)
    planPack(proj)
    expect(JSON.stringify(proj)).toBe(before)
  })
})

describe('まとめる（持ち出し）', () => {
  const plan = planPack(proj)

  it('全ての素材を 素材/ の下へ集める', () => {
    expect(plan.files).toHaveLength(6)
    expect(plan.files.map((f) => f.to)).toContain(`${MEDIA_DIR}/本編.mp4`)
  })

  it('パスが ZIP の中の場所に書き換わる', () => {
    expect(plan.project.videoPath).toBe(`${MEDIA_DIR}/本編.mp4`)
    expect((plan.project.seClips as { path: string }[])[1].path).toBe(`${MEDIA_DIR}/曲.mp3`)
    expect((plan.project.mediaItems as { path: string }[])[0].path).toBe(`${MEDIA_DIR}/本編.mp4`)
  })

  it('同じファイルは1つだけ入れ、参照は同じ場所を指す', () => {
    const video = plan.files.filter((f) => f.from === 'C:\\動画\\本編.mp4')
    expect(video).toHaveLength(1)
    expect((plan.project.sources as { path: string }[])[0].path).toBe(plan.project.videoPath)
  })

  it('別フォルダの同名ファイルは、名前をずらして両方入れる', () => {
    const p = {
      seClips: [{ path: 'C:\\A\\音.wav' }, { path: 'C:\\B\\音.wav' }, { path: 'C:\\C\\音.wav' }]
    }
    const r = planPack(p)
    expect(r.files.map((f) => f.to)).toEqual([
      `${MEDIA_DIR}/音.wav`,
      `${MEDIA_DIR}/音 (2).wav`,
      `${MEDIA_DIR}/音 (3).wav`
    ])
    expect((r.project.seClips as { path: string }[]).map((c) => c.path)).toEqual(
      r.files.map((f) => f.to)
    )
  })

  it('大文字小文字だけ違うパスは、同じファイルとして扱う（Windows）', () => {
    const p = { videoPath: 'C:\\動画\\A.mp4', sources: [{ path: 'c:\\動画\\a.mp4' }] }
    const r = planPack(p)
    expect(r.files).toHaveLength(1)
    expect((r.project.sources as { path: string }[])[0].path).toBe(r.project.videoPath)
  })

  it('見つからない素材は入れず、元のパスのまま残す（相手側で差し替えられる）', () => {
    const r = planPack(proj, { exists: (p) => !p.startsWith('D:') })
    expect(r.missing).toEqual(['D:\\BGM\\曲.mp3'])
    expect((r.project.seClips as { path: string }[])[1].path).toBe('D:\\BGM\\曲.mp3')
    expect(r.files.some((f) => f.from.startsWith('D:'))).toBe(false)
  })

  it('前のPCの保存先は持ち出さない（相手のPCで勝手に上書きしないため）', () => {
    expect(plan.project.projectPath).toBeNull()
  })

  it('素材以外（テロップなど）はそのまま残る', () => {
    expect(plan.project.cues).toEqual(proj.cues)
    expect(plan.project.version).toBe(1)
  })
})

describe('受け取って開く', () => {
  it('展開した場所の絶対パスへ書き戻す', () => {
    const plan = planPack(proj)
    const back = relinkProject(plan.project, 'D:\\受け取り\\案件A')
    expect(back.videoPath).toBe('D:\\受け取り\\案件A\\素材\\本編.mp4')
    expect((back.imgClips as { path: string }[])[0].path).toBe('D:\\受け取り\\案件A\\素材\\ロゴ.png')
  })

  it('末尾の￥があってもパスが二重にならない', () => {
    const plan = planPack(proj)
    const back = relinkProject(plan.project, 'D:\\受け取り\\')
    expect(back.videoPath).toBe('D:\\受け取り\\素材\\本編.mp4')
  })

  it('まとめに入っていなかった素材（絶対パス）はそのまま', () => {
    const plan = planPack(proj, { exists: (p) => !p.startsWith('D:') })
    const back = relinkProject(plan.project, 'D:\\受け取り')
    expect((back.seClips as { path: string }[])[1].path).toBe('D:\\BGM\\曲.mp3')
  })

  it('まとめ→展開→まとめ、と往復しても同じ結果になる', () => {
    const once = relinkProject(planPack(proj).project, 'D:\\受け取り')
    const twice = relinkProject(planPack(once).project, 'D:\\受け取り')
    expect(twice).toEqual(once)
  })

  it('mac 風の区切りでも書き戻せる', () => {
    const plan = planPack(proj)
    const back = relinkProject(plan.project, '/Users/me/受け取り', '/')
    expect(back.videoPath).toBe('/Users/me/受け取り/素材/本編.mp4')
  })
})
