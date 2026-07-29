import { describe, it, expect } from 'vitest'
import {
  zoomAt,
  zoompanFilter,
  hasClipMotion,
  sanitizeClipMotion,
  clipMotionKeyTimes,
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

  it('1倍未満は式の側でも1で止まる（画面と同じ）', () => {
    const z = optOf(zoompanFilter({ scale: 0.4, x: 0, y: 0 }, { x: [{ t: 0, v: 0.1 }] }, args), 'z')
    expect(evalExpr(z, { T: 0 })).toBe(1)
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
