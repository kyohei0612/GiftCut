// 素材の下ごしらえ——サムネ・焼き直し（プロキシ）・波形。
//
// ## 焼き直し（プロキシ）とは
//
// 原本は数秒に1枚しかキーフレームが無いので、カットで飛ぶたびに復号し直しが起きて
// **絵が100〜200ms止まる**。全コマがキーフレームの映像を別に作っておき、
// プレビューではそちらを流す。
//
// **書き出しは必ず原本を使う**（焼き直しは粗いので、完成品の画質には影響させない）。
//
// ## 配布物でだけ壊れた過去がある
//
// 焼き直しのエンコーダを libx264 で固定していたが、**同梱 ffmpeg は x264 抜き**
// （LGPL 版）なので、配布物では必ず失敗していた。しかも**失敗しても原本のまま
// 再生され続ける**ので画面には何も出ない。
//
// 開発機は PATH の ffmpeg（x264 入り）を拾ってしまうので気づけない。
// **同梱 ffmpeg に無い物を名指ししないこと。**
import { app, ipcMain } from 'electron'
import { join, normalize } from 'path'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from 'fs'
import { createHash } from 'crypto'
import { cpus, setPriority, constants as osConstants } from 'os'
import { spawn } from 'child_process'
import { ENCODERS } from './encoders'
import { FFMPEG, FFPROBE, trackedSpawn, tryEncoder, videoEncoder } from './ffmpegRun'
import { allowFile, isAllowed } from './allowList'

// サムネイル生成（先頭付近の1フレーム）。ライブラリで複数保持するので削除はしない
// キャッシュのプルーニング: dir 内の match するファイルを新しい順に keep 個だけ残し、古いものを削除。
// ※プロキシは容量ベースのLRUが必要なので pruneProxyCache を使う（こちらはサムネ用）
const pruneCache = (dir: string, match: (f: string) => boolean, keep: number): void => {
  try {
    const files = readdirSync(dir)
      .filter(match)
      .map((f) => {
        try {
          return { f, t: statSync(join(dir, f)).mtimeMs }
        } catch {
          return { f, t: 0 }
        }
      })
      .sort((a, b) => b.t - a.t)
    for (const x of files.slice(keep)) {
      try {
        rmSync(join(dir, x.f), { force: true })
      } catch {
        /* 無視 */
      }
    }
  } catch {
    /* 無視 */
  }
}

// 編集用プロキシのディレクトリ。userData 配下に置き、キャッシュとして使い回す。
const proxyDir = join(app.getPath('userData'), 'giftcut-proxies')
// プロキシキャッシュの上限。360p/720p の2解像度ぶんが並ぶうえ長尺なら1本数十MB〜になるため、
// 本数だけでは数GBまで膨らんでしまう。総容量で制限し、超過ぶんだけ古い順に削除する。
// ※原寸（最高画質のまま全コマキーフレーム）を足したので上げた。
// 原寸は 1080p の4分で 1〜2GB になるため、3GB のままだと**作った端から消える**
// （消えると次に選んだとき作り直しになり、待たされるだけで何も良くならない）。
const PROXY_CACHE_MAX_BYTES = 20 * 1024 * 1024 * 1024 // 20GB
const PROXY_CACHE_MAX_FILES = 200 // 極端に短い素材ばかりのときの本数上限
// このセッションで返した（＝いま編集中のプロジェクトが使っている）プロキシは削除しない。
// 以前は生成時刻の降順で切っていたため、使用中でも「古い」だけで消され再変換が走っていた。
const proxyInUse = new Set<string>()
// プロキシキャッシュの掃除（LRU）。古さは *最終アクセス時刻*（キャッシュヒット時に mtime を
// 更新している）で判定し、総容量／本数の超過ぶんだけ古い方から消す。
const pruneProxyCache = (dir: string): void => {
  try {
    const files: { f: string; t: number; size: number }[] = []
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.tmp.mp4')) {
        // 生成途中は消さない（消すと破損プロキシになる）。ただし1時間以上前のものは
        // 前回の異常終了で残った孤児なので消す。
        try {
          const st = statSync(join(dir, f))
          if (Date.now() - st.mtimeMs > 3600_000) rmSync(join(dir, f), { force: true })
        } catch {
          /* 無視 */
        }
        continue
      }
      if (!f.endsWith('.mp4')) continue
      try {
        const st = statSync(join(dir, f))
        files.push({ f, t: st.mtimeMs, size: st.size })
      } catch {
        /* 無視 */
      }
    }
    files.sort((a, b) => b.t - a.t) // 最終アクセスが新しい順に残す
    let bytes = 0
    let count = 0
    for (const x of files) {
      const over = bytes + x.size > PROXY_CACHE_MAX_BYTES || count + 1 > PROXY_CACHE_MAX_FILES
      if (over && !proxyInUse.has(x.f)) {
        try {
          rmSync(join(dir, x.f), { force: true })
        } catch {
          /* 無視 */
        }
        continue
      }
      // 使用中のものは上限を超えていても残す（そのぶん枠を消費させる）
      bytes += x.size
      count++
    }
  } catch {
    /* 無視 */
  }
}
// 起動時にも一度掃除する。従来は「プロキシ新規生成の成功時」しか走らなかったため、
// 上限を超えたまま起動しても解消されなかった。
pruneProxyCache(proxyDir)

/** サムネ・焼き直し・波形の受け口。**app.whenReady() の中で1回だけ呼ぶ。** */

export function registerMediaProbeHandlers(): void {
ipcMain.handle('video:thumbnail', async (_e, videoPath: string) => {
  if (!videoPath) return { ok: false, error: 'パスがありません' }
  if (!isAllowed(videoPath))
    return { ok: false, error: '許可されていないファイルです' }
  // 古いサムネを掃除（temp に無制限に溜まるのを防ぐ）。最新100枚だけ残す。
  pruneCache(app.getPath('temp'), (f) => /^giftcut_thumb_.*\.png$/.test(f), 100)
  const out = join(app.getPath('temp'), 'giftcut_thumb_' + Date.now() + '.png')
  const args = ['-y', '-ss', '0.5', '-i', videoPath, '-frames:v', '1', '-vf', 'scale=240:-1', out]
  return await new Promise((resolve) => {
    const ff = spawn(FFMPEG, args)
    let err = ''
    ff.stderr.on('data', (d) => {
      err += d.toString()
    })
    ff.on('error', (e) => resolve({ ok: false, error: e.message }))
    ff.on('close', (code) => {
      if (code === 0) {
        allowFile(out)
        resolve({ ok: true, path: out })
      } else resolve({ ok: false, error: err.slice(-200) })
    })
  })
})

// 編集用プロキシ生成: 低解像度・短GOP（キーフレーム密）に変換し、プレビューのシークを一瞬にする。
// 元動画のキーフレームが疎（例: 8秒間隔）だとシークに数百msかかり、カット通過や再生開始でカクつくため。
// 書き出しは元ファイル(videoPath)を使うので画質は劣化しない。結果はキャッシュして再変換を避ける。
// height でプレビュー解像度を選べる（既定360。renderer の「プレビュー解像度」設定に対応）。
ipcMain.handle('video:proxy', async (e, videoPath: string, height?: number) => {
  if (!videoPath || !existsSync(videoPath)) return { ok: false, error: 'ファイルがありません' }
  if (!isAllowed(videoPath))
    return { ok: false, error: '許可されていないファイルです' }
  // 想定外の値でおかしなサイズに変換しないよう、扱う解像度は固定の候補だけに絞る
  const proxyH = height === 1080 ? 1080 : height === 720 ? 720 : 360
  // 1080 は「見た目はほぼ原本」で見る物なので、画質側に寄せて焼く。
  // 720/360 は縮小して見る前提なので速さを採る
  const isFull = proxyH === 1080
  try {
    mkdirSync(proxyDir, { recursive: true })
  } catch {
    /* 既存 */
  }
  const st = statSync(videoPath)
  // 解像度もキーに含める。含めないと 360p と 720p が同じファイル名になり、
  // 先に作った方がもう一方として使い回されて解像度が取り違えられる。
  const key = createHash('md5')
    // 末尾の版番号は**プロキシの作り方を変えたら上げる**。
    // 上げないと、前の作り方で焼いた物が使われ続けて直したはずの物が直らない。
    // v4: 画質を 1080/720/360 の3つに整理し、素材より大きくは伸ばさないようにした
    .update(normalize(videoPath) + '|' + st.size + '|' + Math.round(st.mtimeMs) + '|h' + proxyH + '|v4')
    .digest('hex')
  const outPath = join(proxyDir, key + '.mp4')
  if (existsSync(outPath)) {
    allowFile(outPath)
    proxyInUse.add(key + '.mp4') // 使用中なので prune の対象外にする
    // LRU の印: 「使った」時刻を mtime に書く（古さを生成時刻ではなく最終アクセスで判定するため）
    try {
      utimesSync(outPath, new Date(), new Date())
    } catch {
      /* 無視 */
    }
    !e.sender.isDestroyed() && e.sender.send('video:proxy:progress', { path: videoPath, percent: 100 })
    return { ok: true, path: outPath, cached: true }
  }
  // 進捗計算用に総時間を取得
  const durSec = await new Promise<number>((resolve) => {
    const p = spawn(FFPROBE, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      videoPath
    ])
    let o = ''
    p.stdout.on('data', (d) => (o += d.toString()))
    p.on('close', () => resolve(parseFloat(o) || 0))
    p.on('error', () => resolve(0))
  })
  const tmp = join(proxyDir, key + '.tmp.mp4')
  // 焼くのに使う物は、書き出しと**同じ選び方**（実際に1枚焼けた物）を使い回す。
  //
  // 以前はここだけ `libx264` を直に書いていたが、**同梱の ffmpeg には x264 が
  // 入っていない**（LGPL 版。GPL 版を同梱するとソース公開の義務が付くので避けた）。
  // 開発機は PATH の ffmpeg を拾ってしまうので気づけず、配布物でだけ
  // 「プレビュー解像度を 720/360 にすると作れない」状態になっていた。
  //
  // プロキシは画質が要らないので GPU が一番向いている（速い・画質は捨ててよい）。
  const enc = await videoEncoder()
  // **焼き直しは「余ったCPU」でやる。**
  //
  // 変換中も編集は続く。ffmpeg は放っておくと全コアを使い切るので、
  // 音を出す処理まで押し出されて**プチプチ途切れる**（画質を落とした直後に
  // 一番ひどくなる＝その解像度をまだ焼いていないので、そこで変換が走るため）。
  // 絵が止まるのと違って、音の途切れは記録にも残らず、聴くまで分からない。
  //
  // コアを2つ空けておく。変換は少し遅くなるが、遅いのは待てばよく、
  // 編集中に音が割れるのは待っても直らない。
  const spare = Math.max(1, Math.min(6, cpus().length - 2))
  const args = [
    '-y',
    '-threads',
    String(spare), // 読み込み（復号）側
    '-i',
    videoPath,
    // **素材がその高さより小さければ、そのまま。**
    // 720p の素材を 1080 へ引き伸ばしても、粗くなって重くなるだけで良いことがない
    '-vf',
    `scale=-2:'min(ih,${proxyH})'`, // 編集用の解像度（書き出しは原本フル画質）
    // **全部のコマをキーフレームにする。**
    //
    // 動画はキーフレームからしか復号を再開できない。0.5秒間隔（-g 15）だと、
    // カットで飛ぶたびに「手前のキーフレームまで戻って、そこから目的地まで
    // 復号し直す」が起きる。実測で **カット1回につき 145〜235ms** 絵が止まり、
    // その間も再生ヘッドは進むので**コマが飛んだように見える**。
    //
    // プレミアが編集中に飛ばないのは、ProRes や DNxHD のような
    // **全コマがキーフレームの形式**を中間ファイルに使っているから。同じ考え方にする。
    // 飛び先が必ずキーフレーム＝復号し直しが1コマぶんで済む。
    //
    // 代わりにファイルは大きくなるが、プロキシは編集中だけの使い捨てで、
    // 書き出しは常に原本を使うので画質にも完成品の大きさにも影響しない。
    '-g',
    '1',
    '-keyint_min',
    '1',
    '-sc_threshold',
    '0',
    // ここから '-pix_fmt' の手前までが「焼く物の指定」。
    // CPU でやり直すときはこの範囲だけを差し替えるので、間に別の指定を挟まないこと
    ...(isFull ? enc.full() : enc.fast(proxyH)),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    '-threads',
    String(spare), // 書き込み（符号化）側。CPU でやり直す時はここが効く
    tmp
  ]
  /** 1回焼いてみる。進捗もここから送る */
  const runOnce = (a: string[]): Promise<{ code: number | null; err: string }> =>
    new Promise((resolve) => {
      const ff = spawn(FFMPEG, a)
      // **優先度も下げる。** スレッド数を絞っても、同じ優先度で並んでいる限り
      // OS は公平に順番を回すので、音を出す処理が待たされることがある。
      // 「編集の邪魔をしない」が焼き直しの正しい立ち位置。
      //
      // **いちばん低い所まで下げる。** 1つ下げた程度では足りず、
      // 変換中に「音が64ms抜ける」のが実測で残っていた（npm run stutter --fresh）。
      // 空いているCPUだけを使わせれば、編集中の音は途切れない。
      // 変換は遅くなるが、遅いのは待てばよく、音が割れるのは待っても直らない。
      try {
        if (ff.pid) setPriority(ff.pid, osConstants.priority.PRIORITY_LOW)
      } catch {
        /* 権限が無い環境では諦める（スレッド数の制限だけ効く） */
      }
      let err = ''
      ff.stderr.on('data', (d) => {
        const s = d.toString()
        err += s
        const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(s)
        if (m && durSec > 0) {
          const cur = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3])
          const pct = Math.min(99, Math.max(0, Math.round((cur / durSec) * 100)))
          !e.sender.isDestroyed() &&
            e.sender.send('video:proxy:progress', { path: videoPath, percent: pct })
        }
      })
      ff.on('error', (er) => resolve({ code: -1, err: 'ffmpeg起動失敗: ' + er.message }))
      ff.on('close', (code) => resolve({ code, err }))
    })

  let r = await runOnce(args)
  // GPU で焼いていて失敗したら CPU でやり直す（書き出しと同じ考え方）。
  // 起動時は通っても、書き出しと同時に走るとドライバの同時本数を超えて落ちることがある。
  if (r.code !== 0 && ['h264_nvenc', 'h264_qsv', 'h264_amf'].includes(enc.v)) {
    const x264 = ENCODERS.find((en) => en.v === 'libx264')!
    const oh264 = ENCODERS.find((en) => en.v === 'libopenh264')!
    const cpu = (await tryEncoder(x264)) ? x264 : oh264
    console.warn(`[プロキシ] GPU で失敗したので ${cpu.label} でやり直します`)
    const fixed = [...args]
    const from = fixed.indexOf('-c:v')
    const to = fixed.indexOf('-pix_fmt')
    // **やり直しでも同じ作り方を選ぶ。** ここで fast 固定にすると、
    // GPU の無い機械でだけ「最高画質を選んだのに眠い絵」になる
    if (from >= 0 && to > from)
      fixed.splice(from, to - from, ...(isFull ? cpu.full() : cpu.fast(proxyH)))
    r = await runOnce(fixed)
  }
  if (r.code === 0 && existsSync(tmp)) {
    try {
      renameSync(tmp, outPath)
    } catch (er) {
      return { ok: false, error: String(er) }
    }
    allowFile(outPath)
    proxyInUse.add(key + '.mp4') // 使用中なので prune の対象外にする
    // 古いプロキシを掃除（userData に無制限に溜まるのを防ぐ）。総容量ベースのLRU。
    pruneProxyCache(proxyDir)
    !e.sender.isDestroyed() &&
      e.sender.send('video:proxy:progress', { path: videoPath, percent: 100 })
    return { ok: true, path: outPath }
  }
  try {
    rmSync(tmp, { force: true })
  } catch {
    /* 無視 */
  }
  return { ok: false, error: 'プロキシ生成失敗 (code ' + r.code + ')\n' + r.err.slice(-300) }
})

// 波形のピーク値を解析（PCMのバケットごとの min/max を返す）。
// 精度のポイント: ダウンサンプリングすると リサンプラのローパスで真のピークが潰れるため、
// 高レート(48kHz)の実サンプルから min/max を取る（ClipGift 相当の正確さ）。
// 長尺でもメモリを食わないよう、チャンクを溜めずに逐次(ストリーミング)でバケット集計する。
// 喋っていない所を探す。
//
// 音の大きさだけで見る（文字起こしは使わない）。ブリューの無音カットも同じ考え方で、
// これだけで実用になる。どこまでを「無音」とするかは人によって違うので、
// しきい値と最短の長さは呼ぶ側から渡す。
ipcMain.handle(
  'audio:silences',
  async (_e, videoPath: string, noiseDb = -35, minSec = 0.35) => {
    if (!videoPath) return { ok: false, error: 'パスがありません' }
    if (!isAllowed(videoPath))
      return { ok: false, error: '許可されていないファイルです' }
    const db = Math.min(-5, Math.max(-90, Number(noiseDb) || -35))
    const min = Math.min(5, Math.max(0.05, Number(minSec) || 0.35))
    return await new Promise((resolve) => {
      const p = trackedSpawn(FFMPEG, [
        '-v', 'info',
        '-i', videoPath,
        '-map', '0:a:0?',
        '-af', `silencedetect=noise=${db}dB:d=${min}`,
        '-f', 'null',
        '-'
      ])
      let err = ''
      p.stderr?.on('data', (d) => (err += d.toString()))
      p.on('error', (e2) => resolve({ ok: false, error: 'ffmpeg起動失敗: ' + e2.message }))
      p.on('close', () => {
        // silencedetect は「開始」と「終了＋長さ」を別々の行で出す。
        // 終了行だけを見ると、最後まで無音のまま終わった区間を取りこぼす。
        const out: { start: number; dur: number }[] = []
        const re = /silence_start:\s*(-?[\d.]+)|silence_end:\s*(-?[\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g
        let m: RegExpExecArray | null
        let pending: number | null = null
        while ((m = re.exec(err))) {
          if (m[1] !== undefined) pending = parseFloat(m[1])
          else if (m[2] !== undefined && m[3] !== undefined) {
            const dur = parseFloat(m[3])
            const start = pending ?? parseFloat(m[2]) - dur
            out.push({ start: Math.max(0, start), dur })
            pending = null
          }
        }
        // 最後まで無音で終わった場合（終了行が出ない）
        if (pending !== null) {
          const dm = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(err)
          if (dm) {
            const total = +dm[1] * 3600 + +dm[2] * 60 + parseFloat(dm[3])
            if (total > pending) out.push({ start: pending, dur: total - pending })
          }
        }
        resolve({ ok: true, silences: out })
      })
    })
  }
)

ipcMain.handle('audio:waveform', async (_e, videoPath: string) => {
  if (!videoPath) return { ok: false, error: 'パスがありません' }
  if (!isAllowed(videoPath))
    return { ok: false, error: '許可されていないファイルです' }
  const rate = 48000 // 解析サンプルレート（Hz）。高レートの実サンプルからピークを取る
  const perSec = 300 // 秒あたりバケット数（表示密度）
  const per = Math.max(1, Math.round(rate / perSec)) // 1バケットのサンプル数(=160)
  // -ac 1 でモノラル化（L/R の大きい方を拾うため amerge ではなく単純平均だが、
  // ピーク検出には十分。aresample は 48k 化のみで実質ダウンサンプリングしない）
  const args = ['-v', 'error', '-i', videoPath, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-']
  return await new Promise((resolve) => {
    const ff = spawn(FFMPEG, args)
    const mins: number[] = []
    const maxs: number[] = []
    let curMin = 0
    let curMax = 0
    let cnt = 0
    let total = 0
    let leftover: Buffer = Buffer.alloc(0)
    let err = ''
    ff.stdout.on('data', (d: Buffer) => {
      const buf = leftover.length ? Buffer.concat([leftover, d]) : d
      const full = Math.floor(buf.length / 4)
      for (let i = 0; i < full; i++) {
        const v = buf.readFloatLE(i * 4)
        if (v > curMax) curMax = v
        if (v < curMin) curMin = v
        total++
        if (++cnt >= per) {
          maxs.push(curMax)
          mins.push(curMin)
          curMin = 0
          curMax = 0
          cnt = 0
        }
      }
      leftover = buf.subarray(full * 4)
    })
    ff.stderr.on('data', (d) => {
      err += d.toString()
    })
    ff.on('error', (e) => resolve({ ok: false, error: 'ffmpeg起動失敗: ' + e.message }))
    ff.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: '音声解析失敗（音声がない可能性）\n' + err.slice(-200) })
        return
      }
      if (cnt > 0) {
        maxs.push(curMax)
        mins.push(curMin)
      }
      if (!maxs.length) {
        resolve({ ok: false, error: '音声サンプルがありません' })
        return
      }
      // 長尺でバケットが多すぎる場合は隣接をmin/maxマージ（ピークは保持）してIPC/メモリを抑える
      let fmin = mins
      let fmax = maxs
      const CAP = 300000
      if (maxs.length > CAP) {
        const g = Math.ceil(maxs.length / CAP)
        const gm: number[] = []
        const gx: number[] = []
        for (let i = 0; i < maxs.length; i += g) {
          let mn = 0
          let mx = 0
          for (let j = i; j < Math.min(i + g, maxs.length); j++) {
            if (maxs[j] > mx) mx = maxs[j]
            if (mins[j] < mn) mn = mins[j]
          }
          gx.push(mx)
          gm.push(mn)
        }
        fmin = gm
        fmax = gx
      }
      let peak = 1e-6
      for (let b = 0; b < fmax.length; b++) {
        if (fmax[b] > peak) peak = fmax[b]
        if (-fmin[b] > peak) peak = -fmin[b]
      }
      resolve({
        ok: true,
        min: fmin.map((x) => x / peak),
        max: fmax.map((x) => x / peak),
        duration: total / rate
      })
    })
  })
})
}
