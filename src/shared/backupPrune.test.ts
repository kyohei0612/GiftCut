// バックアップをどれだけ残すか・一覧の1行。
import { describe, expect, it } from 'vitest'
import { BACKUP_KEEP_RECENT, backupLabel, backupSummary, backupsToDelete } from './backupPrune'

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
// 時刻の枠（1時間・1日）の境目に掛からないよう、切りのいい時刻を今にする
const NOW = Math.floor(Date.UTC(2026, 10, 12, 12) / DAY) * DAY + 12 * HOUR

describe('backupsToDelete — どれを捨てるか', () => {
  it('直近の40個は、何日前の物でも全部残す', () => {
    const times = Array.from({ length: BACKUP_KEEP_RECENT }, (_, i) => NOW - 100 * DAY - i * MIN)
    expect(backupsToDelete(times, NOW)).toEqual([])
  })

  it('40個より古い物は、48時間以内なら1時間に1つ（その枠でいちばん新しい物）だけ残す', () => {
    const recent = Array.from({ length: BACKUP_KEEP_RECENT }, (_, i) => NOW - i * 1000)
    // 5時間前の同じ1時間の枠に3つ
    const base = NOW - 5 * HOUR
    const old = [base + 50 * MIN, base + 30 * MIN, base + 10 * MIN]
    expect(backupsToDelete([...recent, ...old], NOW).sort()).toEqual([base + 30 * MIN, base + 10 * MIN].sort())
  })

  it('48時間より古く30日以内の物は、1日に1つだけ残す', () => {
    const recent = Array.from({ length: BACKUP_KEEP_RECENT }, (_, i) => NOW - i * 1000)
    const day = NOW - 10 * DAY
    const old = [day + 3 * HOUR, day + 2 * HOUR, day + 1 * HOUR]
    expect(backupsToDelete([...recent, ...old], NOW).sort()).toEqual([day + 2 * HOUR, day + 1 * HOUR].sort())
  })

  it('40個より古く、30日も過ぎた物は捨てる', () => {
    const recent = Array.from({ length: BACKUP_KEEP_RECENT }, (_, i) => NOW - i * 1000)
    const old = NOW - 31 * DAY
    expect(backupsToDelete([...recent, old], NOW)).toEqual([old])
  })
})

describe('backupSummary / backupLabel — 一覧に出す物', () => {
  it('本編（空きは数えない）・文字の数と、動画の名前を拾う', () => {
    const data = {
      sources: [{ id: 1, path: 'C:/v/a.mp4', name: 'a.mp4' }],
      segments: [{ id: 1 }, { id: 2, gap: true }, { id: 3 }],
      cues: [{}, {}, {}]
    }
    expect(backupSummary(data)).toEqual({ segs: 2, cues: 3, video: 'a.mp4' })
  })

  it('壊れた中身でも落ちない（数は 0・名前は空）', () => {
    expect(backupSummary(null)).toEqual({ segs: 0, cues: 0, video: '' })
    expect(backupSummary({ segments: 'x', cues: 5 })).toEqual({ segs: 0, cues: 0, video: '' })
  })

  it('1行は「月日 時分・種類・数・動画名」', () => {
    const time = new Date(2026, 10, 12, 14, 5).getTime()
    expect(backupLabel({ id: 'x', time, origin: 'save', segs: 12, cues: 340, video: 'a.mp4' })).toBe(
      '11/12 14:05　保存　本編12・文字340　a.mp4'
    )
  })
})
