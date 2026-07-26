// ============================================================================
// プロジェクトデータの整合性チェック（純粋関数のみ）
//
// なぜ必要か:
//   これまで「保存して開き直したら選択が消えたクリップを指していた」「トラックを
//   消したのにそこに載っていたクリップが残っていた」「映像レイヤーに対の音声
//   トラックが無い」といった不整合を、人が触って気づくか、監査で全コードを
//   読んで見つけるしかなかった。
//
//   ここは「壊れている状態そのもの」を定義する。データを渡せば不整合が列挙されるので、
//   10分コードを読む代わりに1秒で判定できる。
//
// 使い方:
//   npm run check -- path/to/project.gcproj        人が読む形
//   npm run check -- path/to/project.gcproj --json 機械が読む形
// ============================================================================
import { EPS, segTLen, type TimeSeg } from './timeline'

export interface ProjectProblem {
  /** error = データとして壊れている。warning = 動くが設計意図と食い違う */
  severity: 'error' | 'warning'
  code: string
  message: string
  /** 'segments[3]' のような位置 */
  where?: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

const isObj = (v: Any): boolean => !!v && typeof v === 'object' && !Array.isArray(v)
const arr = (v: Any): Any[] => (Array.isArray(v) ? v : [])
const num = (v: Any): number | null => (typeof v === 'number' && isFinite(v) ? v : null)

/** V3 → 3 */
const trackNum = (id: Any): number => (typeof id === 'string' ? Number(id.slice(1)) || 0 : 0)

/**
 * プロジェクトデータを検査して不整合を列挙する（空配列＝問題なし）。
 * 例外は投げない。壊れた JSON を渡されても指摘として返す。
 */
export function checkProject(raw: unknown): ProjectProblem[] {
  const p: ProjectProblem[] = []
  const push = (
    severity: 'error' | 'warning',
    code: string,
    message: string,
    where?: string
  ): void => {
    p.push({ severity, code, message, where })
  }

  if (!isObj(raw)) {
    push('error', 'E_NOT_OBJECT', 'プロジェクトデータがオブジェクトではありません')
    return p
  }
  const d = raw as Any

  // ---- トラック ----
  const tracks = arr(d.tracks)
  const trackIds = new Set<string>()
  tracks.forEach((t: Any, i: number) => {
    if (!isObj(t) || typeof t.id !== 'string' || !t.id) {
      push('error', 'E_TRACK_SHAPE', 'トラックに id がありません', `tracks[${i}]`)
      return
    }
    if (trackIds.has(t.id)) {
      push('error', 'E_TRACK_DUP', `トラック ${t.id} が重複しています`, `tracks[${i}]`)
    }
    trackIds.add(t.id)
    if (t.kind !== 'video' && t.kind !== 'audio') {
      push('error', 'E_TRACK_KIND', `トラック ${t.id} の kind が不正です（${t.kind}）`, `tracks[${i}]`)
    }
  })

  // 並び順＝タイムラインの縦位置＝重なり順（前にあるほど前面）。
  // 映像は番号の降順（V3,V2,V1）、音声は昇順（A1,A2,A3）でなければならない。
  // 崩れると「番号が大きいほど前面」という前提が壊れ、V4 のテロップが V3 の
  // 画像の後ろに隠れる、といった説明できない見え方になる。
  const vNums = tracks.filter((t: Any) => isObj(t) && t.kind === 'video').map((t: Any) => trackNum(t.id))
  const aNums = tracks.filter((t: Any) => isObj(t) && t.kind === 'audio').map((t: Any) => trackNum(t.id))
  for (let i = 0; i + 1 < vNums.length; i++) {
    if (vNums[i] < vNums[i + 1]) {
      push('warning', 'W_TRACK_ORDER', `映像トラックの並びが番号の降順になっていません（V${vNums[i]} の下に V${vNums[i + 1]}）`, 'tracks')
      break
    }
  }
  for (let i = 0; i + 1 < aNums.length; i++) {
    if (aNums[i] > aNums[i + 1]) {
      push('warning', 'W_TRACK_ORDER', `音声トラックの並びが番号の昇順になっていません（A${aNums[i]} の下に A${aNums[i + 1]}）`, 'tracks')
      break
    }
  }

  // trackStates が実在しないトラックを指していないか（トラック削除時の掃除漏れ）
  if (isObj(d.trackStates)) {
    for (const k of Object.keys(d.trackStates)) {
      if (trackIds.size && !trackIds.has(k)) {
        push('warning', 'W_TRACKSTATE_ORPHAN', `トラック ${k} は存在しないのに状態が残っています`, 'trackStates')
      }
    }
  }

  // ---- ソース（マルチソース） ----
  const sources = arr(d.sources)
  const srcIds = new Set<number>()
  sources.forEach((s: Any, i: number) => {
    if (!isObj(s)) {
      push('error', 'E_SOURCE_SHAPE', 'ソースの形が不正です', `sources[${i}]`)
      return
    }
    if (num(s.id) === null) {
      push('error', 'E_SOURCE_ID', 'ソースに id がありません', `sources[${i}]`)
    } else {
      if (srcIds.has(s.id)) {
        push('error', 'E_SOURCE_DUP', `ソース id=${s.id} が重複しています`, `sources[${i}]`)
      }
      srcIds.add(s.id)
    }
    if (typeof s.path !== 'string' || !s.path) {
      push('error', 'E_SOURCE_PATH', 'ソースのパスが空です', `sources[${i}]`)
    }
  })

  // ---- 切片（VSeg） ----
  const segments = arr(d.segments)
  const segIds = new Set<number>()
  segments.forEach((s: Any, i: number) => {
    const at = `segments[${i}]`
    if (!isObj(s)) {
      push('error', 'E_SEG_SHAPE', '切片の形が不正です', at)
      return
    }
    if (num(s.id) === null) push('error', 'E_SEG_ID', '切片に id がありません', at)
    else {
      if (segIds.has(s.id)) push('error', 'E_SEG_DUP', `切片 id=${s.id} が重複しています`, at)
      segIds.add(s.id)
    }
    const a = num(s.srcStart)
    const b = num(s.srcEnd)
    if (a === null || b === null) {
      push('error', 'E_SEG_TIME', 'srcStart/srcEnd が数値ではありません', at)
    } else {
      if (a < 0) push('error', 'E_SEG_NEGATIVE', `srcStart が負です（${a}）`, at)
      if (b <= a) {
        push('error', 'E_SEG_EMPTY', `長さが 0 以下です（srcStart=${a}, srcEnd=${b}）`, at)
      }
    }
    if (s.speed !== undefined && !(num(s.speed) !== null && s.speed > 0)) {
      push('error', 'E_SEG_SPEED', `速度が不正です（${s.speed}）`, at)
    }
    // マルチソースの孤児: 存在しない元動画を指している
    if (s.srcId !== undefined && s.srcId !== null) {
      if (srcIds.size && !srcIds.has(s.srcId)) {
        push('error', 'E_SEG_SRC_MISSING', `存在しないソース id=${s.srcId} を指しています`, at)
      }
    }
    // 最後の切片に「次との間のクロスディゾルブ」が残っている（削除時の掃除漏れ）
    if (i === segments.length - 1 && isObj(s.xfade)) {
      push('warning', 'W_XFADE_ORPHAN', '最後の切片に次クリップとのトランジションが残っています', at)
    }
    for (const key of ['transIn', 'transOut', 'xfade']) {
      const tr = s[key]
      if (tr !== undefined && tr !== null) {
        if (!isObj(tr) || !(num(tr.dur) !== null && tr.dur > 0)) {
          push('error', 'E_TRANS_DUR', `${key} の長さが不正です`, at)
        }
      }
    }
  })

  // ---- 絶対配置クリップ（画像/映像レイヤー/SE） ----
  interface Placed {
    id: Any
    track: string
    tStart: number
    len: number
    where: string
    kind: string
  }
  const placed: Placed[] = []

  // 開始位置のフィールド名はクリップ種で違う（動画/画像/SE は tStart、テロップは start）。
  // ここを共通の 'tStart' 決め打ちにすると、正常なテロップ全件が誤検知になる。
  const checkPlaced = (
    list: Any[],
    kind: string,
    startOf: (c: Any) => number | null,
    lenOf: (c: Any) => number | null,
    requireTrack: boolean
  ): void => {
    const ids = new Set<Any>()
    list.forEach((c: Any, i: number) => {
      const at = `${kind}[${i}]`
      if (!isObj(c)) {
        push('error', 'E_CLIP_SHAPE', `${kind} の形が不正です`, at)
        return
      }
      if (num(c.id) === null) push('error', 'E_CLIP_ID', 'id がありません', at)
      else {
        if (ids.has(c.id)) push('error', 'E_CLIP_DUP', `id=${c.id} が重複しています`, at)
        ids.add(c.id)
      }
      if (typeof c.path === 'string' && !c.path) {
        push('error', 'E_CLIP_PATH', 'パスが空です', at)
      }
      const t0 = startOf(c)
      if (t0 === null) push('error', 'E_CLIP_TIME', '開始位置が数値ではありません', at)
      else if (t0 < -EPS) push('error', 'E_CLIP_NEGATIVE', `tStart が負です（${t0}）`, at)

      const len = lenOf(c)
      if (len === null) push('error', 'E_CLIP_LEN', '長さが数値ではありません', at)
      else if (len <= 0) push('error', 'E_CLIP_EMPTY', `長さが 0 以下です（${len}）`, at)

      // トラック参照（トラックを消したのにクリップが残る事故）
      const tid = c.track
      if (requireTrack || tid !== undefined) {
        if (typeof tid !== 'string' || !tid) {
          push('error', 'E_CLIP_TRACK', 'トラック指定がありません', at)
        } else if (trackIds.size && !trackIds.has(tid)) {
          push('error', 'E_CLIP_TRACK_MISSING', `存在しないトラック ${tid} に載っています`, at)
        }
      }
      if (typeof tid === 'string' && t0 !== null && len !== null && len > 0) {
        placed.push({ id: c.id, track: tid, tStart: t0, len, where: at, kind })
      }
    })
  }

  const tStartOf = (c: Any): number | null => num(c.tStart)

  checkPlaced(arr(d.imgClips), 'imgClips', tStartOf, (c) => num(c.duration), true)
  checkPlaced(arr(d.seClips), 'seClips', tStartOf, (c) => num(c.duration), true)
  checkPlaced(
    arr(d.vClips),
    'vClips',
    tStartOf,
    (c) => {
      const a = num(c.srcStart)
      const b = num(c.srcEnd)
      return a === null || b === null ? null : b - a
    },
    true
  )
  // テロップ（cue）は start/end 秒で持つ。track 未指定なら V2 扱いなので
  // トラック指定がある場合だけ参照を検査する。
  checkPlaced(
    arr(d.cues),
    'cues',
    (c) => num(c.start),
    (c) => {
      const a = num(c.start)
      const b = num(c.end)
      return a === null || b === null ? null : b - a
    },
    false
  )

  // ---- 同じトラック上でクリップが重なっていないか ----
  const byTrack = new Map<string, Placed[]>()
  for (const c of placed) {
    const list = byTrack.get(c.track) ?? []
    list.push(c)
    byTrack.set(c.track, list)
  }
  for (const [track, list] of byTrack) {
    // テロップは同じトラックで重ねる使い方があり得るので対象外にする
    const solid = list.filter((c) => c.kind !== 'cues').sort((a, b) => a.tStart - b.tStart)
    for (let i = 0; i + 1 < solid.length; i++) {
      const cur = solid[i]
      const next = solid[i + 1]
      if (next.tStart < cur.tStart + cur.len - 1e-4) {
        // 警告に留める: 重なりを許す仕様かどうかはクリップ種によって違い得るため、
        // 断定せず「見るべき箇所」として出す（エラーにして正常な保存を弾かない）。
        push(
          'warning',
          'W_CLIP_OVERLAP',
          `トラック ${track} でクリップが重なっています（${cur.kind} id=${cur.id} と ${next.kind} id=${next.id}）`,
          next.where
        )
      }
    }
  }

  // ---- 映像レイヤーは対になる音声トラックが必要（V3 ↔ A3 の完全リンク） ----
  for (const c of placed) {
    if (c.kind !== 'vClips') continue
    const n = trackNum(c.track)
    if (n <= 1) continue
    const paired = 'A' + n
    if (trackIds.size && !trackIds.has(paired)) {
      push(
        'error',
        'E_VCLIP_NO_PAIR',
        `${c.track} の映像レイヤーに対の音声トラック ${paired} がありません（位置リンクが崩れます）`,
        c.where
      )
    }
  }

  // ---- マーカー ----
  const mIds = new Set<Any>()
  arr(d.markers).forEach((m: Any, i: number) => {
    const at = `markers[${i}]`
    if (!isObj(m)) {
      push('error', 'E_MARKER_SHAPE', 'マーカーの形が不正です', at)
      return
    }
    if (mIds.has(m.id)) push('error', 'E_MARKER_DUP', `マーカー id=${m.id} が重複しています`, at)
    mIds.add(m.id)
    const t = num(m.t)
    if (t === null) push('error', 'E_MARKER_TIME', 't が数値ではありません', at)
    else if (t < -EPS) push('error', 'E_MARKER_NEGATIVE', `t が負です（${t}）`, at)
  })

  // ---- 素材とタイムラインの食い違い ----
  if (segments.length > 0 && !d.videoPath && sources.length === 0) {
    push('error', 'E_NO_MEDIA', '切片があるのに元動画もソース一覧もありません')
  }
  if (sources.length === 0 && segments.some((s: Any) => isObj(s) && s.srcId !== undefined)) {
    push('error', 'E_NO_SOURCES', 'srcId を持つ切片があるのにソース一覧が空です')
  }

  // 「本編より後ろにあるクリップ」は指摘しない。
  // 書き出しは extendSec で最終フレームを伸ばして末尾のテロップを含める作りなので、
  // 本編より後ろにテロップがあるのは仕様どおり。実データで179件の誤検知になり、
  // 本物の指摘が埋もれていた。

  return p
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function hasProjectError(problems: readonly ProjectProblem[]): boolean {
  return problems.some((x) => x.severity === 'error')
}

export function formatProjectProblems(problems: readonly ProjectProblem[]): string {
  if (!problems.length) return '不整合は見つかりませんでした。'
  return problems
    .map((x) => `[${x.severity === 'error' ? 'エラー' : '警告'}/${x.code}] ${x.where ? x.where + ': ' : ''}${x.message}`)
    .join('\n')
}
