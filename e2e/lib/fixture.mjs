// 測るための素材を作る。長い動画・テロップ・切片・プロジェクトのファイル。
//
// ## 作った物は使い回す
//
// 60分の動画を毎回作ると、測るより作る方が長くかかる。CACHE に置いて次から再利用する。
// **素材が変わると数字も変わる**ので、前回と比べるときは同じ素材で測ること。
import { sh } from './shell.mjs'
import { fmt, mb } from './fmt.mjs'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, statSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
/** 作った素材の置き場。**毎回作り直すと測るより長くかかる**ので使い回す */
export const CACHE = join(ROOT, 'e2e', '.cache')
/** 測るときに載せるテロップの枚数（前回と比べるので変えないこと） */
export const TELOPS = 200


// ---------------------------------------------------------------------------
/** Downloads から一番大きい動画を選ぶ。作り物では出ない問題があるので実素材を使う。 */
export function pickSource() {
  const dl = join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Downloads')
  if (!existsSync(dl)) return null
  const vids = readdirSync(dl)
    .filter((f) => /\.(mp4|mov|mkv|m4v)$/i.test(f))
    .map((f) => join(dl, f))
    .filter((f) => {
      try {
        return statSync(f).isFile()
      } catch {
        return false
      }
    })
  if (!vids.length) return null
  return vids.sort((a, b) => statSync(b).size - statSync(a).size)[0]
}

/**
 * 長い素材を作る。
 *
 * 元のまま1時間ぶん繋ぐと数十GBになるので、
 *   1回目: 先頭の一部を 720p30 に落として「1単位」を作る（ここだけ時間がかかる）
 *   2回目: それを必要な回数つなぐ（作り直さないので一瞬）
 * の2段でやる。中身は実素材なので、コーデックも音も本物のまま。
 */
export async function makeLongVideo(minutes) {
  mkdirSync(CACHE, { recursive: true })
  const out = join(CACHE, `bench-${minutes}min.mp4`)
  if (existsSync(out) && statSync(out).size > 1e6) {
    console.log(`素材: 作成済みのものを使う（${mb(statSync(out).size)}）`)
    return out
  }
  const src = pickSource()
  if (!src) {
    console.error('Downloads に動画が見つかりません。素材を1つ置いてください。')
    process.exit(2)
  }
  const unit = join(CACHE, 'bench-unit.mp4')
  const UNIT_SEC = 300
  if (!existsSync(unit) || statSync(unit).size < 1e6) {
    console.log(`素材: ${src} から ${UNIT_SEC / 60} 分ぶんを 720p30 で作成中…（初回だけ）`)
    const r = await sh('ffmpeg', [
      '-v', 'error', '-y', '-t', String(UNIT_SEC), '-i', src,
      '-vf', 'scale=-2:720', '-r', '30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      '-c:a', 'aac', '-b:a', '128k',
      unit
    ])
    if (r.code !== 0) {
      console.error('素材の作成に失敗しました:\n' + r.err.slice(0, 800))
      process.exit(2)
    }
  }
  const loops = Math.ceil((minutes * 60) / UNIT_SEC)
  console.log(`素材: ${minutes} 分ぶんに繋ぎ合わせ中…`)
  const r = await sh('ffmpeg', [
    '-v', 'error', '-y',
    '-stream_loop', String(loops), '-i', unit,
    '-t', String(minutes * 60),
    '-c', 'copy', '-fflags', '+genpts',
    out
  ])
  if (r.code !== 0) {
    console.error('素材の繋ぎ合わせに失敗しました:\n' + r.err.slice(0, 800))
    process.exit(2)
  }
  return out
}

/**
 * テロップぶんの内容を作る。長さも文字数もバラつかせて実際に近づける。
 * chars: 1枚あたりのだいたいの文字数（限界を探すときに増やす）
 */
/**
 * テロップの見た目を作る。
 * strokes: 縁取りの枚数 / shadows: 影の枚数 / kinds: 何種類のスタイルを混ぜるか
 * 装飾はプレビューを描くたびに効いてくるので、重さの軸になる。
 */
export function makeStyle(i, { strokes = 1, shadows = 0, kinds = 1 } = {}) {
  const k = kinds > 1 ? i % kinds : 0
  const hue = (k * 37) % 360
  return {
    fontFamily: 'Noto Sans JP',
    fontSize: 60 + (k % 5) * 4,
    bold: k % 2 === 0,
    italic: false,
    align: 'center',
    tracking: (k % 7) * 5,
    leading: (k % 3) * 4,
    fill: { enabled: true, color: `hsl(${hue} 90% 60%)` },
    strokes: Array.from({ length: strokes }, (_, s) => ({
      enabled: true,
      color: `hsl(${(hue + s * 24) % 360} 70% ${20 + s * 5}%)`,
      width: 10 - Math.min(8, s),
      position: 'outside'
    })),
    background: { enabled: k % 4 === 0, color: '#000000', opacity: 40 },
    shadow: { enabled: shadows > 0, color: '#000000', opacity: 70, angle: 135, distance: 6, blur: 8 },
    shadows: Array.from({ length: Math.max(0, shadows - 1) }, (_, s) => ({
      enabled: true,
      color: '#000000',
      opacity: 50,
      angle: (135 + s * 20) % 360,
      distance: 4 + s * 2,
      blur: 6 + s * 3
    }))
  }
}

export function makeCues(count, totalSec, chars = 12, styleOpts = null) {
  const gap = totalSec / count
  const words = ['ここ大事', 'なるほど', 'えっ', 'そういうこと', '待って', '結論から言うと']
  const fill = (i) => {
    let t = ''
    let k = i
    while (t.length < chars) {
      t += words[k++ % words.length] + (t.length % 37 < 6 ? '\n' : '')
    }
    return t.slice(0, chars)
  }
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    start: +(i * gap + 0.2).toFixed(2),
    end: +(i * gap + 0.2 + Math.min(gap * 0.8, 1.2 + (i % 5) * 0.4)).toFixed(2),
    text: fill(i),
    track: 'V2',
    ...(styleOpts ? { style: makeStyle(i, styleOpts) } : {})
  }))
}

/** 動画をn個のクリップに切り分けた状態を作る（切った直後と同じ形） */
export function makeSegments(count, totalSec) {
  const len = totalSec / count
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    srcId: 1,
    srcStart: +(i * len).toFixed(3),
    srcEnd: +((i + 1) * len).toFixed(3)
  }))
}

/** プロジェクトの中身を組み立てる（種類ごとに数を変えられる） */
export function buildProject(
  video,
  totalSec,
  {
    telops = TELOPS,
    chars = 12,
    clips = 1,
    se = 0,
    imgs = 0,
    marks = 0,
    media = 1,
    /** 素材ビンに並べる「別ファイル」の一覧。省略すると全部同じファイルになる */
    mediaFiles = null,
    strokes = 0,
    shadows = 0,
    kinds = 0
  } = {}
) {
  const styleOpts =
    strokes || shadows || kinds
      ? { strokes: strokes || 1, shadows: shadows || 0, kinds: kinds || 1 }
      : null
  const spread = (n, make) =>
    Array.from({ length: n }, (_, i) => make(i, (totalSec * (i + 0.3)) / Math.max(1, n)))
  const project = {
    version: 1,
    videoPath: video,
    srtPath: null,
    sources: [{ id: 1, path: video, name: 'bench.mp4' }],
    ratio: '16:9',
    tracks: [
      { id: 'V3', name: 'V3', kind: 'video' },
      { id: 'V2', name: 'V2', kind: 'video' },
      { id: 'V1', name: 'V1', kind: 'video' },
      { id: 'A1', name: 'A1', kind: 'audio' },
      { id: 'A2', name: 'A2', kind: 'audio' },
      { id: 'A3', name: 'A3', kind: 'audio' }
    ],
    trackStates: {},
    segments: makeSegments(clips, totalSec),
    cues: makeCues(telops, totalSec, chars, styleOpts),
    // 効果音・画像は素材ファイルが要るが、ここで見たいのは「並んでいる数の重さ」。
    // 元動画を指しておけば、読み込みに失敗しても帯は並ぶ。
    seClips: spread(se, (i, t) => ({
      id: i + 1,
      path: video,
      name: 'se.mp4',
      tStart: +t.toFixed(2),
      duration: 1.5,
      track: 'A2'
    })),
    imgClips: spread(imgs, (i, t) => ({
      id: i + 1,
      path: video,
      name: 'img.png',
      tStart: +t.toFixed(2),
      duration: 2,
      track: 'V3'
    })),
    vClips: [],
    markers: spread(marks, (i, t) => ({ id: i + 1, t: +t.toFixed(2), label: 'め' + i })),
    // 素材ビンの中身。
    //
    // **全部が同じファイルだと、実際より軽く出る。** アプリは「同じファイルの
    // サムネは作り直さない」ので、1件ぶんの手間しかかからない。
    // 実際にフォルダを丸ごと読み込むときは全部が別ファイルなので、
    // mediaFiles（別ファイルの一覧）が渡されたらそちらを使う。
    mediaItems: Array.from({ length: media }, (_, i) => ({
      path: mediaFiles?.[i % Math.max(1, mediaFiles.length)] ?? video,
      name: `bench${i}.mp4`,
      kind: 'video'
    })),
    iconSide: 'l',
    iconOffset: { x: 0, y: 0 },
    iconScale: 1
  }
  return project
}

export function makeProject(video, totalSec) {
  const dir = mkdtempSync(join(tmpdir(), 'giftcut-bench-'))
  const userData = join(dir, 'userData')
  mkdirSync(userData, { recursive: true })
  // 1分に1カットくらいは入っている想定にする。クリップが1つだけだと、
  // 掴んで動かしても磁石で元の位置へ戻るので「動かせていない」ことに気づけない。
  const json = JSON.stringify(
    buildProject(video, totalSec, { clips: Math.max(6, Math.round(totalSec / 60)) })
  )
  // 自動保存から復元する経路で開く。ファイル選択ダイアログを触らずに済み、
  // しかも本番と同じ読み込み経路をそのまま通せる。
  writeFileSync(join(userData, 'giftcut-autosave.json'), json, 'utf-8')
  const gcproj = join(dir, 'bench.gcproj')
  writeFileSync(gcproj, json, 'utf-8')
  return { dir, userData, gcproj, bytes: Buffer.byteLength(json) }
}

