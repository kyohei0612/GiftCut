// 書き出しの**受け口**。**このアプリでいちばん取り返しがつかない処理。**
//
// ## 書き出しは7つのファイルに分かれている（2026-08-03 に3つ / 08-04 に組み立てを4つへ）
//
//   ./exportRun       ここ。IPC を受け、出す先を決め、テロップPNGを焼き、
//                     組み上がったグラフを ffmpeg の引数にして渡す
//   ./exportTypes     受け取る形（型だけ。関数は無い）
//   ./exportFilters   共通の小道具（切り抜き・色調整の要否・不透明度）
//   ./exportOverlays  [base] の上へ1段ずつ重ねる（映像レイヤー・画像・テロップ）
//   ./exportSegments  本編の切片を横に並べて [vcat] / [acat] を作る
//   ./exportAudioMix  効果音と映像レイヤーの音を混ぜ、ラウドネスを揃える
//   ./exportSpawn     走らせる（起動・進捗・中止・GPU で失敗したら CPU でやり直す）
//
// 最初に割った理由: **1,229行のうち 1,012行が `export:run` の中の1つのコールバック**
// だったので、取説（`// ## 中身`）を書いても2行にしかならなかった。
// 「このファイルにはこれしか無い」という**ほぼ嘘の案内**になるので、先に割った。
//
// 08-04 に組み立て（946行）をさらに4つへ割った。**測ったら話題が4つとも
// 独立していた**（連れて行く名前 0〜1／`引き継ぎ-心臓の分け直し.md`）。
//
// ## この順でしか読めない（依存の向き）
//
//   exportRun → exportOverlays / exportSegments / exportAudioMix（組み立て）
//   exportRun → exportSpawn（走らせる）
//   組み立ての3つ → exportFilters → exportTypes
//
// **組み立ての3つは互いを知らない**（重ねる段は切片を知らない）。共通の物は
// 下の2つへ落としてあるので、横のつながりが生えない。組み立てと実行を混ぜないのが、
// 「グラフが悪いのか ffmpeg が悪いのか」を切り分けられる形の条件。
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
// テロップの出る窓は shared/filterGraph の overlayEnableExpr、
// 時間の計算は shared/timeline。ここで別の式を書き起こさない（必ずズレる）。
//
// ## ffmpeg の呼び方
//
// 起動は必ず ./ffmpegRun 経由（実際に呼ぶのは ./exportSpawn）。直に spawn すると、
// アプリを閉じた後も変換が走り続ける（追跡から漏れるため）。
//
// ※ 取説（`// ## 中身`）は付けていない。**479行＝通しで読める大きさ**に戻ったので、
//   並べても `registerExportHandlers` 1行にしかならない（＝何の役にも立たない）。
import { app, dialog, ipcMain } from 'electron'
import { dirname, join, normalize } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
// フィルタグラフは ffmpeg を起動する前に検証する（入力indexのズレ・ラベルの
// 定義漏れ・無音素材からの音声参照は、起動して初めて分かると原因が読めない）。
import {
  formatGraphProblems,
  hasGraphError,
  keepBranchesFor,
  validateFilterGraph,
  type GraphInput
} from '../shared/filterGraph'
// フィルタグラフを組む側。**話題ごとに分かれていて、互いを知らない。**
// 受け取る形（ExportPayload など）は、3つとも同じ物を見るので下（./exportTypes）にある
import { buildAudioMix, RAW_BASE_A } from './exportAudioMix'
import { dumpExportArgs, dumpExportFilter } from './exportDump'
import { buildOverlays } from './exportOverlays'
import { buildSegments } from './exportSegments'
import type { ExportPayload } from './exportTypes'
// 書き出し先が素材と同じだと ffmpeg は必ず失敗する。始める前に気づいて日本語で言う
import { clashingSource } from '../shared/exportTarget'
import { uniqueName } from '../shared/exportDefaults'
// 入力を何本にも分ける（split/asplit）決まり。文字列の置き換えだけなので shared に置いてある
import {
  newLabelUses,
  resolveInputLabels as resolveInputLabelsIn,
  useA as useAIn,
  useV as useVIn,
  useVAt as useVAtIn
} from '../shared/filterLabels'
import { filterScriptArgs, hasAudioStream, liveTmpDirs, videoEncoder } from './ffmpegRun'
// 走らせる側（起動・進捗・中止・GPU で失敗したときの CPU でのやり直し）。
// **中止の印と「いま書き出し中か」もあちらが持っている**——走っているプロセスを
// 知っているのはあちらだけなので、印を別の場所に置くと必ず食い違う。
import { beginExport, cancelExport, runExportFfmpeg } from './exportSpawn'

// 自動更新が「いま書き出し中か」を見に来る先はここのまま（実体は ./exportSpawn）。
// 呼ぶ側から見て書き出しの入口は1つ、という形を崩さないために通してある。
export { isExporting } from './exportSpawn'


/**
 * 書き出しの受け口を登録する。**app.whenReady() の中で1回だけ呼ぶ。**
 */
export function registerExportHandlers(): void {
// 動画書き出し（FFmpegでテロップPNGを焼き込み）
// 中止の中身は ./exportSpawn（ffmpeg が始まる前でも印だけは立てる）
ipcMain.handle('export:cancel', () => cancelExport())

ipcMain.handle('export:run', async (e, payload: ExportPayload) => {
  // 始める前に「中止」の印を落とす。前回の中止が残っていると、
  // 次の書き出しが始まった瞬間に止まる
  beginExport()
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
  // **決まりは shared/filterLabels にある。** やっているのは文字列の置き換えだけで
  // ffmpeg も electron も要らないので、アプリを起動せずに確かめられる所へ出した。
  // ここは「この書き出し1回ぶんの数え台」を持って、包みを当てるだけ
  const labelUses = newLabelUses()
  const useV = (idx: number): string => useVIn(labelUses, idx)
  const useA = (idx: number): string => useAIn(labelUses, idx)
  // 窓付き（本編の切片だけが使う）。窓が時間順なら split ではなく segment で配られる
  const useVAt = (idx: number, s: number, e: number): string => useVAtIn(labelUses, idx, s, e)
  const resolveInputLabels = (f: string): string => resolveInputLabelsIn(labelUses, f)

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
  // ---- カットを反映（残った切片を出力解像度に揃えて連結する）----
  if (segs) {
    // 切片を並べて [vcat] / [acat] を作るのは ./exportSegments。
    // **ベース映像のラベルがここで [vcat] に差し替わる**（カット無しなら元動画のまま）
    const built = buildSegments(
      { width, height, outFps, fpsArg, useV, useVAt, useA, ssOffsetOf },
      { segs, srcInput, srcHasAudio, audioPresent, nSrc }
    )
    filter += built.filter
    baseLabel = built.baseLabel
    if (built.audioMap) audioMap = built.audioMap
  }

  // ---- 音のミックス（ベース音声＋効果音＋映像レイヤーの音 → ラウドネス正規化）----
  // 組み立ては ./exportAudioMix
  const mixed = buildAudioMix(
    { useA, ssOffsetOf },
    {
      hasSegs: !!segs,
      audioPresent,
      baseVol,
      ses,
      seInput,
      vcs,
      vcInput,
      vcHasAudio,
      loudnormLUFS: typeof payload.loudnormLUFS === 'number' ? payload.loudnormLUFS : null,
      audioMap
    }
  )
  filter += mixed.filter
  audioMap = mixed.audioMap

  // ---- 重ねる段（下から 本編 → 映像レイヤー → 画像 → テロップ）----
  // 組み立ては ./exportOverlays。**出口は必ず [v]。**
  filter += buildOverlays(
    { width, height, outFps, fpsArg, useV, ssOffsetOf },
    {
      baseLabel,
      extendSec,
      vcs,
      vcInput,
      vcHasAudio,
      imgs,
      imgInput,
      seqs,
      seqInput,
      frames,
      pngInput
    }
  )
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
  // 直近の書き出しの控え（tmp は書き出し後に消えるので、後から実データで
  // 調べられるように userData へ置く）。中身は ./exportDump。
  dumpExportFilter({ filter, graphInputs, audioMap, graphProblems })
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

  // **引数そのものも控える。** フィルタだけ残しても「入力を何本開いているか」
  // 「デコードを GPU に投げているか」が読めず、遅さの原因を後から追えない
  //（2026-08-04 に書き出しを速くしようとして、まずここが無くて詰まった）。
  dumpExportArgs({ args, inputSpecs, pngCount: pngPaths.length, filterLen: filter.length })

  // ここから先は ./exportSpawn。**作業フォルダの後片付けも中止の見張りも、
  // 全部あちらが持っている**——片付けを呼ぶ側に残すと、GPU で失敗して CPU で
  // やり直す前に消してしまう（実際にそうなった）。
  return await runExportFfmpeg({
    args,
    tmp,
    outPath: save.filePath,
    totalDur: typeof payload.totalDurationSec === 'number' ? payload.totalDurationSec : 0,
    crf,
    width,
    height,
    outFps,
    pngCount: pngPaths.length,
    filterLen: filter.length,
    onProgress: (percent) => {
      !e.sender.isDestroyed() && e.sender.send('export:progress', { percent })
    }
  })
})
}
