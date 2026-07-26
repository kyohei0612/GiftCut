// ============================================================================
// ffmpeg filter_complex グラフの検証（純粋関数のみ）
//
// なぜ必要か:
//   書き出しのフィルタは文字列連結で組み立てている。入力 index を
//   `nSrc + pngPaths.length + k` のように手計算しているため、1つズレると
//   まったく別の素材が合成される。実際に踏んだ例:
//     - 映像レイヤーの音声ミックスが条件分岐の内側にあり、ラベルを定義したのに
//       誰も消費せず、音声が丸ごと落ちた
//     - 無音の動画に対して無条件に [N:a] を参照し、書き出しが失敗した
//   どちらも ffmpeg を起動して初めて分かる（しかもエラーが暗号）。
//
//   ここでは ffmpeg を起動する前にグラフを検査する。検出するのは
//   「ffmpeg でも必ず失敗する不整合」だけなので、今動いている書き出しを
//   壊すことはない（成立しているグラフはすべての error 規則を満たす）。
//
// 前提: このグラフでは '[' ']' はラベル区切りとしてのみ現れ、';' は
//   チェーン区切りとしてのみ現れる（drawtext のような自由文字列を使っていない）。
// ============================================================================

/** 入力ファイル1つが持つストリーム */
export interface GraphInput {
  hasVideo: boolean
  hasAudio: boolean
  /** エラーメッセージに出すための名前（任意） */
  name?: string
}

export interface GraphProblem {
  /** error = ffmpeg でも必ず失敗する。warning = 動くかもしれないが設計上おかしい */
  severity: 'error' | 'warning'
  code: string
  message: string
  /** 問題があったチェーン（長い場合は切り詰める） */
  chain?: string
}

export interface ValidateOpts {
  /** -i で渡す入力の一覧（順番どおり） */
  inputs: GraphInput[]
  /** -map で指定するラベル（'[v]' でも 'v' でも可） */
  maps?: string[]
}

interface Chain {
  raw: string
  ins: string[]
  outs: string[]
}

const trim = (s: string, n = 120): string => (s.length > n ? s.slice(0, n) + '…' : s)

/** 先頭/末尾に連続する [label] を取り出す */
function parseChain(raw: string): Chain {
  const ins: string[] = []
  const outs: string[] = []
  let body = raw

  for (;;) {
    const m = /^\[([^[\]]*)\]/.exec(body)
    if (!m) break
    ins.push(m[1])
    body = body.slice(m[0].length)
  }
  for (;;) {
    const m = /\[([^[\]]*)\]$/.exec(body)
    if (!m) break
    outs.unshift(m[1])
    body = body.slice(0, body.length - m[0].length)
  }
  return { raw, ins, outs }
}

/**
 * '0:v' / '3:a' / '2' のような入力ファイル参照か。
 * '0:a?' の末尾 '?' は「無ければ無視してよい」という ffmpeg の指定なので、
 * ストリームが無くてもエラーにしない（optional=true）。
 */
function parseInputRef(
  label: string
): { idx: number; kind: 'v' | 'a' | null; optional: boolean } | null {
  const m = /^(\d+)(?::([va]))?(\?)?$/.exec(label)
  if (!m) return null
  return { idx: Number(m[1]), kind: (m[2] as 'v' | 'a') || null, optional: !!m[3] }
}

/** -map の指定から括弧を外す */
const stripBrackets = (s: string): string => s.replace(/^\[|\]$/g, '')

/**
 * グラフを検証して問題のリストを返す（空配列＝問題なし）。
 * 例外は投げない。呼び出し側は severity==='error' があれば書き出しを止めればよい。
 */
export function validateFilterGraph(filter: string, opts: ValidateOpts): GraphProblem[] {
  const problems: GraphProblem[] = []
  const inputs = opts.inputs ?? []
  const maps = (opts.maps ?? []).map(stripBrackets)

  const chains = filter
    .split(';')
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .map(parseChain)

  if (chains.length === 0) {
    problems.push({ severity: 'error', code: 'E_EMPTY', message: 'フィルタグラフが空です' })
    return problems
  }

  // ---- ラベルの定義（出力）を数える ----
  const defineCount = new Map<string, number>()
  for (const c of chains) {
    for (const o of c.outs) {
      if (o === '') {
        problems.push({
          severity: 'error',
          code: 'E_EMPTY_LABEL',
          message: '空のラベル [] が出力に使われています',
          chain: trim(c.raw)
        })
        continue
      }
      defineCount.set(o, (defineCount.get(o) ?? 0) + 1)
    }
  }
  for (const [label, n] of defineCount) {
    if (n > 1) {
      problems.push({
        severity: 'error',
        code: 'E_DUP_DEFINE',
        message: `ラベル [${label}] が ${n} 回定義されています（同じ名前へ2回出力している）`
      })
    }
  }

  // ---- 参照（入力）を検証しつつ消費回数を数える ----
  const consumeCount = new Map<string, number>()
  for (const c of chains) {
    for (const label of c.ins) {
      if (label === '') {
        problems.push({
          severity: 'error',
          code: 'E_EMPTY_LABEL',
          message: '空のラベル [] が入力に使われています',
          chain: trim(c.raw)
        })
        continue
      }
      const ref = parseInputRef(label)
      if (ref) {
        // 入力ファイルへの参照
        const inp = inputs[ref.idx]
        if (ref.optional) continue // '?' 付きは無くてもよい指定
        if (!inp) {
          problems.push({
            severity: 'error',
            code: 'E_INPUT_RANGE',
            message: `[${label}] は存在しない入力 ${ref.idx} を指しています（入力は ${inputs.length} 個）`,
            chain: trim(c.raw)
          })
        } else if (ref.kind === 'a' && !inp.hasAudio) {
          problems.push({
            severity: 'error',
            code: 'E_NO_AUDIO',
            message: `[${label}] を参照していますが、入力 ${ref.idx}${inp.name ? `（${inp.name}）` : ''} に音声ストリームがありません`,
            chain: trim(c.raw)
          })
        } else if (ref.kind === 'v' && !inp.hasVideo) {
          problems.push({
            severity: 'error',
            code: 'E_NO_VIDEO',
            message: `[${label}] を参照していますが、入力 ${ref.idx}${inp.name ? `（${inp.name}）` : ''} に映像ストリームがありません`,
            chain: trim(c.raw)
          })
        }
        // 入力パッドも1回しか消費できない（複数クリップで同じ素材を使うときは
        // split/asplit で分ける必要がある）。ここも重複を数える。
        consumeCount.set(label, (consumeCount.get(label) ?? 0) + 1)
        continue
      }
      if (!defineCount.has(label)) {
        problems.push({
          severity: 'error',
          code: 'E_UNDEFINED_LABEL',
          message: `[${label}] はどこでも定義されていません（綴り間違いか、定義する行が条件分岐で飛ばされている）`,
          chain: trim(c.raw)
        })
      }
      consumeCount.set(label, (consumeCount.get(label) ?? 0) + 1)
    }
  }

  // ---- 1つのラベルを2回消費していないか（split/asplit で分岐すべき箇所） ----
  for (const [label, n] of consumeCount) {
    if (n > 1) {
      problems.push({
        severity: 'error',
        code: 'E_MULTI_CONSUME',
        message: `[${label}] を ${n} 回使っています。ffmpeg のラベルは1回しか消費できません（split / asplit で分岐すること）`
      })
    }
  }

  // ---- -map の対象が存在するか ----
  for (const m of maps) {
    const ref = parseInputRef(m)
    if (ref) {
      // '0:a?' のように '?' 付きは存在しなくても構わない
      if (!ref.optional && !inputs[ref.idx]) {
        problems.push({
          severity: 'error',
          code: 'E_MAP_MISSING',
          message: `-map ${m} は存在しない入力を指しています`
        })
      }
      continue
    }
    if (!defineCount.has(m)) {
      problems.push({
        severity: 'error',
        code: 'E_MAP_MISSING',
        message: `-map [${m}] の対象がグラフ内で定義されていません`
      })
    }
  }

  // ---- 定義したのに誰も使っていないラベル ----
  // 今日の「音声ミックスが条件分岐の内側にあって落ちた」型のバグがここに出る。
  for (const label of defineCount.keys()) {
    if ((consumeCount.get(label) ?? 0) === 0 && !maps.includes(label)) {
      problems.push({
        severity: 'warning',
        code: 'W_UNUSED_LABEL',
        message: `[${label}] を作っていますが誰も使っていません（この出力は捨てられます）`
      })
    }
  }

  return problems
}

/** error が1つでもあるか */
export function hasGraphError(problems: readonly GraphProblem[]): boolean {
  return problems.some((p) => p.severity === 'error')
}

/** ログや例外メッセージ用に整形する */
export function formatGraphProblems(problems: readonly GraphProblem[]): string {
  return problems
    .map((p) => {
      const tag = p.severity === 'error' ? 'エラー' : '警告'
      return `[${tag}/${p.code}] ${p.message}${p.chain ? `\n    → ${p.chain}` : ''}`
    })
    .join('\n')
}
