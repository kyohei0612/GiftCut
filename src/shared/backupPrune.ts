// バックアップ（時刻つきのプロジェクトの写し）を**どれだけ残すか**と、一覧に出す1行。
//
// ## なぜ要るか（2026-11-12・本人「復元ができない。自動保存があるのに全く役に立たなかった」）
//
// 下書き（自動保存）は「最新」と「1つ前」の2世代しか無く、しかもプロジェクトごとではなく
// 全体で1つ。次に何か編集すれば、2回目の自動保存で前の作業の下書きは消える。
// 復元を聞くのも落ちたときだけで、「保存せずに閉じる」や上書き保存した後は戻る先が無かった。
// → 2世代とは別に、時刻つきで貯めて、ファイルメニューからいつでも選んで戻せるようにする。
// 書く・読むのは main/projectBackups、ここは**判断だけ**（単体で試験できる形）。
//
// ## 残し方
//
// 新しい物ほど細かく、古い物ほど粗く。**直近の40個は必ず全部残す**（何日前でも。
// 久しぶりに開いた人の「最後の作業」を日数で捨てない）。それより古い物は
// 48時間以内なら1時間に1つ、30日以内なら1日に1つ（どちらもその枠でいちばん新しい物）。
//
// ## 中身
//
// - `backupsToDelete` … 時刻の一覧 → 捨てる時刻
// - `backupSummary` … プロジェクトの中身 → 一覧に出す数（本編・文字の数と、動画の名前）
// - `backupLabel` … 一覧の1行（「11/12 14:32　保存　本編12・文字340　動画名」）
// - `BACKUP_KEEP_RECENT` … 必ず残す数（自動保存は1分おきなので、編集中の約40分ぶん）

/** 直近のこの数は、古さに関係なく全部残す */
export const BACKUP_KEEP_RECENT = 40

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** 捨てる物の時刻を返す。`times` はバックアップを取った時刻（ms・順不同でよい） */
export function backupsToDelete(times: readonly number[], now: number): number[] {
  const sorted = [...times].sort((a, b) => b - a)
  const drop: number[] = []
  const seen = new Set<string>()
  sorted.slice(BACKUP_KEEP_RECENT).forEach((t) => {
    const age = now - t
    const bucket =
      age <= 2 * DAY ? `h${Math.floor(t / HOUR)}` : age <= 30 * DAY ? `d${Math.floor(t / DAY)}` : null
    if (bucket === null || seen.has(bucket)) drop.push(t)
    else seen.add(bucket)
  })
  return drop
}

/** 一覧に出す1件 */
export interface BackupInfo {
  /** ファイル名（読むときにそのまま渡す） */
  id: string
  /** 取った時刻（ms） */
  time: number
  /** 自動保存ぶん／上書き保存したとき／上書きされる前の中身 */
  origin: 'auto' | 'save' | 'prev'
  segs: number
  cues: number
  /** 動画の名前（見分け用。無ければ空） */
  video: string
}

/** プロジェクトの中身から、一覧に出す数を拾う。**形が保証されていない**（ディスクから読んだ物） */
export function backupSummary(data: unknown): Pick<BackupInfo, 'segs' | 'cues' | 'video'> {
  const d = (data ?? {}) as Record<string, unknown>
  const len = (v: unknown): number => (Array.isArray(v) ? v.length : 0)
  const first = Array.isArray(d.sources) ? (d.sources[0] as { name?: unknown } | undefined) : undefined
  const path = typeof d.videoPath === 'string' ? d.videoPath : ''
  const video = typeof first?.name === 'string' ? first.name : (path.split(/[\\/]/).pop() ?? '')
  // 空き（gap）は本編の本数に数えない
  const segs = Array.isArray(d.segments)
    ? d.segments.filter((s) => !(s as { gap?: boolean } | null)?.gap).length
    : 0
  return { segs, cues: len(d.cues), video }
}

const ORIGIN_LABEL: Record<BackupInfo['origin'], string> = {
  auto: '自動',
  save: '保存',
  prev: '上書き前'
}

/** 一覧の1行。時刻は月日と時分（年は出さない。30日より古い物は直近40個にしか残らない） */
export function backupLabel(b: BackupInfo): string {
  const d = new Date(b.time)
  const p2 = (n: number): string => String(n).padStart(2, '0')
  const when = `${d.getMonth() + 1}/${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}`
  return `${when}　${ORIGIN_LABEL[b.origin]}　本編${b.segs}・文字${b.cues}${b.video ? `　${b.video}` : ''}`
}
