import { describe, it, expect } from 'vitest'
import {
  zoomAt,
  zoomPanChain,
  zoompanFilter,
  hasClipMotion,
  sanitizeClipMotion,
  clipMotionKeyTimes,
  zoomOffsetForAnchor,
  anchorOfZoom,
  CENTER_ANCHOR,
  NEUTRAL_ZOOM,
  type ClipMotion,
  type Zoom
} from './clipMotion'

const Z: Zoom = { scale: 1.5, x: 0.1, y: -0.2 }

describe('その時刻の zoom', () => {
  // **ここが一番大事**: 印を1つも打っていないクリップは、今までと1ミリも
  // 変わってはいけない。動きを足したせいで既存のプロジェクトの見た目が
  // 変わったら、それは不具合。
  it('印が無ければ、いまの固定値をそのまま返す', () => {
    expect(zoomAt(Z, undefined, 0)).toEqual(Z)
    expect(zoomAt(Z, {}, 3)).toEqual(Z)
    expect(zoomAt(Z, { sc: [] }, 3)).toEqual(Z)
    expect(zoomAt(undefined, undefined, 3)).toEqual(NEUTRAL_ZOOM)
  })

  it('印が1つなら、ずっとその値', () => {
    const m: ClipMotion = { sc: [{ t: 1, v: 2 }] }
    expect(zoomAt(Z, m, 0).scale).toBe(2)
    expect(zoomAt(Z, m, 99).scale).toBe(2)
  })

  it('間はまっすぐつながる（0.5秒で1倍→2倍なら、0.25秒で1.5倍）', () => {
    const m: ClipMotion = {
      sc: [
        { t: 0, v: 1 },
        { t: 0.5, v: 2 }
      ]
    }
    expect(zoomAt(Z, m, 0).scale).toBe(1)
    expect(zoomAt(Z, m, 0.25).scale).toBe(1.5)
    expect(zoomAt(Z, m, 0.5).scale).toBe(2)
  })

  it('打っていない項目は、その項目の固定値のまま（拡大だけ動かしても位置は動かない）', () => {
    const m: ClipMotion = {
      sc: [
        { t: 0, v: 1 },
        { t: 1, v: 2 }
      ]
    }
    const at = zoomAt(Z, m, 0.5)
    expect(at.scale).toBe(1.5)
    expect(at.x).toBe(Z.x)
    expect(at.y).toBe(Z.y)
  })

  it('位置だけ打てば、拡大は固定値のまま', () => {
    const m: ClipMotion = {
      x: [
        { t: 0, v: 0 },
        { t: 2, v: 0.4 }
      ]
    }
    const at = zoomAt(Z, m, 1)
    expect(at.x).toBeCloseTo(0.2, 6)
    expect(at.scale).toBe(Z.scale)
  })

  // 1未満（引く）は zoompan で焼けない。**画面だけ引けてしまうと書き出しとズレる**ので、
  // 計算の側で止める（UI で防ぐだけにしない）。
  it('拡大の印が1未満でも、1で止まる', () => {
    const m: ClipMotion = {
      sc: [
        { t: 0, v: 1 },
        { t: 2, v: 0.2 }
      ]
    }
    expect(zoomAt(Z, m, 2).scale).toBe(1)
    expect(zoomAt(Z, m, 1).scale).toBe(1)
  })

  it('動きを付けていなければ、固定の zoom は 1未満のままでよい（従来どおり引ける）', () => {
    expect(zoomAt({ scale: 0.5, x: 0, y: 0 }, undefined, 0).scale).toBe(0.5)
    expect(zoomAt({ scale: 0.5, x: 0, y: 0 }, {}, 0).scale).toBe(0.5)
  })

  // 位置だけ動かしたいときでも、焼くのは zoompan（1倍以上しか扱えない）。
  // **画面だけ 0.5倍のままにすると、書き出しでだけ大きくなる。**
  // どちらかがズレるくらいなら、画面を書き出しに合わせる。
  it('動きが1つでも付いたら、引いていた（1未満）拡大は1に上がる', () => {
    const m: ClipMotion = {
      x: [
        { t: 0, v: 0 },
        { t: 1, v: 0.2 }
      ]
    }
    expect(zoomAt({ scale: 0.5, x: 0, y: 0 }, m, 1).scale).toBe(1)
  })
})

describe('動きが付いているか', () => {
  it('印が1つでもあれば付いている', () => {
    expect(hasClipMotion(undefined)).toBe(false)
    expect(hasClipMotion({})).toBe(false)
    expect(hasClipMotion({ sc: [] })).toBe(false)
    expect(hasClipMotion({ sc: [{ t: 0, v: 1 }] })).toBe(true)
    expect(hasClipMotion({ y: [{ t: 0, v: 0 }] })).toBe(true)
  })
})

describe('保存ファイルから読み直すときの検査', () => {
  it('形が違う物は「動き無し」に落ちる（落ちない）', () => {
    expect(sanitizeClipMotion(undefined)).toBeUndefined()
    expect(sanitizeClipMotion('x')).toBeUndefined()
    expect(sanitizeClipMotion({ sc: 'no' })).toBeUndefined()
    expect(sanitizeClipMotion({ sc: [{ t: 'a', v: 1 }] })).toBeUndefined()
  })

  it('拡大の1未満は 1 に直す（手で書き換えられても、打てない値は残さない）', () => {
    const m = sanitizeClipMotion({
      sc: [
        { t: 0, v: 0.3 },
        { t: 1, v: 2 }
      ]
    })
    expect(m?.sc?.map((k) => k.v)).toEqual([1, 2])
  })

  it('時刻の順に並べ直す', () => {
    const m = sanitizeClipMotion({
      x: [
        { t: 2, v: 0.2 },
        { t: 0, v: 0 }
      ]
    })
    expect(m?.x?.map((k) => k.t)).toEqual([0, 2])
  })
})

describe('書き出しの zoompan', () => {
  const W = 1920
  const H = 1080
  const FPS = 30

  /** zoompan に渡した式から、値を取り出す（z='…' の中身） */
  const optOf = (f: string, name: 'z' | 'x' | 'y'): string =>
    new RegExp(`:?${name}='([^']*)'`).exec(f)![1]

  /**
   * ffmpeg の式を、この場で評価する。
   * **式が本当にプレビューと同じ折れ線になっているかは、評価しないと分からない。**
   * 見た目が似ている式を書いて安心してしまうのが、一番ありがちな取りこぼし。
   */
  const evalExpr = (expr: string, vars: Record<string, number>): number => {
    const js = expr
      .replace(/\bif\(/g, 'IF(')
      .replace(/\blt\(/g, 'LT(')
      .replace(/\bmax\(/g, 'MAX(')
    const names = Object.keys(vars)
    // eslint-disable-next-line no-new-func
    return new Function(
      'IF',
      'LT',
      'MAX',
      ...names,
      `return ${js}`
    )(
      (c: boolean, a: number, b: number) => (c ? a : b),
      (a: number, b: number) => a < b,
      Math.max,
      ...names.map((n) => vars[n])
    )
  }

  const args = { width: W, height: H, timeExpr: 'T', fpsArg: '30', frames: 1 }

  /**
   * zoompan に入る絵の大きさ。**台紙を広げていれば W×H ではない。**
   * 式の中の iw/ih はこちらを指すので、評価するときは必ずこれを渡す。
   */
  const inSizeOf = (f: string): { iw: number; ih: number } => {
    const m = f.match(/^pad=(\d+):(\d+):/)
    return m ? { iw: Number(m[1]), ih: Number(m[2]) } : { iw: W, ih: H }
  }

  it('大きさと出す枚数を必ず書く（既定のままだと 720p・25fps に化ける）', () => {
    const f = zoompanFilter({ scale: 1, x: 0, y: 0 }, { sc: [{ t: 0, v: 2 }] }, args)
    expect(f).toContain(`:s=${W}x${H}`)
    expect(f).toContain(':fps=30')
    expect(f).toContain(':d=1')
  })

  it('静止画は「尺×fps」枚に増やす（1枚のままだと動かない）', () => {
    const f = zoompanFilter(undefined, { sc: [{ t: 0, v: 2 }] }, { ...args, frames: 4 * FPS })
    expect(f).toContain(':d=120')
  })

  // ここが本番。プレビュー（zoomAt）と書き出し（式）が同じ絵になることを、
  // 0.1秒刻みで全部見る。ダッキングで同じ形の確認を入れてある。
  it('拡大の式が、プレビューの折れ線と一致する', () => {
    const m: ClipMotion = {
      sc: [
        { t: 0, v: 1 },
        { t: 1, v: 2, e: 'ease' },
        { t: 2, v: 1.5, e: 'hold' },
        { t: 3, v: 3 }
      ]
    }
    const z = optOf(zoompanFilter({ scale: 1, x: 0, y: 0 }, m, args), 'z')
    for (let t = 0; t <= 3.5; t += 0.1) {
      expect(evalExpr(z, { T: t })).toBeCloseTo(zoomAt({ scale: 1, x: 0, y: 0 }, m, t).scale, 3)
    }
  })

  // 位置は「切り出す窓の左上」で渡す。**いまの固定値の焼き方と同じ窓になる**ことを、
  // 式を評価して確かめる（座標の取り違えは、焼き上がるまで気づけない）。
  it('位置の式が、いままでの切り出し窓と同じ場所を指す', () => {
    const zoom: Zoom = { scale: 2, x: 0.1, y: -0.2 }
    const f = zoompanFilter(zoom, { sc: [{ t: 0, v: 2 }] }, args)
    const s = zoom.scale
    // 従来: scale=W*s:H*s のあと crop=W:H:(iw-W)/2-x*W:(ih-H)/2-y*H
    // それを元の絵の座標に直したもの（＝zoompan の x/y が指すべき場所）
    const wantX = ((W * s - W) / 2 - zoom.x * W) / s
    const wantY = ((H * s - H) / 2 - zoom.y * H) / s
    expect(evalExpr(optOf(f, 'x'), { T: 0, iw: W, ih: H, zoom: s })).toBeCloseTo(wantX, 3)
    expect(evalExpr(optOf(f, 'y'), { T: 0, iw: W, ih: H, zoom: s })).toBeCloseTo(wantY, 3)
  })

  it('位置に印を打つと、その時刻ごとに窓が動く', () => {
    const m: ClipMotion = {
      x: [
        { t: 0, v: 0 },
        { t: 2, v: 0.25 }
      ]
    }
    const zoom: Zoom = { scale: 2, x: 0, y: 0 }
    const x = optOf(zoompanFilter(zoom, m, args), 'x')
    for (const t of [0, 0.5, 1, 1.5, 2, 3]) {
      const at = zoomAt(zoom, m, t)
      const want = ((W * at.scale - W) / 2 - at.x * W) / at.scale
      expect(evalExpr(x, { T: t, iw: W, ih: H, zoom: at.scale })).toBeCloseTo(want, 3)
    }
  })

  // 台紙を広げると z の数字そのものは 1 を越える（広げたぶんの倍率が乗る）。
  // 見た目が 1倍かどうかは「窓の幅が画面1枚ぶんか」で見る。
  it('1倍未満は1で止まる（画面と同じ。窓が画面1枚ぶんになる）', () => {
    const f = zoompanFilter({ scale: 0.4, x: 0, y: 0 }, { x: [{ t: 0, v: 0.1 }] }, args)
    const { iw } = inSizeOf(f)
    const z = evalExpr(optOf(f, 'z'), { T: 0 })
    // 倍率は式に書ける桁で丸めるので、1画素より細かい差は出る。それは見えない
    expect(iw / z).toBeCloseTo(W, 1)
  })

  it('式にカンマが入るので、必ず引用符で囲む（フィルタの区切りと混ざる）', () => {
    const f = zoompanFilter(
      { scale: 1, x: 0, y: 0 },
      {
        sc: [
          { t: 0, v: 1 },
          { t: 1, v: 2 }
        ]
      },
      args
    )
    expect(optOf(f, 'z')).toContain(',') // 式の中にカンマがある
    expect(f).toMatch(/z='[^']*'/) // それが引用符の中に収まっている
  })
})

describe('打たれている印の時刻', () => {
  it('項目をまたいで重複なく集める', () => {
    const m: ClipMotion = {
      sc: [
        { t: 0, v: 1 },
        { t: 2, v: 2 }
      ],
      x: [
        { t: 0, v: 0 },
        { t: 1, v: 0.1 }
      ]
    }
    expect(clipMotionKeyTimes(m)).toEqual([0, 1, 2])
    expect(clipMotionKeyTimes(undefined)).toEqual([])
  })
})

// ============================================================================
// 拡大＋移動の焼き方（「書き出すと画像がデフォ位置に戻る」の再発防止）
// ============================================================================
//
// 実際に出た不具合: **拡大していないと X/Y が書き出しに効かない。**
// 前は「大きくした絵のどこを切り抜くか」で移動を表していて、等倍では
// 切り抜く余地がゼロ＝位置が 0 に丸められていた。動き（zoompan）側も同じ。
//
// ここでは組み立てたフィルタ列をそのまま読み直し、**出力の画素が元画像の
// どこを指すか**を計算して、画面（CSS の translate+scale）と一致するか見る。
// 「それらしい式」を書いて安心してしまうのが一番ありがちな取りこぼしなので、
// 文字列の形ではなく、行き着く先の座標で確かめる。
describe('拡大＋移動の焼き方', () => {
  const W = 1920
  const H = 1080

  /**
   * scale→pad→crop の列を読んで、出力(u,v) が指す**元画像の座標**を返す。
   * 元画像の外（台紙の余白）なら null。
   */
  function srcAt(chain: string, u: number, v: number): { x: number; y: number } | null {
    const sc = chain.match(/scale=(\d+):(\d+)/)
    const pd = chain.match(/pad=(\d+):(\d+):(-?\d+):(-?\d+)/)
    const cp = chain.match(/crop=(\d+):(\d+):(-?\d+):(-?\d+)/)
    // 素通しになる pad / crop は書かれない（無駄に絵をもう1枚確保しないため）。
    // 書かれていなければ「ずらさない」と同じ意味。
    if (!sc) throw new Error('見たことのない列: ' + chain)
    const [zw, zh] = [Number(sc[1]), Number(sc[2])]
    const [px, py] = pd ? [Number(pd[3]), Number(pd[4])] : [0, 0]
    const [cx, cy] = cp ? [Number(cp[3]), Number(cp[4])] : [0, 0]
    // 出力 → 台紙 → 拡大後の絵
    const ax = cx + u - px
    const ay = cy + v - py
    if (ax < 0 || ay < 0 || ax >= zw || ay >= zh) return null
    // 拡大後の絵 → 元画像
    return { x: (ax * W) / zw, y: (ay * H) / zh }
  }

  /** 画面側（CSS: translate(x%,y%) scale(s)、原点は中心）の同じ計算 */
  function srcAtCss(z: Zoom, u: number, v: number): { x: number; y: number } | null {
    const s = z.scale
    const ox = (W - W * s) / 2 + z.x * W
    const oy = (H - H * s) / 2 + z.y * H
    const x = (u - ox) / s
    const y = (v - oy) / s
    if (x < 0 || y < 0 || x >= W || y >= H) return null
    return { x, y }
  }

  const cases: Zoom[] = [
    { scale: 1, x: 0, y: 0 }, // 何もしていない
    { scale: 1, x: 0.25, y: 0 }, // **等倍で右へ**（これが効かなかった）
    { scale: 1, x: -0.3, y: 0.2 }, // 等倍で左上へ
    { scale: 1.5, x: 0.1, y: -0.2 }, // 寄せながら動かす
    { scale: 0.6, x: 0.2, y: 0.1 }, // 引きながら動かす
    { scale: 1, x: 0.9, y: 0 } // ほとんど画面の外
  ]

  it('画面（CSS）と同じ場所を指す', () => {
    for (const z of cases) {
      const chain = zoomPanChain(W, H, z, 'black@0')
      for (const u of [0, 1, 480, 960, 1439, 1919]) {
        for (const v of [0, 540, 1079]) {
          const got = srcAt(chain, u, v)
          const want = srcAtCss(z, u, v)
          const label = `z=${JSON.stringify(z)} 出力(${u},${v})`
          if (want === null) {
            // 絵から外れた所は透明（下の映像が見える）
            expect({ label, got }).toEqual({ label, got: null })
          } else {
            expect(got).not.toBeNull()
            // 拡大後の大きさを整数へ丸めるぶんは、1画素まで許す
            expect({ label, x: Math.abs(got!.x - want.x) < 1.5 }).toEqual({ label, x: true })
            expect({ label, y: Math.abs(got!.y - want.y) < 1.5 }).toEqual({ label, y: true })
          }
        }
      }
    }
  })

  it('等倍のままでも動く（前はここが動かなかった）', () => {
    const still = zoomPanChain(W, H, { scale: 1, x: 0, y: 0 }, 'black@0')
    const moved = zoomPanChain(W, H, { scale: 1, x: 0.25, y: 0 }, 'black@0')
    // 出力の真ん中が指す元画像の位置が、ちょうど 0.25 枚ぶん左へずれる
    expect(srcAt(still, 960, 540)!.x).toBeCloseTo(960, 0)
    expect(srcAt(moved, 960, 540)!.x).toBeCloseTo(960 - 0.25 * W, 0)
  })

  // 素通しの pad / crop でも ffmpeg はその大きさの絵をもう1枚確保して写す。
  // 寄りの強い切片は中間の絵が 4000×7000 級になるので、素通し1つで消費が倍になる。
  it('素通しになる pad / crop は書かない（無駄に絵を確保しない）', () => {
    expect(zoomPanChain(W, H, { scale: 1, x: 0, y: 0 }, 'black@0')).toBe(
      'scale=1920:1080,setsar=1'
    )
    // 寄るだけ（動かさない）なら、今までどおり scale→crop の2つで済む
    expect(zoomPanChain(W, H, { scale: 2, x: 0, y: 0 }, 'black@0')).toBe(
      'scale=3840:2160,crop=1920:1080:960:540,setsar=1'
    )
    // 動かすときだけ台紙を広げる
    expect(zoomPanChain(W, H, { scale: 1, x: 0.25, y: 0 }, 'black@0')).toContain('pad=')
  })

  // 動き側。台紙は「動かすのに足りるぶんだけ」広げる。
  it('動きも、位置の印だけで（拡大せずに）動く', () => {
    const m: ClipMotion = {
      x: [
        { t: 0, v: 0 },
        { t: 2, v: 0.25 }
      ]
    }
    const f = zoompanFilter({ scale: 1, x: 0, y: 0 }, m, {
      width: W,
      height: H,
      timeExpr: 'T',
      fpsArg: '30',
      frames: 1
    })
    const pd = f.match(/^pad=(\d+):(\d+):(\d+):(\d+)/)
    expect(pd).not.toBeNull() // 広げていなければ、そもそも動けない
    const iw = Number(pd![1])
    // ffmpeg の式をその場で評価する（if/lt/max だけ差し替える）
    const ev = (expr: string, vars: Record<string, number>): number => {
      const js = expr
        .replace(/\bif\(/g, 'IF(')
        .replace(/\blt\(/g, 'LT(')
        .replace(/\bmax\(/g, 'MAX(')
      const names = Object.keys(vars)
      // eslint-disable-next-line no-new-func
      return new Function('IF', 'LT', 'MAX', ...names, `return ${js}`)(
        (c: boolean, a: number, b: number) => (c ? a : b),
        (a: number, b: number) => a < b,
        Math.max,
        ...names.map((n) => vars[n])
      )
    }
    const zAt = (t: number): number => ev(f.match(/z='([^']+)'/)![1], { T: t })
    const xAt = (t: number): number =>
      ev(f.match(/x='([^']+)'/)![1], { T: t, iw, zoom: zAt(t) })
    // 窓の幅は画面1枚ぶんのまま（拡大していない）
    expect(iw / zAt(0)).toBeCloseTo(W, 1)
    // 窓の左端が、0秒 → 2秒 で 0.25枚ぶん左へ動く（＝絵は右へ動く）
    expect(xAt(2) - xAt(0)).toBeCloseTo(-0.25 * W, 0)
  })

  it('動かす必要が無ければ台紙は広げない（今までどおりの重さ）', () => {
    const f = zoompanFilter({ scale: 1, x: 0, y: 0 }, { sc: [{ t: 0, v: 2 }] }, {
      width: W,
      height: H,
      timeExpr: 'T',
      fpsArg: '30',
      frames: 1
    })
    expect(f.startsWith('zoompan=')).toBe(true)
  })

  // 拡大の基準点。**画面だけの道具**なので、書き出し側には x/y しか渡らない。
  // だから確かめるべきは「x/y に直したあと、書き出しの列で本当にその点が
  // 止まっているか」であって、式そのものではない。
  // 上の srcAt（組み立てた列を読み直す）をそのまま使って見る。
  it('基準点は、寄っても同じ画素に居座る（書き出しの列で確かめる）', () => {
    for (const a of [
      { x: 0.5, y: 0.5 }, // 真ん中（今までと同じ＝x/y は動かない）
      { x: 0.25, y: 0.75 },
      { x: 0, y: 0 }, // 左上の角
      { x: 1, y: 1 } // 右下の角
    ]) {
      for (const s of [1.2, 2, 4]) {
        const off = zoomOffsetForAnchor(a, s)
        const chain = zoomPanChain(W, H, { scale: s, ...off }, 'black@0')
        // 基準点の画素は、寄る前も後も同じ元画像の点を指す
        const u = Math.min(W - 1, Math.round(a.x * W))
        const v = Math.min(H - 1, Math.round(a.y * H))
        const got = srcAt(chain, u, v)
        const label = `基準点=${JSON.stringify(a)} 拡大=${s}`
        expect(got).not.toBeNull()
        expect({ label, x: Math.abs(got!.x - u) < 1.5 }).toEqual({ label, x: true })
        expect({ label, y: Math.abs(got!.y - v) < 1.5 }).toEqual({ label, y: true })
      }
    }
  })

  it('真ん中を基準にすると、今までと1ミリも変わらない', () => {
    expect(zoomOffsetForAnchor(CENTER_ANCHOR, 3)).toEqual({ x: 0, y: 0 })
  })

  it('等倍では、どこを基準にしても絵は動かない', () => {
    const off = zoomOffsetForAnchor({ x: 0, y: 1 }, 1)
    expect(off.x).toBeCloseTo(0, 12)
    expect(off.y).toBeCloseTo(0, 12)
    // 逆に取るときも、等倍からは基準点を復元できない（真ん中を返す）
    expect(anchorOfZoom({ scale: 1, x: 0, y: 0 })).toEqual(CENTER_ANCHOR)
  })

  it('いまの zoom から基準点を取り出せる（マーカーを出すときの初期位置）', () => {
    for (const a of [{ x: 0.25, y: 0.75 }, { x: 0, y: 0 }, { x: 1, y: 0.5 }]) {
      for (const s of [1.2, 2, 4]) {
        const got = anchorOfZoom({ scale: s, ...zoomOffsetForAnchor(a, s) })
        expect(got.x).toBeCloseTo(a.x, 6)
        expect(got.y).toBeCloseTo(a.y, 6)
      }
    }
  })
})
