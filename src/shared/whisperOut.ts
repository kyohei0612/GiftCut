// 聞き取りの出力（whisper.cpp が出す行）を読む。
//
// 出てくるのはこういう行:
//
//   [00:00:01.000 --> 00:00:03.240]   こんにちは
//
// **版によって出す先が変わる**（標準出力だったり、そうでなかったり）ので、
// 呼ぶ側は両方をここへ通す。読めない行は黙って捨てる——進み具合の表示や
// 飾りの行が混ざるのが普通で、そこで止めても何も良くならない。

export interface WhisperSeg {
  start: number
  end: number
  text: string
}

const LINE = /^\[(\d+):(\d+):(\d+[.,]\d+)\s*-->\s*(\d+):(\d+):(\d+[.,]\d+)\]\s*(.*)$/

const sec = (h: string, m: string, s: string): number =>
  Number(h) * 3600 + Number(m) * 60 + Number(s.replace(',', '.'))

/** 1行を読む。時刻付きの行でなければ null */
export function parseWhisperLine(line: string): WhisperSeg | null {
  const m = LINE.exec(line.trim())
  if (!m) return null
  const text = m[7].trim()
  if (!text) return null // 時刻だけの行（無音）は字幕にしない
  const start = sec(m[1], m[2], m[3])
  const end = sec(m[4], m[5], m[6])
  if (!(end > start)) return null // 逆さま・0秒は捨てる
  return { start, end, text }
}

/** まとめて読む */
export function parseWhisperOut(text: string): WhisperSeg[] {
  const out: WhisperSeg[] = []
  for (const line of text.split(/\r?\n/)) {
    const s = parseWhisperLine(line)
    if (s) out.push(s)
  }
  return out
}
