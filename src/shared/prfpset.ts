// Premiere のエフェクトプリセット（.prfpset）を読む。
//
// ## 何のためか
//
// 向こうで作られた動きを、GiftCut に**そのまま写し取る**ため。
// 手で打ち直すと数が多すぎるし、微妙な速度の付け方まで真似られない。
//
// ## 形（実物を読んで確かめたもの）
//
// XML だが、素直な入れ子ではなく **ID で参照し合う**形になっている。
//
//     <PremiereData Version="3">
//       <Tree ObjectRef="1"/>              ← 入口
//       <FilterPreset ObjectID="9" …>      ← 実体はトップレベルに並ぶ
//
// 動きは `IsTimeVarying=true` の項目が持っていて、中身はこの並び:
//
//     <Keyframes>時刻,値,?,?,入りの速度,入りの影響,出の速度,出の影響; …</Keyframes>
//
// - 時刻は**刻み**（1秒 = 254016000000）。しかも 3600秒（1時間）から始まる
//   のが Premiere の慣習なので、**先頭を 0 に寄せて使う**
// - 値は数値か、点なら `x:y`
// - 速度は「値/秒」、影響は区間に対する割合（既定 1/6 か 1/3）
// - **速度が直線の傾きと同じなら直線**（実物の6割がこれ）
//
// ## なぜ自前で読むか
//
// XML の部品を足すほどの物ではない（機械が吐いた形が決まっているので、
// タグを拾えば足りる）。**素材そのものは配布物にもリポジトリにも入れない**ので、
// テストはここで自分で書いた小さな XML で回す。

import type { BezierKey, Tangent } from './bezierKeys'

/** Premiere の時刻の刻み（1秒あたり） */
export const PR_TICKS_PER_SEC = 254016000000

export interface PrParam {
  /** 向こうでの名前（位置・スケール・不透明度 など） */
  name: string
  /** 動きが付いていないときの値。点なら [x, y] */
  value: number[]
  /** 動き。時刻はプリセットの先頭を0にそろえてある（秒） */
  keys: BezierKey[][]
}

export interface PrEffect {
  /** AE.ADBE Motion / AE.ADBE Opacity など */
  matchName: string
  params: PrParam[]
}

/** ひとつのプリセット（＝ひとつのテロップ演出） */
export interface PrPreset {
  name: string
  effects: PrEffect[]
}

/**
 * XML の実体参照を戻す。
 *
 * **入れないと画面にそのまま出る。** 実物には
 *   25.飛び込み+ブラー&#13;カラーバランス      ← 名前の改行
 *   AE.ADBE Brightness &amp; Contrast 2      ← エフェクト名の &
 * が入っていて、前者は一覧に化けたまま並び、後者は名前の突き合わせが外れる。
 * `&amp;` は最後に戻す（先に戻すと `&amp;lt;` が `<` になってしまう）。
 */
function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)
  return m ? decodeXml(m[1]) : null
}

/** `1.40625:0.5` や `100` を数の配列にする */
function parseValue(s: string): number[] {
  return s
    .split(':')
    .map((x) => parseFloat(x))
    .filter((x) => Number.isFinite(x))
}

/**
 * Keyframes の1行を読む。
 * フィールド数は項目の型で変わる（数値=8・点=14）が、**先頭2つと接線の位置は同じ**。
 */
function parseKeyframes(raw: string): BezierKey[][] {
  const rows = raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!rows.length) return []
  const parsed = rows.map((r) => {
    const f = r.split(',')
    return {
      tick: Number(f[0]),
      value: parseValue(f[1] ?? ''),
      inSpeed: parseFloat(f[4]),
      inInf: parseFloat(f[5]),
      outSpeed: parseFloat(f[6]),
      outInf: parseFloat(f[7])
    }
  })
  const t0 = Math.min(...parsed.map((p) => p.tick))
  const dims = Math.max(1, ...parsed.map((p) => p.value.length))
  // 次元ごとに1本の列にする（位置は x と y で別々の動きとして持つ）
  const out: BezierKey[][] = []
  for (let d = 0; d < dims; d++) {
    out.push(
      parsed
        .filter((p) => Number.isFinite(p.value[d]))
        .map((p) => {
          const k: BezierKey = {
            t: (p.tick - t0) / PR_TICKS_PER_SEC,
            v: p.value[d]
          }
          const ti = tangent(p.inSpeed, p.inInf)
          const to = tangent(p.outSpeed, p.outInf)
          if (ti) k.in = ti
          if (to) k.out = to
          return k
        })
    )
  }
  return out
}

function tangent(speed: number, inf: number): Tangent | undefined {
  if (!Number.isFinite(speed) || !Number.isFinite(inf)) return undefined
  return { speed, influence: Math.min(1, Math.max(0, inf)) }
}

/**
 * .prfpset を読む。**壊れていても落ちない**（読めた分だけ返す）。
 * 人からもらったファイルを開くことがあるので、ここで落ちると原因が分からない。
 */
export function parsePrfpset(xml: string): PrPreset[] {
  // トップレベルに並ぶ実体を、種類ごとに拾う
  const objects = [...xml.matchAll(/<(\w+)\s+ObjectID="(\d+)"[^>]*>([\s\S]*?)<\/\1>/g)].map(
    (m) => ({ kind: m[1], id: m[2], body: m[3] })
  )
  const byId = new Map(objects.map((o) => [o.id, o]))

  const params = (body: string): PrParam[] => {
    const out: PrParam[] = []
    for (const ref of body.matchAll(/<Param\s+Index="\d+"\s+ObjectRef="(\d+)"/g)) {
      const o = byId.get(ref[1])
      if (!o) continue
      const name = tag(o.body, 'Name') ?? ''
      const cur = tag(o.body, 'CurrentValue') ?? ''
      const kf = (tag(o.body, 'IsTimeVarying') ?? '') === 'true' ? tag(o.body, 'Keyframes') : null
      out.push({ name, value: parseValue(cur), keys: kf ? parseKeyframes(kf) : [] })
    }
    return out
  }

  const effects = (body: string): PrEffect[] => {
    const out: PrEffect[] = []
    for (const ref of body.matchAll(/<FilterPreset\s+Index="\d+"\s+ObjectRef="(\d+)"/g)) {
      const fp = byId.get(ref[1])
      if (!fp) continue
      // エフェクトの名前は、隣り合う VideoFilterComponent が持っている
      const compRef = /<Component\s+ObjectRef="(\d+)"/.exec(fp.body)?.[1]
      const comp = compRef ? byId.get(compRef) : undefined
      const matchName =
        (comp && (tag(comp.body, 'MatchName') ?? tag(comp.body, 'FilterMatchName'))) ??
        tag(fp.body, 'MatchName') ??
        '(不明)'
      out.push({ matchName, params: params((comp?.body ?? '') + fp.body) })
    }
    return out
  }

  // 名前は本体ではなく、**それを指している TreeItem** が持っている
  // （`<Data ObjectRef="8"/>` で本体を指し、`<Name>01.SLIDE_R</Name>` が隣にある）
  const nameOf = new Map<string, string>()
  for (const o of objects) {
    if (o.kind !== 'TreeItem') continue
    const ref = /<Data\s+ObjectRef="(\d+)"/.exec(o.body)?.[1]
    // 向こうの名前は2行にできる（「25.飛び込み+ブラー / カラーバランス」）。
    // こちらは一覧に1行で並べるので、改行は空白にして詰める
    const nm = tag(o.body, 'Name')?.replace(/\s*[\r\n]+\s*/g, ' ').trim()
    if (ref && nm) nameOf.set(ref, nm)
  }

  const presets: PrPreset[] = []
  for (const o of objects) {
    if (o.kind !== 'FilterPresetItem') continue
    presets.push({
      name: nameOf.get(o.id) ?? tag(o.body, 'Name') ?? '(名前なし)',
      effects: effects(o.body)
    })
  }
  return presets
}
