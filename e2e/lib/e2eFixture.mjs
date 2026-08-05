// 通しの確認で使う素材を作る／前回の残りを片付ける。
//
// ## 前回の残りは必ず消す
//
// 一時フォルダに動画やプロジェクトが残ったまま次を回すと、**前の回の状態を
// 見て「通った」ことにしてしまう**。しかも e2e を2つ同時に走らせると、
// 互いの素材を消し合って意味不明な失敗になる（そういう作りなので、同時に走らせない）。
//
// ## 素材は毎回作る
//
// 測定（./fixture.mjs）と違い、こちらは軽いので使い回さない。
// **前の回に触った跡が残っていると、確認の意味が無くなる。**
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sh } from './shell.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
/** 画面を1枚撮るだけのとき（--shot）は、前回の残りを消さない */
const SHOT_ONLY = process.argv.includes('--shot')

/**
 * 一時フォルダが**これを超えたら、種類を問わず全部捨てる**（バイト）。
 *
 * 前は `giftcut-e2e-` で始まる物だけを毎回消していたが、
 * **測定（`giftcut-bench-*`）と音の確認（`gc-stutter-*`）が対象外**だった。
 * 測定は1回ごとに60分の動画を作るので、気づいたら
 * **148件・82GB たまっていた**（2026-08-03 に手で消した）。
 *
 * 毎回まとめて消さないのは、測定の使い回し（同じ素材を作り直さない）を
 * 潰さないため。**貯まってから捨てる**方が、待ち時間と容量の折り合いが付く。
 */
const TEMP_LIMIT_BYTES = 5 * 1024 * 1024 * 1024

/** そのフォルダの中身の合計バイト（読めない物は0として数える） */
function dirBytes(dir) {
  let sum = 0
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) sum += dirBytes(full)
      else {
        try {
          sum += statSync(full).size
        } catch {
          /* 消えた・読めない物は数えない */
        }
      }
    }
  } catch {
    /* 読めないフォルダは0 */
  }
  return sum
}

/**
 * 測定・音の確認が残した一時フォルダを、**貯まってから**まとめて捨てる。
 *
 * これだけを別の口にしてあるのは、`cleanLeftovers` が
 * **通しの画面記録（e2e/shots）も消す**から。測定から呼ぶと、
 * 直前に回した通しの記録が消えてしまう。
 */
export function cleanBigTemp() {
  try {
    const others = readdirSync(tmpdir()).filter(
      (f) =>
        (f.startsWith('giftcut-') && !f.startsWith('giftcut-e2e-')) || f.startsWith('gc-stutter-')
    )
    const total = others.reduce((a, f) => a + dirBytes(join(tmpdir(), f)), 0)
    if (total <= TEMP_LIMIT_BYTES) return
    let m = 0
    for (const f of others) {
      try {
        rmSync(join(tmpdir(), f), { recursive: true, force: true })
        m++
      } catch {
        /* 使用中なら次回に回す */
      }
    }
    console.log(
      `測定の一時フォルダが ${(total / 1024 ** 3).toFixed(1)} GB たまっていたので ${m} 件捨てました`
    )
  } catch {
    /* temp が読めない環境では何もしない */
  }
}

/**
 * **いま誰かが使っている**とみなす時間（分）。これより新しいフォルダには手を出さない。
 *
 * ## なぜ要るか（2026-08-05）
 *
 * ここは起動のたびに `giftcut-e2e-*` を**全部**消していた。1本ずつ順に回している
 * 間は正しい（前の回の状態を見て「通った」ことにしないため）。
 *
 * **章を並列で回した瞬間に壊れた。** 後から起動した回が、先に走っている回の
 * 素材を消しにいく。実際の落ち方はこう:
 *
 * ```
 * 確認用の素材に無音を仕込めませんでした
 * Error opening input file …\Temp\giftcut-e2e-HybtnQ\test_video_raw.mp4
 * ```
 *
 * **作った直後のファイルが消えている。** 6章が0秒で死に、生き残った章も
 * 途中までしか走らないまま「緑」を返していた（16-仕上げ が 23件 → 9件）。
 *
 * 30分もあれば1章は終わる。**それより新しい物は、走っている物として扱う。**
 */
const IN_USE_MIN = 30

export function cleanLeftovers() {
  let n = 0
  try {
    // 前の回の残りは消す。ただし**走っているかもしれない物は残す**（上の説明）
    const now = Date.now()
    for (const f of readdirSync(tmpdir())) {
      if (!f.startsWith('giftcut-e2e-')) continue
      const p = join(tmpdir(), f)
      try {
        if (now - statSync(p).mtimeMs < IN_USE_MIN * 60000) continue
        rmSync(p, { recursive: true, force: true })
        n++
      } catch {
        /* 使用中なら次回に回す */
      }
    }
  } catch {
    /* temp が読めない環境では何もしない */
  }
  cleanBigTemp()
  // 前回のスクリーンショットは消す（今回の結果と混ざると読み違える）。
  // ただし撮るだけのときは、前の記録を残しておく。
  //
  // **章を並列で回すときは消さない。** ここも「全部消す」なので、
  // 後から起動した章が、走っている章の写真を消してしまう（素材と同じ事故）。
  // 並列のときは `--chapter=` が付いているので、それを目印にする。
  const 並列かも = process.argv.some((a) => a.startsWith('--chapter='))
  if (!SHOT_ONLY && !並列かも) {
    try {
      rmSync(join(ROOT, 'e2e', 'shots'), { recursive: true, force: true })
    } catch {
      /* 無ければ何もしない */
    }
  }
  // 切り出しキャッシュは新しい2つだけ残す（素材を替えるたびに増えていくため）。
  // **並列のときは触らない**——ここも「古い物を消す」なので、
  // 隣の章がいま読んでいる切り出しを消しうる（素材・写真と同じ事故）
  if (!並列かも) {
    try {
      const cd = join(ROOT, 'e2e', '.cache')
      const files = readdirSync(cd)
        .map((f) => ({ f: join(cd, f), t: statSync(join(cd, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)
      for (const x of files.slice(2)) rmSync(x.f, { force: true })
    } catch {
      /* まだ無い */
    }
  }
  if (n) console.log(`前回までの一時フォルダを ${n} 件片付けました`)
}

export async function makeFixture() {
  cleanLeftovers()
  const dir = mkdtempSync(join(tmpdir(), 'giftcut-e2e-'))
  const userData = join(dir, 'userData')
  mkdirSync(userData, { recursive: true })
  const video = join(dir, 'test_video.mp4')
  const image = join(dir, 'test_image.png')
  const spare = join(dir, 'spare_image.png') // タイムラインでは使わない素材（削除の確認用）
  const sound = join(dir, 'test_sound.wav')

  // 本物の素材があればそこから20秒だけ切り出して使う。
  // 作り物（カラーバー＋サイン波）だと、実際のコーデック・実際の音・実際の絵で
  // しか出ない問題を見逃す。ただし元ファイルは数百MB〜数GBあるので、
  // 冒頭を切り出して軽くしてから使う。無ければ作り物にする（他の環境でも動くように）。
  const DL = 'C:/Users/kyohei/Downloads'
  const pick = (re, maxBytes) => {
    try {
      return readdirSync(DL)
        .filter((f) => re.test(f))
        .map((f) => ({ f: join(DL, f), size: statSync(join(DL, f)).size }))
        .filter((x) => x.size > 0 && x.size < maxBytes)
        .sort((a, b) => a.size - b.size)[0]?.f
    } catch {
      return undefined
    }
  }
  const realVideo = pick(/\.(mp4|mov|mkv)$/i, 4e9)
  const realImage = pick(/\.(png|jpe?g)$/i, 5e6)

  // 切り出しは重いので、一度作ったら使い回す（毎回1から作り直さない）。
  // 元ファイルが変わったら作り直せるよう、名前とサイズをキャッシュ名に入れる。
  const cacheDir = join(ROOT, 'e2e', '.cache')
  mkdirSync(cacheDir, { recursive: true })
  const cached = realVideo
    ? join(cacheDir, `src-${realVideo.split(/[\\/]/).pop().replace(/[^\w.]/g, '_')}-${statSync(realVideo).size}.mp4`)
    : null

  // 素の20秒（まだ黙らせていない）。仕上げは下の「無音を仕込む」でやる
  const raw = join(dir, 'test_video_raw.mp4')
  let r = { code: 1 }
  if (realVideo && cached && existsSync(cached)) {
    console.log(`実素材（作成済みを再利用）: ${realVideo.split(/[\\/]/).pop()}`)
    copyFileSync(cached, raw)
    r = { code: 0 }
  } else if (realVideo) {
    console.log(`実素材を使用: ${realVideo.split(/[\\/]/).pop()}（冒頭20秒を切り出し。次回からは再利用）`)
    r = await sh('ffmpeg', [
      '-y', '-t', '20', '-i', realVideo,
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-vf', 'scale=640:-2', '-c:a', 'aac', '-ac', '2', '-ar', '48000', raw
    ])
    if (r.code === 0 && cached) {
      try {
        copyFileSync(raw, cached)
      } catch {
        /* 保存できなくても動作には影響しない */
      }
    }
  }
  if (!realVideo || r.code !== 0) {
    r = await sh('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=20',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', raw
    ])
  }
  if (r.code !== 0) throw new Error('テスト用の動画を作れませんでした（ffmpeg が必要）: ' + r.err.slice(-300))

  // ---- 無音を仕込む（**素材まかせにしない**）----
  //
  // 無音カットとダッキングは「声の切れ目」が素材に無いと何一つ測れない。
  // ところが素材は Downloads にある**いちばん小さい動画**から取るので、
  // どんな音が入っているかは運まかせだった。2026-08-04、そこへ新しい動画が
  // 増えて選ばれる物が入れ替わり、**無音が1か所も無い20秒**になって3項目が同時に落ちた:
  //
  //   ✗ 余白の設定が効く          理由「余白なしでも切る所が無い（0秒）」
  //   ✗ 無音カットを実行すると…   理由「切る所が見つからない」
  //   ✗ ダッキング…               理由「書き出しに声の音量指定が渡っていない」
  //
  // **どれもアプリの不具合の顔をして出てくる**（3つ目は useSilenceDuck が
  // 「無音0か所 → 曲線は空」なので、書き出しに volume=eval=frame が載らない）。
  // 半日かけて「今日の src/ が原因か」を切り分ける羽目になった。
  //
  // 作り物のフォールバック（途切れない 440Hz のサイン波）にも無音は無いので、
  // **この検査は最初から Downloads の中身の運で通っていた。**
  //
  // 絵も音も本物のまま、決まった3か所だけを黙らせる。20秒より短い素材でも
  // 収まるよう 11秒までに置く。-c:v copy なので絵は焼き直さない（速い）。
  const GAPS = [[2.5, 3.0], [6.0, 6.6], [10.0, 10.4]]
  r = await sh('ffmpeg', [
    '-y', '-i', raw, '-c:v', 'copy',
    '-af', GAPS.map(([a, b]) => `volume=enable='between(t,${a},${b})':volume=0`).join(','),
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', video
  ])
  if (r.code !== 0) throw new Error('確認用の素材に無音を仕込めませんでした: ' + r.err.slice(-300))
  // **成立しなければ落ちる。** ここで数えずに進むと、素材が短すぎた日に
  // また「アプリが壊れた」に見える形で出てくる（上の3件がまさにそれ）。
  const det = await sh('ffmpeg', ['-hide_banner', '-i', video, '-af', 'silencedetect=n=-25dB:d=0.2', '-f', 'null', '-'])
  const gaps = (det.err.match(/silence_start/g) || []).length
  if (gaps < GAPS.length)
    throw new Error(
      `確認用の素材に無音が ${gaps} か所しかありません（${GAPS.length} か所要る）。` +
        '素材が短すぎるか、音が入っていない可能性があります: ' + (realVideo ?? '作り物')
    )

  r = realImage
    ? await sh('ffmpeg', ['-y', '-i', realImage, '-vf', 'scale=320:-2', '-frames:v', '1', image])
    : { code: 1 }
  if (r.code !== 0) {
    r = await sh('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=200x200:d=1', '-frames:v', '1', image])
  }
  if (r.code !== 0) throw new Error('テスト用の画像を作れませんでした')
  await sh('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x160:d=1', '-frames:v', '1', spare])
  r = await sh('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2', sound])
  if (r.code !== 0) throw new Error('テスト用の音声を作れませんでした')

  // 起動した瞬間に「編集途中の状態」から始められるよう、自動保存を仕込んでおく。
  // 素材の読み込みは OS のファイル選択ダイアログを通るので自動化できない。
  // 自動保存からの復元なら、本番と同じ経路のままダイアログを避けられる。
  const project = {
    version: 1,
    videoPath: video,
    srtPath: null,
    sources: [{ id: 1, path: video, name: 'test_video.mp4' }],
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
    // 3つに切ったクリップ（それぞれ5秒）
    segments: [
      { id: 1, srcId: 1, srcStart: 0, srcEnd: 5 },
      { id: 2, srcId: 1, srcStart: 5, srcEnd: 10 },
      { id: 3, srcId: 1, srcStart: 10, srcEnd: 15 }
    ],
    cues: [
      { id: 1, start: 1, end: 3, text: 'ひとつめ', track: 'V2' },
      { id: 2, start: 6, end: 8, text: 'ふたつめ', track: 'V2' }
    ],
    seClips: [
      { id: 1, path: sound, name: 'test_sound.wav', tStart: 2, duration: 2, track: 'A2' }
    ],
    imgClips: [
      { id: 1, path: image, name: 'test_image.png', tStart: 1, duration: 4, track: 'V3' }
    ],
    vClips: [],
    markers: [{ id: 1, t: 12, label: 'めじるし' }],
    mediaItems: [
      { path: video, name: 'test_video.mp4', kind: 'video' },
      { path: image, name: 'test_image.png', kind: 'image' },
      { path: spare, name: 'spare_image.png', kind: 'image' },
      { path: sound, name: 'test_sound.wav', kind: 'audio' }
    ],
    iconSide: 'l',
    iconOffset: { x: 0, y: 0 },
    iconScale: 1
  }
  writeFileSync(join(userData, 'giftcut-autosave.json'), JSON.stringify(project), 'utf-8')
  // 同じ内容をプロジェクトファイルにも書いておく。各章の前にこれを開き直して、
  // どの確認も「同じ状態から始める」ようにする（前の章の操作を引きずらない）。
  // 字幕ファイル。本物があればそれを使う（実際の改行や記号が入っているので、
  // 自分で作ったきれいなものでは出ない問題が見つかる）。
  const srt = join(dir, 'test.srt')
  const realSrt = pick(/\.srt$/i, 2e6)
  if (realSrt) {
    try {
      writeFileSync(srt, readFileSync(realSrt, 'utf-8'), 'utf-8')
    } catch {
      /* 読めなければ作り物にする */
    }
  }
  if (!existsSync(srt)) {
    const cue = (n, a, b, t) => `${n}
00:00:0${a},000 --> 00:00:0${b},000
${t}

`
    writeFileSync(
      srt,
      cue(1, 1, 3, 'よみこんだ字幕1') + cue(2, 4, 6, 'よみこんだ字幕2') + cue(3, 7, 9, 'よみこんだ字幕3'),
      'utf-8'
    )
  }
  const gcproj = join(dir, 'fixture.gcproj')
  writeFileSync(gcproj, JSON.stringify(project), 'utf-8')
  // 手つかずの控え。保存のテストは開いているファイルへ上書き保存するので、
  // これが無いと以降のリセットが「編集後の状態」から始まってしまう
  // （実際に、後の確認が2件それで落ちた）。リセットのたびに書き戻す。
  const gcprojOrig = join(dir, 'fixture.orig.gcproj')
  writeFileSync(gcprojOrig, JSON.stringify(project), 'utf-8')
  return { dir, userData, video, image, spare, sound, srt, gcproj, gcprojOrig }
}

// ---------------------------------------------------------------------------
// 結果の集計
