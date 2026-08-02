// 書き出し。**このアプリでいちばん取り返しがつかない処理。**
//
// ## なぜ独立しているか
//
// 959行あり、main/index.ts の中でここだけが飛び抜けて大きかった。
// 渡す物を数えたら **0個**（状態も型も、この話題の中だけで閉じている）ので出した。
//
// ## 直すときに必ず気をつけること
//
// **画面で正しく見えても、書き出すと違う**という壊れ方をする。しかも
// やり直しに何分もかかるので、気づくのが遅い。実際に起きた:
//
//   - 拡大していないと X/Y が効かない … 等倍だと切り抜く余地がゼロで、位置が0に丸められていた
//   - テロップがチカチカする … 窓の終わりを半フレーム詰めていて、窓と窓の間に隙間ができていた
//
// **画面と同じ計算を通すこと。** 動き（キーフレーム）は shared/clipMotion、
// テロップの出る窓は shared/filterGraph の overlayEnableExpr。
// ここで別の式を書き起こさない（別々に書くと必ずズレる）。
//
// ## ffmpeg の呼び方
//
// 起動は必ず ./ffmpegRun 経由。直に spawn すると、
// アプリを閉じた後も変換が走り続ける（追跡から漏れるため）。
import { app, dialog, ipcMain, shell } from 'electron'
import { dirname, join, normalize, resolve } from 'path'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { writeFile as writeFileAsync } from 'fs/promises'
import { tmpdir, cpus } from 'os'
import { spawn, type ChildProcess } from 'child_process'
// フィルタグラフは ffmpeg を起動する前に検証する（入力indexのズレ・ラベルの
// 定義漏れ・無音素材からの音声参照は、起動して初めて分かると原因が読めない）。
import {
  formatGraphProblems,
  hasGraphError,
  keepBranchesFor,
  overlayEnableExpr,
  validateFilterGraph,
  type GraphInput
} from '../shared/filterGraph'
// クリップ・画像の動き（キーフレーム）。**画面と同じ折れ線を式にする**ので、
// 焼き方をここで別に考えない（別々に書くと、見た絵と出来た絵が違う事故になる）。
import { hasClipMotion, zoomPanChain, zoompanFilter, type ClipMotion } from '../shared/clipMotion'
// 色調整のフィルタ。**GPL 専用の eq は使えない**（同梱は LGPL 版）ので、
// 同じ計算を lutyuv で書いてある。
import { colorAdjustFilter } from '../shared/colorAdjust'
// 書き出し先が素材と同じだと ffmpeg は必ず失敗する。始める前に気づいて日本語で言う
import { clashingSource } from '../shared/exportTarget'
import { uniqueName } from '../shared/exportDefaults'
import { ENCODERS, crfToBitrateK } from './encoders'
import {
  FFMPEG,
  FFPROBE,
  filterScriptArgs,
  hasAudioStream,
  liveTmpDirs,
  trackedSpawn,
  tryEncoder,
  useEncoder,
  videoEncoder
} from './ffmpegRun'

// 書き出し中の ffmpeg プロセス（キャンセル用）。exportCanceled でユーザー中断とエラーを区別する。
let currentExportFf: ChildProcess | null = null
let exportCanceled = false

interface ExportFrame {
  png: string
  start: number
  end: number
}
interface ExportSeg {
  srcIdx?: number // 入力（元動画）index。マルチソース。未指定=0
  srcStart: number
  srcEnd: number
  muted?: boolean
  videoBlank?: boolean
  speed?: number
  transIn?: { type: string; dur: number } // 頭
  transOut?: { type: string; dur: number } // 尻
  xfade?: { type: string; dur: number } // 次の切片との間
  adjust?: { b: number; c: number; s: number } // 色調整（明るさ/コントラスト/彩度）
  rotate?: number // 回転（90/180/270 or 自由角度）
  flipH?: boolean
  flipV?: boolean
  vol?: number // 音量倍率
  afadeIn?: number // 音声フェードイン秒
  afadeOut?: number // 音声フェードアウト秒
  zoom?: { scale: number; x: number; y: number } // リフレーム（切片ごと）
  motion?: ClipMotion // 動き（キーフレーム）。付いていれば zoom は時間で変わる
  crop?: { l: number; t: number; r: number; b: number } // クロップ（各辺の切り抜き率, 切った領域は黒）
}
interface ExportSEClip {
  path: string
  tStart: number
  duration: number
  srcOffset?: number // 音源内の開始オフセット（左端トリム/分割）
  volume?: number
  fadeIn?: number
  fadeOut?: number
  /**
   * 声が入っている間だけ下げるための音量式（ffmpeg の volume に渡す）。
   * プレビューで使っている折れ線をそのまま式にしたもの。
   */
  duckExpr?: string
}
interface ExportPayload {
  videoPath: string
  sources?: { path: string }[] // マルチソース。入力に使う元動画一覧（未指定なら[videoPath]）
  // 画像クリップ（テロップの下に重ねる）。変形/調整は動画切片と同じモデル。
  images?: {
    path: string
    tStart: number
    duration: number
    zoom?: { scale: number; x: number; y: number }
    motion?: ClipMotion
    rotate?: number
    flipH?: boolean
    flipV?: boolean
    opacity?: number
    adjust?: { b: number; c: number; s: number }
    crop?: { l: number; t: number; r: number; b: number }
  }[]
  // 映像レイヤークリップ（V2以降に置いた動画。本編映像の上に重ねる。音声もミックスする）
  vClips?: {
    path: string
    tStart: number
    srcStart: number
    srcEnd: number
    zoom?: { scale: number; x: number; y: number }
    motion?: ClipMotion
    rotate?: number
    flipH?: boolean
    flipV?: boolean
    opacity?: number
    adjust?: { b: number; c: number; s: number }
    crop?: { l: number; t: number; r: number; b: number }
    volume?: number
    fadeIn?: number
    fadeOut?: number
  }[]
  width: number
  height: number
  frames: ExportFrame[]
  extendSec?: number
  segments?: ExportSeg[]
  seClips?: ExportSEClip[]
  baseAudioVolume?: number
  loudnormLUFS?: number | null
  totalDurationSec?: number // 進捗%算出用の出力尺
  fps?: number // 書き出しフレームレート（既定30）
  crf?: number // 画質（x264 CRF。小さいほど高画質。既定23）
  /**
   * 連番でまとめて受け取るテロップ。**書き出しの速さはここで決まる。**
   *
   * 1枚＝入力1つ＋重ね1段だと、枚数に比例して遅くなる（1080p60秒の実測で
   * 0枚 5.1秒 / 200枚 10.7秒 / 600枚 23.3秒）。同じ600枚を連番1入力＋重ね1段に
   * すると 5.2秒＝重ねないのとほぼ同じになる。
   *
   * ここへ来るのは**等間隔で全区間を刻んでいる物だけ**（画面側が並びを見て決める）。
   * 頭と尻の演出だけのテロップは真ん中に長い静止区間があるので `frames` の方へ来る。
   */
  telopSeqs?: { start: number; end: number; fps: number; pngs: string[] }[]
  /**
   * 出す先（フルパス）。**画面側で決まっているなら、ここで聞き直さない。**
   *
   * 書き出しの窓で「どこへ・どの名前で」を決めてから押す作りにしたので、
   * そのあとにもう一度ファイル選択が出ると二度手間になる。
   * 無いときだけ今までどおり選択の窓を出す（画面側が決められなかった場合の逃げ道）。
   */
  outPath?: string
}

/**
 * いま書き出している最中か。
 *
 * **自動更新が見ている。** 書き出しの途中で再起動されると、何分もかけた変換が
 * 消えて、しかも出来かけのファイルが残る。
 */
export function isExporting(): boolean {
  return !!currentExportFf
}

/**
 * 書き出しの受け口を登録する。**app.whenReady() の中で1回だけ呼ぶ。**
 */
export function registerExportHandlers(): void {
// 動画書き出し（FFmpegでテロップPNGを焼き込み）
ipcMain.handle('export:cancel', () => {
  // **ffmpeg が始まる前でも「中止」を覚えておく。**
  // 書き出しの前半はテロップの画像作りで、ここは ffmpeg がまだ動いていない。
  // 以前は「動いていなければ何もしない」だったので、その間に中止を押しても
  // 黙って書き出しが続いていた（テロップが多いほどこの時間は長い）。
  exportCanceled = true
  if (currentExportFf) {
    try {
      currentExportFf.kill('SIGKILL')
    } catch {
      /* noop */
    }
    return { ok: true }
  }
  return { ok: false }
})

ipcMain.handle('export:run', async (e, payload: ExportPayload) => {
  // 始める前に「中止」の印を落とす。前回の中止が残っていると、
  // 次の書き出しが始まった瞬間に止まる
  exportCanceled = false
  const { videoPath, width, height, frames, extendSec, segments } = payload
  const baseVol = typeof payload.baseAudioVolume === 'number' ? payload.baseAudioVolume : 1
  if (!videoPath) {
    return { ok: false, error: '動画がありません' }
  }
  // マルチソース: 入力に使う元動画一覧（未指定なら[videoPath]）。存在チェック。
  const inputPaths = payload.sources?.length ? payload.sources.map((s) => s.path) : [videoPath]
  for (const ip of inputPaths) {
    if (!existsSync(ip)) return { ok: false, error: '元の動画ファイルが見つかりません:\n' + ip }
  }
  const nSrc = inputPaths.length
  // 各入力の音声有無（ffprobe不明はありとして扱う）。音声なしソースの切片は無音で埋める。
  const srcHasAudio = await Promise.all(inputPaths.map(async (ip) => (await hasAudioStream(ip)) !== false))
  // 全体として音声を扱うか（どれか1つでも音声があれば音声トラックを作る）
  const audioPresent = srcHasAudio.some(Boolean)
  // 出す先。**画面側で決まっていれば聞かない**（窓で決めてから押す作りなので、
  // ここでもう一度選択が出ると二度手間になる）。決まっていなければ今までどおり選ばせる。
  const save = payload.outPath
    ? { canceled: false, filePath: payload.outPath }
    : await dialog.showSaveDialog({
        title: '書き出し先を選択',
        defaultPath: 'giftcut_output.mp4',
        filters: [
          { name: 'MP4', extensions: ['mp4'] },
          { name: 'MOV', extensions: ['mov'] }
        ]
      })
  if (save.canceled || !save.filePath) return { ok: false, error: 'キャンセルされました' }
  // **置き場が無いときは、始める前に日本語で言う。**
  // ffmpeg に任せると英語のパスエラーになり、何分か待たされた末に理由が読めない
  if (!existsSync(dirname(save.filePath)))
    return { ok: false, error: '書き出し先のフォルダが見つかりません:\n' + dirname(save.filePath) }
  // **同じ名前があっても上書きしない。** 消えるのは「前に何分もかけて作った物」で、
  // しかも消えたことに気づくのは探しに行ったとき。名前の後ろに (1) を付けて避ける。
  //
  // ここ（始める直前）で決めるのは、窓を開けてから押すまでの間に
  // 同じ名前のファイルが増えていることがあるため。名前の作り方は
  // shared/exportDefaults（画面を起動せずに確かめられる）。
  //
  // ※ 選択の窓を通ったときは、その窓が既に「上書きしますか」を聞いている。
  //   そこで「はい」と答えた人の意思まで覆すと、狙って上書きできなくなる。
  if (payload.outPath) {
    const dir = dirname(save.filePath)
    const file = save.filePath.slice(dir.length + 1)
    const dot = file.lastIndexOf('.')
    const base = dot > 0 ? file.slice(0, dot) : file
    const ext = dot > 0 ? file.slice(dot + 1) : 'mp4'
    save.filePath = join(dir, uniqueName(base, ext, (n) => existsSync(join(dir, n))))
  }
  /** 音だけ出すか（.mp3）。組み立てより前に要る（下の keepBranchesFor で使う） */
  const audioOnly = /\.mp3$/i.test(save.filePath)

  // **書き出し先が、いま素材として使っているファイルだと ffmpeg は必ず失敗する。**
  // 「前に書き出した物をタイムラインに読み込んで、また同じ名前へ書き出す」で起きる。
  // ffmpeg は同じファイルを読みながら書き換えられないので、
  //
  //     Output … same as Input #0 - exiting / FFmpeg cannot edit existing files in-place.
  //
  // という英語の壁が出るだけになる。原因は分かっているので、こちらで止めて
  // **何が起きたか・どうすればよいか**を日本語で言う。
  // 素材（動画・映像レイヤー・画像・音）を全部見て突き合わせる。
  const usedPaths = [
    ...inputPaths,
    ...(payload.vClips ?? []).map((c) => c.path),
    ...(payload.images ?? []).map((c) => c.path),
    ...(payload.seClips ?? []).map((c) => c.path)
  ].filter(Boolean)
  const clash = clashingSource(save.filePath, usedPaths)
  if (clash) {
    const name = clash.split(/[\/]/).pop()
    return {
      ok: false,
      error:
        `書き出し先が、いま素材として使っている「${name}」と同じファイルです。
` +
        '読みながら同じファイルへ書くことはできないので、別の名前にしてください。'
    }
  }

  // PNG を一時ファイルへ
  const tmp = join(app.getPath('temp'), 'giftcut_' + Date.now())
  mkdirSync(tmp, { recursive: true })
  liveTmpDirs.add(tmp) // アプリ終了時に確実に消せるよう登録（cleanup で外す）
  const pngPaths: string[] = []
  // PNG は tmp 直下に置き、ffmpeg には「相対パス」で渡す（cwd=tmp で spawn する）。
  // 絶対パスだと 1 枚あたり約63字を消費し、テロップが数百枚でコマンドライン長が
  // Windows の上限(32767字)を超えて spawn ENAMETOOLONG になるため。
  const toPng = (dataUrl: string): Buffer =>
    Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
  frames.forEach((f, i) => {
    writeFileSync(join(tmp, `t${i}.png`), toPng(f.png))
    pngPaths.push(`t${i}.png`)
  })
  // 連番でまとめて渡すテロップ。**重ねる段が1本で済むので、枚数が増えても重くならない**
  // （1080p60秒の実測で、1枚ずつ重ねると600枚 23.3秒 / 連番なら 5.2秒）。
  // 画像は `q<何本目>_00000.png` の形で並べ、ffmpeg には `q<何本目>_%05d.png` で渡す。
  const seqs = (payload.telopSeqs ?? []).filter((s) => s.pngs.length > 0)
  const seqPatterns: string[] = []
  seqs.forEach((sq, k) => {
    sq.pngs.forEach((p, i) => {
      writeFileSync(join(tmp, `q${k}_${String(i).padStart(5, '0')}.png`), toPng(p))
    })
    seqPatterns.push(`q${k}_%05d.png`)
  })

  // FFmpeg 引数を組み立て
  // 実在する SE ファイルのみ採用（欠損ファイルがあると FFmpeg 全体が失敗するため除外）
  const sesRaw = payload.seClips?.filter((s) => s && s.path && existsSync(s.path)) ?? []
  const ses = sesRaw.length ? sesRaw : null
  // 画像クリップ（実在ファイルのみ）
  const imgsRaw = payload.images?.filter((c) => c && c.path && existsSync(c.path)) ?? []
  const imgs = imgsRaw.length ? imgsRaw : null
  // 映像レイヤークリップ（実在ファイルのみ）
  const vcsRaw = payload.vClips?.filter((c) => c && c.path && existsSync(c.path)) ?? []
  const vcs = vcsRaw.length ? vcsRaw : null
  const args = ['-y']
  const segs = segments && segments.length ? segments : null

  // ---- 入力の重複排除 ----
  // 以前は「クリップ1つ＝-i 1本」だったため、同じ動画をレザーで分割すると同じファイルが
  // クリップ数ぶん開かれ、デコーダも同数走った（絶対パスぶんコマンドライン長も膨らむ）。
  // パス→入力index のマップで同一パスは -i 1本にまとめる。入力は
  // 元動画 → テロップPNG → SE → 画像 → 映像レイヤー の順に登録する（従来の並びを踏襲）。
  // pre は -i の前に置く引数（連番の -framerate など）。入力ごとに違うので持たせる
  const inputSpecs: { path: string; ss: number; pre?: string[] }[] = []
  const inputIdx = new Map<string, number>()
  const addInput = (p: string, pre?: string[]): number => {
    const key = normalize(p)
    const found = inputIdx.get(key)
    if (found !== undefined) return found
    inputIdx.set(key, inputSpecs.length)
    inputSpecs.push({ path: p, ss: 0, pre })
    return inputSpecs.length - 1
  }
  // 各パスを使うクリップ数。1つだけなら入力 -ss でデコード開始位置を飛ばせる（下記）。
  const userCount = new Map<string, number>()
  const addUser = (p: string): void => {
    const key = normalize(p)
    userCount.set(key, (userCount.get(key) ?? 0) + 1)
  }
  if (segs) segs.forEach((s) => addUser(inputPaths[s.srcIdx ?? 0]))
  else inputPaths.forEach((ip) => addUser(ip)) // カット無し＝元動画をそのまま使う（trim が無いので -ss 不可）
  ses?.forEach((se) => addUser(se.path))
  imgs?.forEach((im) => addUser(im.path))
  vcs?.forEach((vc) => addUser(vc.path))
  const srcInput = inputPaths.map((ip) => addInput(ip)) // 元動画の srcIdx → 入力index
  const pngInput = pngPaths.map((p) => addInput(p))
  // 連番は1本＝入力1つ。**-framerate は -i より前**でないと効かない（画像の並びの
  // 「1枚あたり何秒か」を決める指定なので、入力の解釈に関わる）。
  // -start_number は 0 始まりを明示（既定は1で、こちらは0から書いている）。
  const seqInput = seqs.map((sq, k) =>
    addInput(seqPatterns[k], ['-framerate', String(sq.fps), '-start_number', '0'])
  )
  const seInput = ses ? ses.map((se) => addInput(se.path)) : []
  const imgInput = imgs ? imgs.map((im) => addInput(im.path)) : []
  const vcInput = vcs ? vcs.map((vc) => addInput(vc.path)) : []

  // 入力 -ss: 素材の後半だけ使うクリップでも毎回先頭からデコードしていたのを短縮する。
  // 要求位置より SS_MARGIN 秒手前から復号し、trim を同じ量だけ前へずらす
  // （切り出す区間は不変＝出力は従来と一致。手前から始めるのはシーク境界のズレを吸収するため）。
  // 付けられる条件（正しさを優先して厳しめにする）:
  //  ・そのパスを使うクリップが1つだけ（-ss は入力単位なので共有すると他クリップまでずれる）
  //  ・その入力の音声をフィルタで使わない（映像は全コンテナでフレーム一致を実測したが、
  //    opus/vorbis/mp3 はシーク後にサンプル位置が数サンプルずれ得るため音声には使わない）
  const SS_MARGIN = 1
  const ssOffsetOf = (idx: number, wantSec: number, audioUsed: boolean): number => {
    const spec = inputSpecs[idx]
    if (spec.ss > 0) return spec.ss // 同じクリップの映像/音声で2回呼ばれるので使い回す
    if (audioUsed) return 0
    if (userCount.get(normalize(spec.path)) !== 1) return 0
    const off = Math.round((wantSec - SS_MARGIN) * 1000) / 1000 // -ss と trim で同一の値を使う
    if (off <= 0.05) return 0
    spec.ss = off
    return off
  }

  // ---- 入力ラベルの払い出し ----
  // 1つの入力を複数クリップで使うときは split/asplit で必要本数に分けてから各 trim へ渡す
  // （同じ入力ラベルを2箇所以上から直接参照するとフィルタグラフが成立しない）。
  // 本数はフィルタを組み終わるまで分からないので、いったんプレースホルダを書き、
  // 最後に split 宣言を先頭へ足しつつ実ラベルへ置換する（1箇所だけなら [N:v] を直接使う＝従来と同じ）。
  const vUses: number[] = []
  const aUses: number[] = []
  const useV = (idx: number): string => {
    const n = vUses[idx] ?? 0
    vUses[idx] = n + 1
    return `@V${idx}_${n}@`
  }
  const useA = (idx: number): string => {
    const n = aUses[idx] ?? 0
    aUses[idx] = n + 1
    return `@A${idx}_${n}@`
  }
  const resolveInputLabels = (f: string): string => {
    let pre = ''
    const fix = (uses: number[], tag: 'V' | 'A', st: 'v' | 'a'): void => {
      uses.forEach((n, idx) => {
        if (!n) return
        if (n === 1) {
          f = f.replace(`@${tag}${idx}_0@`, `[${idx}:${st}]`)
          return
        }
        const labels: string[] = []
        for (let i = 0; i < n; i++) labels.push(`[x${tag}${idx}_${i}]`)
        pre += `[${idx}:${st}]${st === 'v' ? 'split' : 'asplit'}=${n}${labels.join('')};`
        labels.forEach((l, i) => {
          f = f.replace(`@${tag}${idx}_${i}@`, l)
        })
      })
    }
    fix(vUses, 'V', 'v')
    fix(aUses, 'A', 'a')
    return pre + f
  }

  // 映像レイヤー素材に音声があるか（無い素材の [N:a] を参照すると書き出しが失敗する）
  const vcHasAudio = vcs
    ? await Promise.all(vcs.map(async (c) => (await hasAudioStream(c.path)) !== false))
    : []
  let filter = ''
  // カット無し（segs なし）のときだけ元動画をベース映像として直接使う。segs ありでは
  // [vcat] に差し替わるので、ここでラベルを払い出してはいけない（未使用の split 出力はエラー）。
  let baseLabel = segs ? '' : useV(srcInput[0])
  let audioMap: string[] = audioPresent ? ['-map', '0:a?'] : []

  // 出力フレームレート（書き出し設定。既定30）。フィルタ全体で統一する。
  // 「素材と同じ」で 29.97 のような NTSC 系が来るため、以前の Math.round は使えない
  // （29.97 が 30 に化けて素材と1000/1001だけズレ、長尺で音ズレ・尺ズレになる）。
  const outFps =
    typeof payload.fps === 'number' && Number.isFinite(payload.fps) && payload.fps > 0
      ? Math.min(240, Math.max(1, payload.fps))
      : 30
  // ffmpeg へ渡す表記。29.97 等は10進で渡すと丸め誤差が出るので分数(30000/1001)にする。
  // 数値計算（半フレーム詰め）には実数の outFps を使い、表記だけ分数に切り替える。
  const fpsArg = ((): string => {
    const n = Math.round((outFps * 1001) / 1000) // NTSC系なら n/1.001 が整数になる
    if (n > 0 && Math.abs(outFps - (n * 1000) / 1001) < 0.005) return `${n * 1000}/1001`
    if (Math.abs(outFps - Math.round(outFps)) < 1e-6) return String(Math.round(outFps))
    return outFps.toFixed(6)
  })()
  // カットを反映: 残った切片を出力解像度に揃えて連結する
  // 各切片を先に scale/pad して同一サイズにするので、黒ブランクも color で混ぜられる
  const scalePad = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fpsArg}`
  if (segs) {
    // カット間クロスディゾルブ: 切片 i の xfade = 「i と i+1 の間」を d 秒重ねて溶かす。
    // モデルは「カット位置で完了する d 秒クロスフェード」——B側をソースの srcStart より
    // d*速度 だけ手前から取り出して頭を d 秒延長し、Aの尻と xfade で重ねる。
    // 出力尺 = lenA + (lenB + d) - d = 不変（テロップ/SEの enable 時刻に影響しない）。
    const spOf = (s: ExportSeg): number => (s.speed && s.speed > 0 ? s.speed : 1)
    const tlenOf = (s: ExportSeg): number => (s.srcEnd - s.srcStart) / spOf(s)
    // ペア (i, i+1) の実効ディゾルブ長（renderer でクランプ済み。最後の切片は次がないので0）
    const xfOf = (i: number): number =>
      i >= 0 && i < segs.length - 1 && segs[i].xfade && segs[i].xfade!.dur > 0.01
        ? segs[i].xfade!.dur
        : 0
    const hasX = segs.some((_, i) => xfOf(i) > 0)
    // xfade は全入力のタイムベース一致を要求する。scalePad の fps=30 が切片を 1/30 に、
    // concat は出力を 1/1000000(AVTB) にするため、混在チェーンでは xfade が
    // "timebase do not match" で失敗する。xfade を使うときは全切片を AVTB に統一する。
    // （非 xfade 経路は従来どおり付けない＝完全な後方互換）
    // トランジション種別ヘルパー（頭/尻/間すべて同じ種類集合）。
    const XF_ALLOWED = new Set([
      'fade',
      'slideleft',
      'slideright',
      'slideup',
      'slidedown',
      'wipeleft',
      'wiperight'
    ])
    const isDipT = (ty?: string): boolean =>
      ty === 'fade' || ty === 'dipblack' || ty === 'dipwhite'
    const dipCol = (ty?: string): string => (ty === 'dipwhite' ? 'white' : 'black')
    // 頭/尻 slide/wipe（黒とのxfade）用の名前
    const motionName = (ty?: string): string => (ty && XF_ALLOWED.has(ty) ? ty : 'fade')
    // 間 xfade 名: 黒/白ディップは fadeblack/fadewhite（沈んで戻る）
    const betweenName = (ty?: string): string =>
      ty === 'dipblack'
        ? 'fadeblack'
        : ty === 'dipwhite'
          ? 'fadewhite'
          : ty && XF_ALLOWED.has(ty)
            ? ty
            : 'fade'
    const motionIn = (s: ExportSeg, i: number): boolean =>
      !!s.transIn && s.transIn.dur > 0 && xfOf(i - 1) <= 0 && !isDipT(s.transIn.type)
    const motionOut = (s: ExportSeg, i: number): boolean =>
      !!s.transOut && s.transOut.dur > 0 && xfOf(i) <= 0 && !isDipT(s.transOut.type)
    // xfade（間 or 頭/尻の黒xfade）を使うなら全入力のタイムベースを AVTB へ統一（"timebase do not match" 回避）
    const needTb = hasX || segs.some((s, i) => motionIn(s, i) || motionOut(s, i))
    const tb = needTb ? ',settb=AVTB' : ''
    segs.forEach((s, i) => {
      const sp = spOf(s)
      const lenN = tlenOf(s)
      const headExt = xfOf(i - 1)
      const extLenN = lenN + headExt
      const trimStart = Math.max(0, s.srcStart - headExt * sp)
      const tin = s.transIn && s.transIn.dur > 0 && headExt <= 0 ? s.transIn : null
      const tout = s.transOut && s.transOut.dur > 0 && xfOf(i) <= 0 ? s.transOut : null
      // dip系（ディゾルブ/黒/白）は fade フィルタで色付き in/out。ディゾルブ境界のディップは出さない。
      let fade = ''
      if (tin && isDipT(tin.type))
        fade += `,fade=t=in:st=0:d=${Math.min(tin.dur, extLenN).toFixed(3)}:color=${dipCol(tin.type)}`
      if (tout && isDipT(tout.type)) {
        const d = Math.min(tout.dur, extLenN)
        fade += `,fade=t=out:st=${(extLenN - d).toFixed(3)}:d=${d.toFixed(3)}:color=${dipCol(tout.type)}`
      }
      // 色調整（明るさ/コントラスト/彩度）。組み立ては shared/colorAdjust。
      // **eq は使わない**（GPL 専用で、同梱の LGPL 版には入っていない）。
      const adj = s.adjust
      const cf = colorAdjustFilter(adj)
      const eq = cf ? `,${cf}` : ''
      // 変形（回転/反転）。scalePad の前に適用＝回転後に出力サイズへフィット。
      // 90°刻みは transpose（劣化なし）、自由角度は rotate フィルタ（黒埋め）。
      let xf = ''
      const rot = ((Math.round(s.rotate ?? 0) % 360) + 360) % 360
      if (rot === 90) xf += ',transpose=1'
      else if (rot === 270) xf += ',transpose=2'
      else if (rot === 180) xf += ',transpose=1,transpose=1'
      else if (rot !== 0)
        xf += `,rotate=${((rot * Math.PI) / 180).toFixed(5)}:ow=rotw(${((rot * Math.PI) / 180).toFixed(5)}):oh=roth(${((rot * Math.PI) / 180).toFixed(5)}):fillcolor=black`
      if (s.flipH) xf += ',hflip'
      if (s.flipV) xf += ',vflip'
      // 動画ズーム（リフレーム）: プレビューの transform: translate(x,y) scale(s) を切片ごとに焼き込む。
      // s>=1 は拡大して切り出し(crop)、s<1 は縮小して黒余白(pad)。x,y はフレーム比の中心オフセット。
      // scalePad で出力サイズに整えた後に適用する（切片単位＝現セクションのみ反映）。
      let zm = ''
      const z = s.zoom
      if (hasClipMotion(s.motion)) {
        // 動きが付いている切片だけ zoompan にする（時間で拡大率を変えられる唯一のフィルタ）。
        // 時刻は**切片の頭から**。頭にディゾルブのぶん（headExt）が足してあるときは、
        // その秒数だけ手前から流れているので引く。
        // 直前が scalePad（末尾が fps=）なので、on/fps はそのまま秒になる。
        const t = headExt > 0 ? `(on/${outFps}-${headExt.toFixed(3)})` : `on/${outFps}`
        zm = `,${zoompanFilter(z, s.motion, {
          width,
          height,
          timeExpr: t,
          fpsArg,
          frames: 1,
          // いちばん下の段なので、広げた台紙の余白は黒（透ける先が無い）
          bg: 'black'
        })},setsar=1`
      } else if (z && (Math.abs(z.scale - 1) > 1e-3 || z.x !== 0 || z.y !== 0)) {
        // いちばん下の段なので、絵から外れた所は黒（透ける先が無い）
        zm = ',' + zoomPanChain(width, height, z, 'black')
      }
      // クロップ（切り抜き）: 各辺を内側へ切り込み、切った領域は黒。
      // W×H(scalePad/zoom後)から部分矩形をcropし、元位置にpadで黒埋めして戻す（枠サイズ不変）。
      let cr = ''
      const cp = s.crop
      if (cp && (cp.l > 1e-4 || cp.t > 1e-4 || cp.r > 1e-4 || cp.b > 1e-4)) {
        const cl = Math.min(0.9, Math.max(0, cp.l))
        const ct = Math.min(0.9, Math.max(0, cp.t))
        const crgt = Math.min(0.9, Math.max(0, cp.r))
        const cb = Math.min(0.9, Math.max(0, cp.b))
        const cw = Math.max(2, Math.round(width * (1 - cl - crgt)))
        const ch = Math.max(2, Math.round(height * (1 - ct - cb)))
        const cx = Math.round(width * cl)
        const cy = Math.round(height * ct)
        cr = `,crop=${cw}:${ch}:${cx}:${cy},pad=${width}:${height}:${cx}:${cy}:color=black,setsar=1`
      }
      const mIn = motionIn(s, i)
      const mOut = motionOut(s, i)
      const coreLabel = mIn || mOut ? `[c${i}]` : `[sv${i}]`
      const vin = srcInput[s.srcIdx ?? 0] // マルチソース: この切片が使う入力（元動画）index
      if (s.videoBlank) {
        filter += `color=c=black:s=${width}x${height}:d=${extLenN.toFixed(3)}:r=${fpsArg},setsar=1${fade}${tb}${coreLabel};`
      } else {
        // この切片の音声を使うか（下の音声ループの useSilence と同じ条件）
        const aUsed = audioPresent && !s.muted && !!srcHasAudio[s.srcIdx ?? 0]
        const off = ssOffsetOf(vin, trimStart, aUsed) // 入力 -ss を付けたぶん trim を前へずらす
        filter += `${useV(vin)}trim=start=${(trimStart - off).toFixed(3)}:end=${(s.srcEnd - off).toFixed(3)},setpts=(PTS-STARTPTS)/${sp}${xf},${scalePad}${zm}${cr}${eq}${fade}${tb}${coreLabel};`
      }
      // slide/wipe の頭/尻＝黒クリップとの xfade（映像がスライド/ワイプで出入り）。尺は不変。
      if (mIn || mOut) {
        let cur = coreLabel
        if (mIn) {
          const d = Math.min(tin!.dur, extLenN)
          const nx = mOut ? `[ci${i}]` : `[sv${i}]`
          filter += `color=c=black:s=${width}x${height}:d=${d.toFixed(3)}:r=${fpsArg},setsar=1,settb=AVTB[bi${i}];`
          filter += `[bi${i}]${cur}xfade=transition=${motionName(tin!.type)}:duration=${d.toFixed(3)}:offset=0${nx};`
          cur = nx
        }
        if (mOut) {
          const d = Math.min(tout!.dur, extLenN)
          filter += `color=c=black:s=${width}x${height}:d=${d.toFixed(3)}:r=${fpsArg},setsar=1,settb=AVTB[bo${i}];`
          filter += `${cur}[bo${i}]xfade=transition=${motionName(tout!.type)}:duration=${d.toFixed(3)}:offset=${(extLenN - d).toFixed(3)}[sv${i}];`
        }
      }
    })
    if (!hasX) {
      // 従来どおり単純連結
      filter += `${segs.map((_, i) => `[sv${i}]`).join('')}concat=n=${segs.length}:v=1:a=0[vcat];`
    } else {
      // 左から右へペアごとに連結: 間トランジションは xfade、それ以外は concat(n=2)。
      // offset は「出力時間の累計 - d」（速度込みのタイムライン尺で計算）。名前は betweenName で検証。
      let cur = '[sv0]'
      let acc = tlenOf(segs[0])
      for (let i = 1; i < segs.length; i++) {
        const d = xfOf(i - 1)
        const out = i === segs.length - 1 ? '[vcat]' : `[vx${i}]`
        if (d > 0)
          filter += `${cur}[sv${i}]xfade=transition=${betweenName(segs[i - 1]?.xfade?.type)}:duration=${d.toFixed(3)}:offset=${(acc - d).toFixed(3)}${out};`
        else filter += `${cur}[sv${i}]concat=n=2:v=1:a=0${out};`
        cur = out
        acc += tlenOf(segs[i])
      }
      // hasX ⇒ 切片は2つ以上（xfOf が「次の切片あり」を要求）なので、ループは必ず [vcat] を出す
    }
    baseLabel = '[vcat]'
    if (audioPresent) {
      // 無音で埋める切片: muted / 音声なしソース / ギャップ。ソース音声を使わず anullsrc で正確な長さを出す
      // （ギャップはソース尺を超える範囲を指し得るため、atrim だと音声が短くなり concat がズレる）。
      const useSilence = (s: ExportSeg): boolean => !!s.muted || !srcHasAudio[s.srcIdx ?? 0]
      // フォーマット統一が必要: 複数入力を混ぜる or anullsrc(48k/stereo)と混ざるとき。
      // 単一ソース＆無音なしの経路では付けない＝従来動作を完全維持。
      const needAfmt = nSrc > 1 || segs.some(useSilence)
      const afmt = needAfmt ? ',aformat=sample_rates=48000:channel_layouts=stereo' : ''
      segs.forEach((s, i) => {
        const sp = spOf(s)
        const headExt = xfOf(i - 1)
        const extLen = (s.srcEnd - s.srcStart) / sp + headExt // 映像 extLenN と一致（timeline秒）
        if (useSilence(s)) {
          filter += `anullsrc=r=48000:cl=stereo,atrim=0:${Math.max(0.05, extLen).toFixed(3)},asetpts=PTS-STARTPTS${afmt}[sa${i}];`
          return
        }
        // 切片音量倍率。速度は atempo。フェードは頭/尻の指定秒。
        const gain =
          s.vol != null && Math.abs(s.vol - 1) > 1e-3 ? `,volume=${s.vol.toFixed(3)}` : ''
        const tempo = sp !== 1 ? `,atempo=${sp.toFixed(4)}` : ''
        let af = ''
        if (s.afadeIn && s.afadeIn > 0)
          af += `,afade=t=in:st=0:d=${Math.min(s.afadeIn, extLen).toFixed(3)}`
        if (s.afadeOut && s.afadeOut > 0) {
          const d = Math.min(s.afadeOut, extLen)
          af += `,afade=t=out:st=${(extLen - d).toFixed(3)}:d=${d.toFixed(3)}`
        }
        // 映像と同じくディゾルブ受け側は頭を延長（acrossfade 後の合計尺が映像と一致する）
        const trimStart = Math.max(0, s.srcStart - headExt * sp)
        const ain = srcInput[s.srcIdx ?? 0]
        const off = ssOffsetOf(ain, trimStart, true) // 音声を使う入力に -ss は付けない（常に0）
        filter += `${useA(ain)}atrim=start=${(trimStart - off).toFixed(3)}:end=${(s.srcEnd - off).toFixed(3)},asetpts=PTS-STARTPTS${tempo}${gain}${af}${afmt}[sa${i}];`
      })
      if (!hasX) {
        filter += `${segs.map((_, i) => `[sa${i}]`).join('')}concat=n=${segs.length}:v=0:a=1[acat];`
      } else {
        let cur = '[sa0]'
        for (let i = 1; i < segs.length; i++) {
          const d = xfOf(i - 1)
          const out = i === segs.length - 1 ? '[acat]' : `[ax${i}]`
          if (d > 0) filter += `${cur}[sa${i}]acrossfade=d=${d.toFixed(3)}${out};`
          else filter += `${cur}[sa${i}]concat=n=2:v=0:a=1${out};`
          cur = out
        }
      }
      audioMap = ['-map', '[acat]']
    }
  }

  // A1(ベース音声)トラック音量×マスターを適用
  // カット無しのベース音声（元動画の音声そのまま）は、フィルタで使うか -map で直結かが
  // 後段の分岐で決まる。使わないのに asplit の出力を作るとエラーになるので、いったん目印を
  // 置き、全部組み終わってから「目印が残っていたら」入力ラベルを払い出して置換する。
  const RAW_BASE_A = '@BASEA@'
  let baseAudioLbl = audioPresent ? (segs ? '[acat]' : RAW_BASE_A) : null
  if (baseAudioLbl && Math.abs(baseVol - 1) > 1e-3) {
    filter += `${baseAudioLbl}volume=${baseVol.toFixed(3)}[abase];`
    baseAudioLbl = '[abase]'
    audioMap = ['-map', '[abase]']
  }

  // SE と映像レイヤーの音声をベース音声にミックス。
  // ※ここは ses が無くても実行する（以前は if (ses) の内側にあり、SEを1本も置いていない
  //   プロジェクトでは映像レイヤーの音が丸ごと書き出されなかった）。
  if (ses || vcs) {
    const baseLbl = baseAudioLbl
    const mixParts: string[] = []
    if (baseLbl) mixParts.push(baseLbl)
    ses?.forEach((se, k) => {
      const ms = Math.max(0, Math.round(se.tStart * 1000))
      const durN = Math.max(0.05, se.duration)
      const dur = durN.toFixed(3)
      const vol = (se.volume ?? 1).toFixed(2)
      // フェードイン/アウト（afade）を volume と adelay の間に挟む
      const fi = Math.max(0, Math.min(se.fadeIn ?? 0, durN))
      const fo = Math.max(0, Math.min(se.fadeOut ?? 0, durN))
      let fade = ''
      if (fi > 0) fade += `,afade=t=in:st=0:d=${fi.toFixed(3)}`
      if (fo > 0) fade += `,afade=t=out:st=${(durN - fo).toFixed(3)}:d=${fo.toFixed(3)}`
      // 音源内オフセット（左端トリム/分割）ぶん頭を送って、そこから duration 秒を切り出す。
      // ベース音声と同じ 48k/stereo に揃えてから amix に入れる（サンプルレート差で崩れないように）。
      const so = Math.max(0, se.srcOffset ?? 0)
      // 声に合わせて下げる（ダッキング）。**adelay の後**に掛ける。
      // 前に掛けると、式の t がクリップ内の時間になって、声の位置とずれる。
      const duck = se.duckExpr
        ? `,volume=eval=frame:volume='${se.duckExpr.replace(/'/g, '')}'`
        : ''
      filter += `${useA(seInput[k])}atrim=${so.toFixed(3)}:${(so + durN).toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol}${fade},adelay=${ms}|${ms}${duck}[se${k}];`
      mixParts.push(`[se${k}]`)
    })
    // 映像レイヤーの音声もミックスへ（映像と同じ位置・同じ長さ）
    if (vcs) {
      vcs.forEach((vc, k) => {
        const vol = vc.volume ?? 1
        if (vol <= 0) return // 消音クリップはミックスに入れない
        // 音声ストリームが無い動画（画面録画など）は [N:a] が存在せず、参照すると
        // 書き出し全体が "Stream specifier ':a' matches no streams" で失敗する。
        if (!vcHasAudio[k]) return
        const durN = Math.max(0.05, vc.srcEnd - vc.srcStart)
        const ms = Math.max(0, Math.round(vc.tStart * 1000))
        const fi = Math.max(0, Math.min(vc.fadeIn ?? 0, durN))
        const fo = Math.max(0, Math.min(vc.fadeOut ?? 0, durN))
        let fade = ''
        if (fi > 0) fade += `,afade=t=in:st=0:d=${fi.toFixed(3)}`
        if (fo > 0) fade += `,afade=t=out:st=${(durN - fo).toFixed(3)}:d=${fo.toFixed(3)}`
        const off = ssOffsetOf(vcInput[k], vc.srcStart, true) // 音声を使う入力に -ss は付けない（常に0）
        filter += `${useA(vcInput[k])}atrim=${(vc.srcStart - off).toFixed(3)}:${(vc.srcEnd - off).toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol.toFixed(2)}${fade},adelay=${ms}|${ms}[vca${k}];`
        mixParts.push(`[vca${k}]`)
      })
    }
    if (mixParts.length >= 2 || (mixParts.length === 1 && !baseLbl)) {
      filter += `${mixParts.join('')}amix=inputs=${mixParts.length}:normalize=0:dropout_transition=0[amixout];`
      audioMap = ['-map', '[amixout]']
    }
  }

  // ラウドネス正規化（loudnorm）: 最終音声を目標LUFSへそろえる（YouTube最適 -14 等）
  const lufs = typeof payload.loudnormLUFS === 'number' ? payload.loudnormLUFS : null
  // audioPresent は「元動画に音声があるか」なので条件に入れない
  // （元動画が無音でも SE/BGM だけで音声を作る構成があり、そこでも正規化を効かせる）。
  // loudnorm は内部で192kHzに上げるため、aresample で48kHzへ戻す（AACが96kHzになるのを防ぐ）。
  if (lufs !== null && audioMap.length === 2) {
    const cur = audioMap[1]
    const inLbl = cur.startsWith('[') ? cur : RAW_BASE_A
    filter += `${inLbl}loudnorm=I=${lufs}:TP=-1.5:LRA=11,aresample=48000[aout];`
    audioMap = ['-map', '[aout]']
  }

  // ベース映像を出力解像度に合わせて拡縮＋レターボックス。
  // 動画のカット後より後ろのテロップがある場合は最終フレームを引き伸ばして含める
  const ext = extendSec && extendSec > 0.05 ? `tpad=stop_mode=clone:stop_duration=${extendSec.toFixed(3)},` : ''
  filter += `${baseLabel}${ext}scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[base];`
  let last = '[base]'
  // 映像レイヤー（V2以降の動画）を本編映像の上に重ねる。テロップ・画像より先に合成する
  // ＝重なり順は 本編 → 映像レイヤー → 画像 → テロップ。
  if (vcs) {
    vcs.forEach((vc, k) => {
      const idx = vcInput[k]
      const vLen = Math.max(0.05, vc.srcEnd - vc.srcStart)
      const vEndT = vc.tStart + vLen
      // 反転 → 出力サイズへフィット → 回転（枠サイズ固定）→ ズーム → クロップ → 色調整 → 不透明度
      let xf = ''
      if (vc.flipH) xf += ',hflip'
      if (vc.flipV) xf += ',vflip'
      const rot = ((Math.round(vc.rotate ?? 0) % 360) + 360) % 360
      let rotF = ''
      if (rot !== 0) {
        const rad = ((rot * Math.PI) / 180).toFixed(5)
        const bl = rot % 90 === 0 ? ':bilinear=0' : ''
        rotF = `,rotate=${rad}:ow=iw:oh=ih:fillcolor=black@0${bl}`
      }
      let zm = ''
      const z = vc.zoom
      if (hasClipMotion(vc.motion)) {
        // 重ねる動画の動き。**zoompan は出力の時刻を作り直す**ので、
        // 先に付けておいた「タイムライン上の開始時刻」が消える。後ろで置き直す。
        // 前に fps= を挟むのは、素材が24fpsでも on/fps が秒になるようにするため。
        zm =
          `,fps=${fpsArg},` +
          zoompanFilter(z, vc.motion, {
            width,
            height,
            timeExpr: `on/${outFps}`,
            fpsArg,
            frames: 1
          }) +
          `,setpts=PTS-STARTPTS+${vc.tStart.toFixed(3)}/TB,format=rgba,setsar=1`
      } else if (z && (Math.abs(z.scale - 1) > 1e-3 || z.x !== 0 || z.y !== 0)) {
        // 重ねる段。絵から外れた所は透明（下の映像が見える）
        zm = ',' + zoomPanChain(width, height, z, 'black@0')
      }
      let cr = ''
      const cp = vc.crop
      if (cp && (cp.l > 1e-4 || cp.t > 1e-4 || cp.r > 1e-4 || cp.b > 1e-4)) {
        const cl = Math.min(0.9, Math.max(0, cp.l))
        const ct = Math.min(0.9, Math.max(0, cp.t))
        const crg = Math.min(0.9, Math.max(0, cp.r))
        const cb = Math.min(0.9, Math.max(0, cp.b))
        const cw = Math.max(2, Math.round(width * (1 - cl - crg)))
        const ch = Math.max(2, Math.round(height * (1 - ct - cb)))
        const cx = Math.round(width * cl)
        const cy = Math.round(height * ct)
        cr = `,crop=${cw}:${ch}:${cx}:${cy},pad=${width}:${height}:${cx}:${cy}:color=black@0,setsar=1`
      }
      const adj = vc.adjust
      const hasEq =
        !!adj &&
        (Math.abs(adj.b - 1) > 1e-3 ||
          Math.abs(adj.c - 1) > 1e-3 ||
          Math.abs(adj.s - 1) > 1e-3)
      const op =
        vc.opacity != null && vc.opacity < 1
          ? `,colorchannelmixer=aa=${Math.max(0, vc.opacity).toFixed(3)}`
          : ''
      // trim で必要区間だけ取り出し、setpts で「タイムライン上の開始時刻」へずらす。
      // これで overlay の enable 窓と実フレームの時刻が一致する。
      // このクリップの音声をミックスに入れるか（上の音声ループの除外条件と同じ）
      const aUsed = (vc.volume ?? 1) > 0 && !!vcHasAudio[k]
      const off = ssOffsetOf(idx, vc.srcStart, aUsed) // 入力 -ss を付けたぶん trim を前へずらす
      const geom =
        `trim=start=${(vc.srcStart - off).toFixed(3)}:end=${(vc.srcEnd - off).toFixed(3)},` +
        `setpts=PTS-STARTPTS+${vc.tStart.toFixed(3)}/TB,format=rgba${xf},` +
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1${rotF}${zm}${cr}`
      if (hasEq) {
        // 色調整はアルファ非対応（YUV で計算する）なので、透明を退避して後で戻す
        const eqf = colorAdjustFilter(adj)
        filter += `${useV(idx)}${geom},split[vg${k}a][vg${k}b];`
        filter += `[vg${k}a]alphaextract[va${k}];`
        filter += `[vg${k}b]${eqf}[vcc${k}];`
        filter += `[vcc${k}][va${k}]alphamerge${op}[vcv${k}];`
      } else {
        filter += `${useV(idx)}${geom}${op}[vcv${k}];`
      }
      const out = `[vcb${k}]`
      const endT = vEndT - 0.5 / outFps > vc.tStart ? vEndT - 0.5 / outFps : vEndT
      filter += `${last}[vcv${k}]overlay=0:0:eof_action=pass:enable=between(t\\,${vc.tStart.toFixed(3)}\\,${endT.toFixed(3)})${out};`
      last = out
    })
  }
  // 画像クリップをテロップより先に重ねる（＝テロップが常に画像の上）。
  if (imgs) {
    imgs.forEach((im, k) => {
      const idx = imgInput[k]
      // 反転は出力サイズへ整える前でよい（サイズが変わらない）。
      // 回転は「枠サイズを変えずに中心で回す」＝プレビューの CSS rotate と同じ見え方にするため、
      // scale/pad で W×H に整えた *後* に ow=iw:oh=ih で回す（transpose は枠ごと縦横が入れ替わり
      // その後の decrease で縮んでしまい、プレビューと食い違うので使わない）。
      let ixf = ''
      if (im.flipH) ixf += ',hflip'
      if (im.flipV) ixf += ',vflip'
      const irot = ((Math.round(im.rotate ?? 0) % 360) + 360) % 360
      let irotF = ''
      if (irot !== 0) {
        const rad = ((irot * Math.PI) / 180).toFixed(5)
        // 90/180/270 は補間なし（bilinear=0）で劣化を避ける
        const bl = irot % 90 === 0 ? ':bilinear=0' : ''
        irotF = `,rotate=${rad}:ow=iw:oh=ih:fillcolor=black@0${bl}`
      }
      let izm = ''
      const iz = im.zoom
      if (hasClipMotion(im.motion)) {
        // 静止画は1枚しか入って来ない。zoompan の d に「尺×fps」を渡して、
        // その1枚から動く絵を作る（zoompan はもともとこれ用のフィルタ）。
        // 出来た並びは時刻0から始まるので、置く時刻へずらし直す
        // （ずらさないと、重ねる窓が開く頃には最後の1枚で止まっている）。
        const idur = Math.max(0.05, im.duration)
        izm =
          ',' +
          zoompanFilter(iz, im.motion, {
            width,
            height,
            timeExpr: `on/${outFps}`,
            fpsArg,
            frames: idur * outFps
          }) +
          `,setpts=PTS-STARTPTS+${im.tStart.toFixed(3)}/TB,format=rgba,setsar=1`
      } else if (iz && (Math.abs(iz.scale - 1) > 1e-3 || iz.x !== 0 || iz.y !== 0)) {
        // 重ねる段。絵から外れた所は透明（下の映像が見える）
        izm = ',' + zoomPanChain(width, height, iz, 'black@0')
      }
      let icr = ''
      const icp = im.crop
      if (icp && (icp.l > 1e-4 || icp.t > 1e-4 || icp.r > 1e-4 || icp.b > 1e-4)) {
        const cl = Math.min(0.9, Math.max(0, icp.l))
        const ct = Math.min(0.9, Math.max(0, icp.t))
        const crg = Math.min(0.9, Math.max(0, icp.r))
        const cb = Math.min(0.9, Math.max(0, icp.b))
        const cw = Math.max(2, Math.round(width * (1 - cl - crg)))
        const ch = Math.max(2, Math.round(height * (1 - ct - cb)))
        const cx = Math.round(width * cl)
        const cy = Math.round(height * ct)
        // 切った領域は透明（下の映像が見える＝プレビューと一致）
        icr = `,crop=${cw}:${ch}:${cx}:${cy},pad=${width}:${height}:${cx}:${cy}:color=black@0,setsar=1`
      }
      const iadj = im.adjust
      const hasEq =
        !!iadj &&
        (Math.abs(iadj.b - 1) > 1e-3 ||
          Math.abs(iadj.c - 1) > 1e-3 ||
          Math.abs(iadj.s - 1) > 1e-3)
      const iop =
        im.opacity != null && im.opacity < 1
          ? `,colorchannelmixer=aa=${Math.max(0, im.opacity).toFixed(3)}`
          : ''
      // 透明を保持するため rgba に統一（回転/pad の余白と不透明度が効くように）
      const geom = `format=rgba${ixf},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1${irotF}${izm}${icr}`
      if (hasEq) {
        // 色調整はアルファ非対応（YUV で計算する）ので、通すと透明が不透明の黒に落ちる。
        // アルファを取り出して退避し、色調整後に merge して戻す。
        const eqf = colorAdjustFilter(iadj)
        filter += `${useV(idx)}${geom},split[ig${k}a][ig${k}b];`
        filter += `[ig${k}a]alphaextract[ia${k}];`
        filter += `[ig${k}b]${eqf}[ic${k}];`
        filter += `[ic${k}][ia${k}]alphamerge${iop}[img${k}];`
      } else {
        filter += `${useV(idx)}${geom}${iop}[img${k}];`
      }
      const out = `[ib${k}]`
      // テロップと同じ半開区間。隣接する画像が境界で二重に重ならず、
      // 「半フレーム詰めた隙間に出力フレームが落ちて1枚抜ける」も起きない。
      const iEnd = im.tStart + Math.max(0.05, im.duration)
      filter += `${last}[img${k}]overlay=0:0:enable=${overlayEnableExpr(im.tStart, iEnd)}${out};`
      last = out
    })
  }
  // ---- 連番でまとめて重ねるテロップ ----
  //
  // **1本につき重ねるのは1段だけ。** 中身が何百枚あっても段は増えないので、
  // 枚数に比例して遅くなることが無い（1枚ずつ重ねる作りが遅さの正体だった）。
  //
  // 連番はそれ自身の時間軸を 0 から持っているので、置きたい時刻ぶん後ろへずらす。
  // ずらしてから重ねる窓（enable）を掛けると、窓の中では必ず「そのテロップの
  // 経過時間ぶん進んだ絵」が当たる。
  seqs.forEach((sq, k) => {
    const lb = `[sq${k}]`
    // fps= で出力の刻みに合わせてから PTS をずらす。合わせずにずらすと、
    // 連番の刻み（例 30枚/秒）のまま出力（例 60fps）へ入って、
    // **1枚が2コマぶん居座る／足りない**が起きる。
    filter += `${useV(seqInput[k])}fps=${outFps},setpts=PTS+${sq.start.toFixed(3)}/TB${lb};`
    const out = `[qo${k}]`
    filter += `${last}${lb}overlay=0:0:enable=${overlayEnableExpr(sq.start, sq.end)}${out};`
    last = out
  })
  if (frames.length) {
    // 窓の作り方（なぜ半開区間か）は shared/filterGraph の overlayEnableExpr に書いてある。
    // 動きの付いたテロップは短い窓を延々と並べるので、ここの取り違えが直接
    // 「書き出した動画のテロップがチカチカする」になる。
    frames.forEach((f, i) => {
      const out = i === frames.length - 1 ? '[v]' : `[o${i}]`
      // テロップPNGは1枚1入力（重複なし）。
      filter += `${last}${useV(pngInput[i])}overlay=0:0:enable=${overlayEnableExpr(f.start, f.end)}${out};`
      last = out
    })
  } else {
    filter += `${last}null[v];` // テロップ無し: 最終ラベルだけ [v] に揃える
  }
  // 目印が残っている＝ベース音声をフィルタで使った。ここで初めて入力ラベルを払い出す。
  if (filter.includes(RAW_BASE_A)) filter = filter.split(RAW_BASE_A).join(useA(srcInput[0]))
  // プレースホルダ→実ラベル（必要な入力だけ split/asplit を先頭に足す）
  filter = resolveInputLabels(filter).replace(/;$/, '')
  // **音だけ出すときは、映像の枝を丸ごと落とす。**
  //
  // `-vn` は「出さない」だけで、映像は最後まで作られてから捨てられる。
  // 実測（1080p・60秒）で 0.8秒 → 10.4秒＝**13倍**。8分の素材なら分単位で効く。
  //
  // 組み立ては映像と音が絡んでいるので、**組み立てを分けずに、最後に要らない枝を
  // 落とす**（分けると音の道すじまで別物になりうる＝聴いた音と違う物が出る）。
  const audioOut = audioMap.length === 2 ? [audioMap[1]] : []
  if (audioOnly) filter = keepBranchesFor(filter, audioOut)

  // ---- ffmpeg を起動する前にグラフを検証する ----
  // 入力ごとのストリーム有無。確実に「無い」と言えるものだけ false にし、
  // 判断できないものは true（許容）にする。誤検知で動く書き出しを止めないため。
  const graphInputs: GraphInput[] = inputSpecs.map((sp) => ({
    hasVideo: true,
    // 画像は音声を持たない（拡張子で確実に判断できる）
    hasAudio: !/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(sp.path),
    name: sp.path.split(/[\\/]/).pop()
  }))
  // ffprobe した実測を反映（無音の動画から [N:a] を取ろうとする事故を止める）
  srcInput.forEach((idx, i) => {
    if (!srcHasAudio[i] && graphInputs[idx]) graphInputs[idx].hasAudio = false
  })
  vcInput.forEach((idx, k) => {
    if (!vcHasAudio[k] && graphInputs[idx]) graphInputs[idx].hasAudio = false
  })
  const graphProblems = validateFilterGraph(filter, {
    inputs: graphInputs,
    // 音だけのときは [v] を map しない（枝ごと落としてあるので、期待も揃える）
    maps: [...(audioOnly ? [] : ['[v]']), ...audioMap.filter((a) => a !== '-map')]
  })
  if (graphProblems.length) {
    // 警告は書き出しを止めない（動くが設計上おかしい、を記録に残すだけ）
    console.warn('[export] フィルタグラフの指摘:\n' + formatGraphProblems(graphProblems))
  }
  if (hasGraphError(graphProblems)) {
    // ここで止めれば、ffmpeg の暗号のようなエラーではなく原因が読める形で返せる。
    // 検出しているのは ffmpeg でも必ず失敗する不整合なので、成立する書き出しは止まらない。
    const errs = graphProblems.filter((p) => p.severity === 'error')
    return {
      ok: false,
      error:
        '書き出しの合成設定に不整合が見つかったため中止しました。\n' +
        '（この状態で実行しても ffmpeg が失敗します）\n\n' +
        formatGraphProblems(errs)
    }
  }

  const crf = typeof payload.crf === 'number' ? Math.round(payload.crf) : 23
  // フィルタは一時ファイルに書き出して -filter_complex_script で渡す。
  // テロップPNGが多い（＝入力とoverlay行が増える）とコマンドライン長がWindows上限(32767字)を
  // 超えて spawn ENAMETOOLONG になるため、最も長いフィルタ文字列を外出しして回避する。
  writeFileSync(join(tmp, 'filter.txt'), filter, 'utf-8')
  // 直近の書き出しのフィルタグラフを残す。tmp は書き出し後に消えるため、
  // 書き出しの不具合を後から実データで検証できるようにここへ控えを置く。
  try {
    writeFileSync(
      join(app.getPath('userData'), 'last-export-filter.txt'),
      `# 入力 ${graphInputs.length} 個\n` +
        graphInputs
          .map((g, i) => `#  ${i}: ${g.name}  video=${g.hasVideo} audio=${g.hasAudio}`)
          .join('\n') +
        `\n# -map ${audioMap.join(' ')}\n` +
        (graphProblems.length ? `# 指摘:\n${formatGraphProblems(graphProblems)}\n` : '') +
        '\n' +
        filter.split(';').join(';\n'),
      'utf-8'
    )
  } catch {
    // 控えが残せなくても書き出し自体は続行する
  }
  // 入力を並べる（重複排除済み。-ss はフィルタ組み立て中に確定するのでここで反映する）
  for (const sp of inputSpecs) {
    if (sp.pre) args.push(...sp.pre)
    if (sp.ss > 0) args.push('-ss', sp.ss.toFixed(3))
    args.push('-i', sp.path)
  }
  args.push(
    // 渡し方は ffmpeg の版で違う（8系で -filter_complex_script が消えた）
    ...(await filterScriptArgs(join(tmp, 'filter.txt'))),
    'filter.txt', // cwd=tmp なので相対でよい（コマンドライン長の節約）
    ...(audioOnly
      ? [
          // 映像の枝は上の keepBranchesFor で落としてある（[v] はもう無い）。
          // **-vn では駄目**。あれは「出さない」だけで、映像は最後まで作られる
          // （1080p60秒の実測で 0.8秒 → 10.4秒）。
          ...audioMap,
          // 192kbps／48kHz。切り抜きの声と BGM には十分で、配るのに重くない
          '-c:a',
          'libmp3lame',
          '-b:a',
          '192k',
          '-ar',
          '48000'
        ]
      : [
          '-map',
          '[v]',
          ...audioMap,
          '-r',
          fpsArg,
          ...(await videoEncoder()).args(crf, { w: width, h: height, fps: outFps }),
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac'
        ]),
    save.filePath
  )

  const totalDur = typeof payload.totalDurationSec === 'number' ? payload.totalDurationSec : 0
  // 準備（テロップの画像作り）の間に中止を押されていたら、ここで止める。
  // ここを見ないと、押しても書き出しが最後まで進んでしまう
  if (exportCanceled) {
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* noop */
    }
    liveTmpDirs.delete(tmp)
    return { ok: false, canceled: true }
  }
  return await new Promise((resolve) => {
    // cwd=tmp: テロップPNG・フィルタを相対パスで渡してコマンドライン長を抑える
    // （元動画・出力先は絶対パスなので cwd の影響を受けない）
    const ff = spawn(FFMPEG, args, { cwd: tmp })
    currentExportFf = ff
    let err = ''
    ff.stderr.on('data', (d) => {
      const s = d.toString()
      err += s
      // ffmpeg の time= を出力尺で割って進捗%を送る（プロキシ生成と同方式）
      const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(s)
      if (m && totalDur > 0) {
        const cur = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3])
        const pct = Math.min(99, Math.max(0, Math.round((cur / totalDur) * 100)))
        !e.sender.isDestroyed() && e.sender.send('export:progress', { percent: pct })
      }
    })
    const cleanup = (): void => {
      currentExportFf = null
      liveTmpDirs.delete(tmp)
      try {
        rmSync(tmp, { recursive: true, force: true }) // 一時PNGを削除（蓄積防止）
      } catch {
        /* noop */
      }
    }
    /**
     * ffmpeg の言い分を切り詰める。**頭も残す。**
     *
     * 前は末尾だけ残していた。しかし「なぜ最初の1フレームも作れなかったか」は
     * 頭の方に出る（フィルタの組み立て失敗・入力が開けない など）。末尾には
     * "Conversion failed!" のような結果しか無いので、**本当の原因が読めない**。
     * 実際に、書き出し失敗の報告を受けても切り分けられなかった。
     */
    const trimLog = (s: string, keep: number): string => {
      if (s.length <= keep * 2) return s
      return `${s.slice(0, keep)}\n……（中略 ${s.length - keep * 2}字）……\n${s.slice(-keep)}`
    }
    /** 書き出しが失敗したときの控え。画面のお知らせは1行しか出ないので、
     *  原因を切り分けられるだけの中身をファイルに残す。 */
    const saveDiag = (why: string, detail = ""): void => {
      try {
        // userData は確認の後片付けで消えることがあるので、OS の一時フォルダへ
        writeFileSync(
          join(tmpdir(), "giftcut-last-export-error.txt"),
          why +
            `
使った ffmpeg: ${FFMPEG}（ある: ${existsSync(FFMPEG)}）` +
            `
作業フォルダ: ${tmp}（ある: ${existsSync(tmp)}）` +
            `
出力先: ${save.filePath}` +
            // **数がおかしいときは、ここを見れば分かる。**
            // テロップ1枚が入力1つになるので、増えすぎるとコマンドラインの
            // 上限や開けるファイル数に当たる。落ちてから数えられないと切り分けできない
            `
入力の数: ${args.filter((a) => a === '-i').length}（うちテロップ画像 ${pngPaths.length} 枚）` +
            `
フィルタの長さ: ${filter.length}字` +
            (detail
              ? `
---- ffmpeg の言い分 ----
${detail}`
              : ''),
          "utf-8"
        )
      } catch {
        /* 控えが残せなくても続行 */
      }
    }
    ff.on("error", (er) => {
      saveDiag(`ffmpeg起動失敗: ${er.message}`)
      cleanup()
      resolve({ ok: false, error: "ffmpeg起動失敗: " + er.message })
    })
    // async にしているのは、GPU で失敗したときに「CPU 側で使える物」を
    // その場で試してから焼き直すため（x264 があるとは限らない）
    ff.on('close', async (code) => {
      // **ここで片付けてはいけない。** 片付けはテロップPNGを置いた作業フォルダを
      // 消す。GPU で失敗して CPU でやり直すとき、その作業フォルダを使うので、
      // 先に消すと「作業フォルダが無い」で必ず失敗する（実際にそうなった）。
      // やり直しの必要が無いと分かってから片付ける。
      if (exportCanceled) {
        cleanup()
        // 中断: 書きかけの出力ファイルを消してキャンセル扱いで返す
        try {
          rmSync(save.filePath, { force: true })
        } catch {
          /* noop */
        }
        resolve({ ok: false, canceled: true })
        return
      }
      if (code === 0) {
        cleanup()
        resolve({ ok: true, outPath: save.filePath })
        return
      }
      // GPU で焼いていて失敗したら、CPU でやり直す。
      // 起動時は通ったのに、長い書き出しの途中でドライバが落ちることがある。
      // ここで諦めると「書き出せないアプリ」になってしまう。
      const usedGpu = args.some((a) => a === 'h264_nvenc' || a === 'h264_qsv' || a === 'h264_amf')
      if (usedGpu && !exportCanceled) {
        // CPU で焼き直す。**x264 があるとは限らない**（配布物は LGPL 版で、
        // x264 は入っていない）ので、実際に使える方を選ぶ。
        const x264 = ENCODERS.find((e) => e.v === 'libx264')!
        const oh264 = ENCODERS.find((e) => e.v === 'libopenh264')!
        const cpu = (await tryEncoder(x264)) ? x264 : oh264
        console.warn(`[書き出し] GPU で失敗したので ${cpu.label} でやり直します`)
        useEncoder(cpu) // 以降もこれを使う
        // エンコーダの指定は '-c:v' から '-pix_fmt' の手前までに入っている。
        // そこを丸ごと差し替える（GPU 用の細かい指定も一緒に消える）。
        const fixed = [...args]
        const from = fixed.indexOf('-c:v')
        const to = fixed.indexOf('-pix_fmt')
        if (from >= 0 && to > from)
          fixed.splice(from, to - from, ...cpu.args(crf, { w: width, h: height, fps: outFps }))
        const ff2 = spawn(FFMPEG, fixed, { cwd: tmp })
        currentExportFf = ff2
        let err2 = ''
        ff2.stderr.on('data', (d) => {
          const s = d.toString()
          err2 += s
          const m2 = /time=(\d+):(\d+):(\d+\.\d+)/.exec(s)
          if (m2 && totalDur > 0) {
            const cur = +m2[1] * 3600 + +m2[2] * 60 + parseFloat(m2[3])
            const pct = Math.min(99, Math.max(0, Math.round((cur / totalDur) * 100)))
            !e.sender.isDestroyed() && e.sender.send('export:progress', { percent: pct })
          }
        })
        ff2.on('error', (er) => {
          cleanup()
          resolve({ ok: false, error: 'ffmpeg起動失敗: ' + er.message })
        })
        ff2.on('close', (c2) => {
          cleanup()
          if (c2 === 0) resolve({ ok: true, outPath: save.filePath })
          else {
            // 1回目（GPU）の言い分も一緒に残す。やり直しの失敗だけ見ても、
            // そもそもなぜ GPU が駄目だったのかが分からない
            saveDiag(
              `CPUでのやり直しも失敗 (code ${c2})`,
              `【1回目 GPU (code ${code})】\n${trimLog(err, 1500)}\n\n【2回目 CPU】\n${trimLog(err2, 1500)}`
            )
            resolve({ ok: false, error: `ffmpeg失敗 (code ${c2})\n` + err2.slice(-600) })
          }
        })
        return
      }
      cleanup()
      saveDiag(`ffmpeg失敗 (code ${code})`, trimLog(err, 2000))
      resolve({ ok: false, error: `ffmpeg失敗 (code ${code})\n` + err.slice(-600) })
    })
  })
})
}
