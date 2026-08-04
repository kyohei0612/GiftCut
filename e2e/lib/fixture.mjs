// 測るための素材を作る。長い動画・テロップ・切片・プロジェクトのファイル。
//
// ## 作った物は使い回す
//
// 60分の動画を毎回作ると、測るより作る方が長くかかる。CACHE に置いて次から再利用する。
// **素材が変わると数字も変わる**ので、前回と比べるときは同じ素材で測ること。
import { sh } from './shell.mjs'
import { fmt, mb } from './fmt.mjs'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
/** 作った素材の置き場。**毎回作り直すと測るより長くかかる**ので使い回す */
export const CACHE = join(ROOT, 'e2e', '.cache')
/** 測るときに載せるテロップの枚数（前回と比べるので変えないこと） */
export const TELOPS = 200

/**
 * **どれくらい編集された物を基準にするか。**
 *
 * ## 既定を `tv` にした理由（2026-08-04）
 *
 * それまでの基準は「1時間の素材＋テロップ200枚・カット1個」だった。
 * **これは編集していないのとほぼ同じ**で、軽くて当たり前の状態を
 * 「問題なし」と記録し続けていた。
 *
 * 本当に守りたいのは**めちゃくちゃ編集したとき**なので、
 * テレビの編集（1時間のバラエティ）を既定にする。
 *
 * ## 比べるときは `light` を使う
 *
 * 2026-08-03 までの数字（19 良好 / 0 問題あり・止まり0ms）は **`light` で
 * 測った物**。プロファイルが違う数字を並べて「重くなった」と言わないこと。
 *
 * ## 目指す形
 *
 * **`light` と `tv` で1操作の重さが変わらないのが正解。** 差が出たら、それは
 * 「見えていない物まで作っている」印（`bench-limits.mjs` の頭にある考え方と同じ）。
 * 限界値を探すより、**傾きがゼロか**を見る。
 */
export const PROFILES = {
  /** 2026-08-03 まではこれが既定だった。過去の数字と比べるとき用 */
  light: { telops: 200, clips: 1, se: 0, imgs: 0, vids: 0, marks: 0, motions: 0, trans: 0 },
  /**
   * テレビの編集マン（1時間のバラエティ1本ぶん）。
   * カットが細かく、テロップが常時出ていて、フリップとインサートが頻繁に入る。
   */
  tv: {
    telops: 1200, // 常時テロップ。1時間なら1000枚超はふつう
    chars: 14,
    clips: 600, // 細かいカット割り（平均6秒）
    se: 200, // ジングル・効果音
    imgs: 120, // フリップ・写真
    vids: 80, // インサート映像・ワイプ
    marks: 150, // めじるし
    motions: 100, // 寄り・引き（キーフレーム）
    motionKeys: 4,
    trans: 80, // 切り替え効果
    media: 40, // 素材ビン
    strokes: 2,
    shadows: 1,
    kinds: 6
  }
}


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

/**
 * @param {boolean} overlap **同じ時刻に重ねる**（0〜10秒へ寄せる）。
 *   既定（false）は尺全体へばらけさせるので、再生ヘッドの位置には常に
 *   1〜2枚しか居ない。**「1200枚置いた」と「1200枚同時に見えている」は別物**で、
 *   描く重さが出るのは後者。
 *   ※ ここを入れ忘れて、「同時に見えている数」の軸が**1枚も重ねずに緑**に
 *     なっていた（2026-08-04・使い捨ての確認で捕まえた）。
 */
export function makeCues(count, totalSec, chars = 12, styleOpts = null, overlap = false) {
  const gap = overlap ? 10 / count : totalSec / count
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
    // 重ねるときは長さを gap に縛らない（縛ると隣り合うだけで重ならない）
    end: +(
      i * gap +
      0.2 +
      (overlap ? 8 : Math.min(gap * 0.8, 1.2 + (i % 5) * 0.4))
    ).toFixed(2),
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

/**
 * **本物の画像を作る**（枚数と解像度を指定）。
 *
 * ## なぜ要るか
 *
 * 2026-08-04 まで、「画像の数」の軸は `path` に**元動画**を指していた
 * （下の buildProject のコメントに「読み込みに失敗しても帯は並ぶ」とある）。
 * つまり測っていたのは**タイムラインに帯が並ぶ重さだけ**で、
 * **デコードもサムネ生成もメモリも1度も測っていなかった。**
 *
 * ## 1枚ずつ中身を変える
 *
 * 同じファイルだと、アプリは「同じ物のサムネは作り直さない」ので
 * **1枚ぶんの手間しかかからず、実際より軽く出る**（素材ビンの軸で踏んだのと同じ穴）。
 * `testsrc2` は時間で絵が変わるので、`-ss` をずらして別の絵を切り出す。
 * 模様が入っているぶん PNG が縮まないので、**容量の軸としても本物に近い。**
 */
export async function makeImages(count, px = 1920) {
  const dir = join(CACHE, `imgs-${px}`)
  mkdirSync(dir, { recursive: true })
  const h = Math.round((px * 9) / 16 / 2) * 2
  const out = []
  for (let i = 0; i < count; i++) {
    const p = join(dir, `img${i}.png`)
    out.push(p)
    if (existsSync(p) && statSync(p).size > 1000) continue
    const r = await sh('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-ss', String(i % 60), '-i', `testsrc2=size=${px}x${h}:rate=1`,
      '-frames:v', '1', p
    ])
    if (r.code !== 0) {
      console.error(`画像の作成に失敗しました（${px}px）:\n` + r.err.slice(0, 400))
      process.exit(2)
    }
  }
  return out
}

/**
 * **本物の短い動画を作る**（タイムラインへ置く動画クリップ用）。
 *
 * ## なぜ要るか
 *
 * `buildProject` は長らく `vClips: []` を固定していた。つまり
 * **V2/V3 に別素材の動画を置く形は、負荷を1度も測っていない。**
 * 動画クリップは拡大・動き・切り抜き・色調整を持てるので、画像より重いはず。
 *
 * **1本ずつ別ファイルにする。** 同じファイルを何本も置くと、デコーダが
 * 使い回されて実際より軽く出る（画像と同じ理由）。
 */
export async function makeClipVideos(count, sec = 3) {
  const dir = join(CACHE, `vids-${sec}s`)
  mkdirSync(dir, { recursive: true })
  const out = []
  for (let i = 0; i < count; i++) {
    const p = join(dir, `vid${i}.mp4`)
    out.push(p)
    if (existsSync(p) && statSync(p).size > 10000) continue
    const r = await sh('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-ss', String(i % 60), '-i', 'testsrc2=size=1280x720:rate=30',
      '-f', 'lavfi', '-i', `sine=frequency=${440 + i * 7}`,
      '-t', String(sec),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      '-c:a', 'aac', '-b:a', '96k', '-shortest',
      p
    ])
    if (r.code !== 0) {
      console.error('動画クリップの作成に失敗しました:\n' + r.err.slice(0, 400))
      process.exit(2)
    }
  }
  return out
}

/**
 * 動き（キーフレーム）を1本ぶん作る。
 *
 * `keys` は**打つ印の数**。書き出しでは印の数だけ式が伸びる（`keysToExpr`）ので、
 * 画面より書き出しの方に効く可能性がある。両方測ること。
 */
export function makeMotion(keys, dur) {
  const at = (i) => +((dur * i) / Math.max(1, keys - 1)).toFixed(2)
  return {
    sc: Array.from({ length: keys }, (_, i) => ({ t: at(i), v: 1 + (i % 3) * 0.15, e: 'ease' })),
    x: Array.from({ length: keys }, (_, i) => ({ t: at(i), v: ((i % 5) - 2) * 0.04, e: 'ease' })),
    y: Array.from({ length: keys }, (_, i) => ({ t: at(i), v: ((i % 3) - 1) * 0.03, e: 'ease' }))
  }
}

/** 切り替え効果（エフェクト）の種類。どれも頭・尻・間のどこにでも置ける */
const TRANS_KINDS = ['fade', 'dipblack', 'dipwhite', 'wipeleft', 'slideup']

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
    kinds = 0,
    /** タイムラインへ置く動画クリップの数（V2/V3） */
    vids = 0,
    /** 動画クリップの元ファイル一覧（`makeClipVideos`）。省略すると元動画を指す */
    vidFiles = null,
    /**
     * 動画クリップ1本の長さ（秒）。**元ファイルの尺と合わせること。**
     * 長く取ると素材の終わりを越えて、実際より軽く出る（読む物が無いので）。
     */
    vidSec = 3,
    /** 画像クリップの元ファイル一覧（`makeImages`）。省略すると元動画を指す */
    imgFiles = null,
    /** 動き（キーフレーム）を持たせる数。切片→画像→動画クリップの順に配る */
    motions = 0,
    /** 動き1本あたりに打つ印の数 */
    motionKeys = 4,
    /** 切り替え効果（エフェクト）を付ける切片の数 */
    trans = 0,
    /**
     * **同じ時刻に重ねるか。**
     *
     * 既定（false）は尺全体へばらけさせるので、再生ヘッドの位置には常に1〜2個しか
     * 居ない。**「200枚置いた」と「200枚同時に見えている」は別物**なので、
     * 描画の重さを見たいときは true にして 0〜10秒へ寄せる。
     */
    overlap = false
  } = {}
) {
  const styleOpts =
    strokes || shadows || kinds
      ? { strokes: strokes || 1, shadows: shadows || 0, kinds: kinds || 1 }
      : null
  // overlap:true のときは 0〜10秒へ寄せる（同時に見えている数を測るため）
  const spread = (n, make) =>
    Array.from({ length: n }, (_, i) =>
      make(i, overlap ? (i % 10) * 0.5 : (totalSec * (i + 0.3)) / Math.max(1, n))
    )
  // 動きを配る枚数。切片 → 画像 → 動画クリップ の順に埋める
  let motionLeft = motions
  const takeMotion = (dur) => (motionLeft-- > 0 ? makeMotion(motionKeys, dur) : undefined)
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
    segments: makeSegments(clips, totalSec).map((s, i) => ({
      ...s,
      // 動きは切片から先に配る（本編に付くのが一番ふつうの使い方なので）
      ...(motionLeft > 0 ? { motion: takeMotion(s.srcEnd - s.srcStart) } : {}),
      // 切り替え効果は「間（xfade）」に置く。最後の切片には次が無いので付けない
      ...(i < trans && i < clips - 1
        ? { xfade: { type: TRANS_KINDS[i % TRANS_KINDS.length], dur: 0.5 } }
        : {})
    })),
    cues: makeCues(telops, totalSec, chars, styleOpts, overlap),
    // 効果音は素材ファイルが要るが、ここで見たいのは「並んでいる数の重さ」。
    // 元動画を指しておけば、読み込みに失敗しても帯は並ぶ。
    seClips: spread(se, (i, t) => ({
      id: i + 1,
      path: video,
      name: 'se.mp4',
      tStart: +t.toFixed(2),
      duration: 1.5,
      track: 'A2'
    })),
    // **画像は imgFiles を渡すと本物になる**（デコード・サムネ・メモリが初めて効く）。
    // 渡さないときは今までどおり元動画を指す＝帯の数だけを見る。
    imgClips: spread(imgs, (i, t) => ({
      id: i + 1,
      path: imgFiles?.[i % imgFiles.length] ?? video,
      name: imgFiles ? `img${i}.png` : 'img.png',
      tStart: +t.toFixed(2),
      duration: 2,
      track: 'V3',
      ...(motionLeft > 0 ? { motion: takeMotion(2) } : {})
    })),
    // **動画クリップ。** 2026-08-04 まで常に空だった＝この形は未測定だった。
    vClips: spread(vids, (i, t) => ({
      id: i + 1,
      path: vidFiles?.[i % vidFiles.length] ?? video,
      name: vidFiles ? `vid${i}.mp4` : 'bench.mp4',
      track: 'V2',
      tStart: +t.toFixed(2),
      srcStart: 0,
      srcEnd: vidSec,
      ...(motionLeft > 0 ? { motion: takeMotion(vidSec) } : {})
    })),
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

export function makeProject(video, totalSec, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'giftcut-bench-'))
  const userData = join(dir, 'userData')
  mkdirSync(userData, { recursive: true })
  // 1分に1カットくらいは入っている想定にする。クリップが1つだけだと、
  // 掴んで動かしても磁石で元の位置へ戻るので「動かせていない」ことに気づけない。
  // ※ プロファイル（PROFILES）が clips を持っていればそちらが勝つ。
  const json = JSON.stringify(
    buildProject(video, totalSec, {
      clips: Math.max(6, Math.round(totalSec / 60)),
      ...opts
    })
  )
  // 自動保存から復元する経路で開く。ファイル選択ダイアログを触らずに済み、
  // しかも本番と同じ読み込み経路をそのまま通せる。
  writeFileSync(join(userData, 'giftcut-autosave.json'), json, 'utf-8')
  const gcproj = join(dir, 'bench.gcproj')
  writeFileSync(gcproj, json, 'utf-8')
  return { dir, userData, gcproj, bytes: Buffer.byteLength(json) }
}

/**
 * **本物のプロジェクトファイルで測る**（`npm run bench -- --project=<path>`）。
 *
 * 作り物の素材は「テロップ200枚が等間隔に並ぶ」ような素直な形になりがちで、
 * 実際の編集で出る重さ（段が11本ある・切片が細かく刻まれている・
 * 効果音が重なっている）が出てこない。本人のファイルをそのまま開いて測れる口。
 *
 * **原本は触らない。** 一時フォルダへ写してから開く（自動保存の経路も一時側）。
 * 素材のパスは絶対パスのままなので、素材が動いていると読み込みで欠ける
 * ——その場合は開いた直後に画面が「素材が見つかりません」を出すので、
 * 数字を読む前にそこを見ること。
 */
export function useRealProject(srcPath) {
  const dir = mkdtempSync(join(tmpdir(), 'giftcut-bench-'))
  const userData = join(dir, 'userData')
  mkdirSync(userData, { recursive: true })
  const json = readFileSync(srcPath, 'utf-8')
  writeFileSync(join(userData, 'giftcut-autosave.json'), json, 'utf-8')
  const gcproj = join(dir, 'bench.gcproj')
  writeFileSync(gcproj, json, 'utf-8')
  return { dir, userData, gcproj, bytes: Buffer.byteLength(json) }
}

