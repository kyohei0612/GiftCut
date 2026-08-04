// 通しの確認で使う「測る道具」。画面を撮る・絵を比べる・音を測る・ZIP を覗く。
//
// **e2e/run.mjs から出しただけ。中身は1文字も変えていない**（2026-08-03）。
// 出した理由は行数——run.mjs が上限（1,250行）に貼り付いて、確認を1つ足すたびに
// 関係ない所の説明を削る羽目になっていた。
//
// ## 借りている物は2つだけ
//
// `page`（撮る相手）と `assert`（比べられなかったときに止める）。
// 数えたらこの2つで、あとは ffmpeg / yauzl に聞くだけ＝**切り出せる形だった**
//（`引き継ぎ-心臓の分け直し.md` の「境目をまたぐ名前を数える」）。
//
// ## lib/measure.mjs と中身が重なっている（未解決）
//
// あちら（bench が使う）にも `similarity` と `meanVolume` があるが、
// **実装が違う**——`-lavfi` と `-filter_complex`、返り値が NaN と null。
// どちらかへ寄せるべきだが、寄せると判定の閾値が動きうるので、
// **今回は動かさない**。`やること.md` に理由つきで控えてある。

import { spawn } from 'node:child_process'
import { join } from 'node:path'

/**
 * 測る道具をまとめて作る。
 *
 * @param page   撮る相手（Playwright のページ）
 * @param assert 比べられなかったときに止める
 * @param shotDir 撮った絵の置き場
 */
export function makeRunMeasure(page, assert, shotDir) {
  let shotNo = 0
  /** 画面（または一部）を撮って保存する。あとから目で見返せる記録にもなる。 */
  async function shot(label, locator) {
    const f = join(
      shotDir,
      `${String(++shotNo).padStart(2, '0')}-${label.replace(/[^\w一-龥ぁ-んァ-ヶー]/g, '_').slice(0, 40)}.png`
    )
    if (locator) await locator.screenshot({ path: f })
    else await page.screenshot({ path: f })
    return f
  }
  /**
   * 2枚の画像がどれくらい同じか（1.0 = 完全に同じ）。
   * 「帯が出ていない＝空いている所と同じに見える」のような、
   * 数値では確かめられない見た目の判定に使う。
   */
  async function similarity(a, b) {
    const p = spawn('ffmpeg', ['-i', a, '-i', b, '-filter_complex', 'ssim', '-f', 'null', '-'])
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    await new Promise((res) => p.on('close', res))
    const m = /All:([\d.]+)/.exec(err)
    assert(m, `見た目を比べられなかった:\n${err.slice(-300)}`)
    return parseFloat(m[1])
  }
  /** ZIP に入っている名前の一覧（中身は取り出さない） */
  async function zipNames(zipPath) {
    const yauzl = (await import('yauzl')).default
    return new Promise((res, rej) => {
      yauzl.open(zipPath, { lazyEntries: true }, (err, zf) => {
        if (err) return rej(err)
        const names = []
        zf.on('entry', (e) => {
          names.push(e.fileName.replace(/\\/g, '/'))
          zf.readEntry()
        })
        zf.on('end', () => res(names))
        zf.on('error', rej)
        zf.readEntry()
      })
    })
  }
  /** ZIP の中の1件を文字列で取り出す */
  async function zipRead(zipPath, name) {
    const yauzl = (await import('yauzl')).default
    return new Promise((res, rej) => {
      yauzl.open(zipPath, { lazyEntries: true }, (err, zf) => {
        if (err) return rej(err)
        zf.on('entry', (e) => {
          if (e.fileName.replace(/\\/g, '/') !== name) return zf.readEntry()
          zf.openReadStream(e, (e2, rs) => {
            if (e2) return rej(e2)
            const chunks = []
            rs.on('data', (c) => chunks.push(c))
            rs.on('end', () => res(Buffer.concat(chunks).toString('utf-8')))
          })
        })
        zf.on('end', () => rej(new Error(`ZIP に ${name} が無い`)))
        zf.on('error', rej)
        zf.readEntry()
      })
    })
  }

  /**
   * その時刻の1枚を、**フレーム単位で正確に**抜く（＋任意の加工）。
   *
   * grabFrame は -ss を -i の前に置く速い抜き方で、キーフレームまでしか戻らない。
   * 「寄った絵か」を比べるときは1フレームの取り違えが効くので、こちらを使う。
   */
  async function exactFrame(video, sec, out, vf) {
    await new Promise((res) => {
      const args = ['-y', '-i', video, '-ss', String(sec), '-frames:v', '1']
      if (vf) args.push('-vf', vf)
      args.push(out)
      spawn('ffmpeg', args).on('close', res)
    })
    return out
  }
  /** 書き出した動画から、その時刻の1枚を抜く（動いているかを目で比べるため） */
  async function grabFrame(video, sec, out) {
    await new Promise((res) => {
      const p = spawn('ffmpeg', ['-y', '-ss', String(sec), '-i', video, '-frames:v', '1', out])
      p.on('close', res)
    })
    return out
  }

  /**
   * 画像の一部だけの明るさを測る。
   *
   * **切り取りは撮るときではなく、撮った後にやること。** Playwright の
   * screenshot に clip を渡すと表示範囲がいじられ、その拍子にマウスが枠から
   * 出た扱いになる。マウスを乗せている前提の物（ホバーの印）は、撮る瞬間に
   * 消えてしまい「描かれていない」という誤った結論になる（実際に一度なった）。
   */
  async function avgColorAt(f, x, y, w, h) {
    return avgColor(f, `crop=${w}:${h}:${x}:${y}`)
  }
  /** 画像の平均色（0〜255）。赤くなったか、暗くなったかを測る。 */
  async function avgColor(f, pre) {
    const vf = (pre ? pre + ',' : '') + 'signalstats,metadata=print'
    const p = spawn('ffmpeg', ['-i', f, '-vf', vf, '-f', 'null', '-'])
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    await new Promise((res) => p.on('close', res))
    const g = (k) => {
      const m = new RegExp(`lavfi\\.signalstats\\.${k}=([\\d.]+)`).exec(err)
      return m ? parseFloat(m[1]) : null
    }
    const min = g('YMIN')
    const max = g('YMAX')
    // V が大きいほど赤寄り。range は明暗の幅＝「模様があるか（帯や文字が乗っているか）」
    return {
      y: g('YAVG'),
      u: g('UAVG'),
      v: g('VAVG'),
      range: min != null && max != null ? max - min : null
    }
  }

  // ---------------------------------------------------------------------------
  // 耳で聴く確認（書き出した音を ffmpeg で測る）
  // ---------------------------------------------------------------------------
  const ffAudio = async (file, filter, re) => {
    const p = spawn('ffmpeg', ['-i', file, '-af', filter, '-f', 'null', '-'])
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    await new Promise((res) => p.on('close', res))
    return { err, m: re ? err.match(re) : null }
  }
  /** 平均音量(dB)。無音なら -91 付近になる。 */
  async function meanVolume(file) {
    const { err } = await ffAudio(file, 'volumedetect')
    const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(err)
    return m ? parseFloat(m[1]) : null
  }
  /** 無音が続いた区間（秒）の一覧。音の途切れを見つける。 */
  async function silences(file, thresholdDb = -50, minSec = 0.4) {
    const { err } = await ffAudio(file, `silencedetect=noise=${thresholdDb}dB:d=${minSec}`)
    const out = []
    const re = /silence_start:\s*(-?[\d.]+)[\s\S]*?silence_duration:\s*([\d.]+)/g
    let m
    while ((m = re.exec(err))) out.push({ start: parseFloat(m[1]), dur: parseFloat(m[2]) })
    return out
  }
  /** 全体のラウドネス(LUFS)。「音量が揃っているか」の判定に使う。 */
  async function loudness(file) {
    const { err } = await ffAudio(file, 'ebur128=framelog=quiet')
    const m = /I:\s*(-?[\d.]+) LUFS/.exec(err)
    return m ? parseFloat(m[1]) : null
  }

  return {
    shot,
    similarity,
    zipNames,
    zipRead,
    exactFrame,
    grabFrame,
    avgColorAt,
    avgColor,
    meanVolume,
    silences,
    loudness
  }
}
