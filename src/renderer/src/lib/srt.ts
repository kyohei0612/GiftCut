import { defaultTelopStyle, type TelopStyle, type TextRun } from './telopStyle'
import { DEFAULT_LABEL } from './labels'

export interface Cue {
  id: number
  start: number // 秒
  end: number // 秒
  text: string
  style: TelopStyle
  runs?: TextRun[] // 文字範囲ごとの部分装飾（色/フォント/サイズ）。テキスト編集時にindexを保守
  label: string // ラベルカラー
  iconImage?: string // テロップ前に表示するアイコン画像(dataURL)。アイコンライブラリから選ぶ
  personIcon?: boolean // 旧: ラベル色紐付けアイコン（互換用。読み込みのみ）
  pos: { x: number; y: number } // フレーム内の中心位置（0-1）。既定は下中央
  track?: string // 配置トラック（V2/V3）。未指定は V2 扱い
  scale?: number // テロップ全体の拡縮倍率（Premiere式：リサイズはこれを変え、fontSize/縁/影の数値は固定）。既定1
}

function toSeconds(t: string): number {
  // 00:00:01,500 / 00:00:01.500 両対応
  const m = t.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/)
  if (!m) return 0
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000
}

/** SRT テキストを Cue 配列にパースする */
export function parseSrt(raw: string): Cue[] {
  const blocks = raw.replace(/\r/g, '').split(/\n{2,}/)
  const cues: Cue[] = []
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    if (lines.length < 2) continue
    const timeIdx = lines.findIndex((l) => l.includes('-->'))
    if (timeIdx === -1) continue
    const [startStr, endStr] = lines[timeIdx].split('-->')
    const text = lines.slice(timeIdx + 1).join('\n')
    if (!text) continue
    cues.push({
      id: cues.length + 1,
      start: toSeconds(startStr),
      end: toSeconds(endStr),
      text,
      style: defaultTelopStyle(),
      label: DEFAULT_LABEL,
      pos: { x: 0.5, y: 0.85 }
    })
  }
  return cues
}

/** 秒 → SRT タイムコード（00:00:01,500） */
function toSrtTime(sec: number): string {
  const total = Math.max(0, Math.round(sec * 1000))
  const ms = total % 1000
  const s = Math.floor(total / 1000)
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${p(hh)}:${p(mm)}:${p(ss)},${p(ms, 3)}`
}

/** Cue 配列 → SRT テキスト */
export function buildSrt(cues: { start: number; end: number; text: string }[]): string {
  const sorted = [...cues].sort((a, b) => a.start - b.start)
  return (
    sorted
      .map(
        (c, i) =>
          // 本文中の空行は SRT のブロック区切りと衝突するため1行に正規化
          `${i + 1}\n${toSrtTime(c.start)} --> ${toSrtTime(c.end)}\n${c.text.replace(/\n{2,}/g, '\n').trim()}`
      )
      .join('\n\n') + '\n'
  )
}

/** 秒 → 00:00.0 表記 */
export function formatTime(sec: number): string {
  const mm = Math.floor(sec / 60)
  const ss = Math.floor(sec % 60)
  const t = Math.floor((sec % 1) * 10)
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${t}`
}
