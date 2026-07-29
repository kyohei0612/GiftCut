import { describe, it, expect } from 'vitest'
import { parsePrfpset, PR_TICKS_PER_SEC } from './prfpset'

// **本物の素材はリポジトリに置かない**（再配布が許可されていないため）。
// 形は実物を読んで確かめてあるので、ここでは同じ形の小さな XML を自分で書いて回す。
const T0 = 3600 * PR_TICKS_PER_SEC // Premiere は1時間から始まるのが慣習

const xml = (keyframes: string, cur = '0.5:0.5'): string => `<?xml version="1.0"?>
<PremiereData Version="3">
  <TreeItem ObjectID="7" ClassID="x" Version="4">
    <TreeItemBase Version="4">
      <Data ObjectRef="8"/>
      <Name>01.SLIDE_R</Name>
    </TreeItemBase>
  </TreeItem>
  <FilterPresetItem ObjectID="8" ClassID="x" Version="1">
    <FilterPresets Version="1">
      <FilterPreset Index="0" ObjectRef="9"/>
    </FilterPresets>
  </FilterPresetItem>
  <FilterPreset ObjectID="9" ClassID="x" Version="1">
    <Component ObjectRef="10"/>
  </FilterPreset>
  <VideoFilterComponent ObjectID="10" ClassID="x" Version="1">
    <MatchName>AE.ADBE Motion</MatchName>
    <Params Version="1">
      <Param Index="0" ObjectRef="11"/>
    </Params>
  </VideoFilterComponent>
  <PointComponentParam ObjectID="11" ClassID="x" Version="3">
    <ParameterID>1</ParameterID>
    <CurrentValue>${cur}</CurrentValue>
    <IsTimeVarying>${keyframes ? 'true' : 'false'}</IsTimeVarying>
    <Keyframes>${keyframes}</Keyframes>
    <Name>位置</Name>
  </PointComponentParam>
</PremiereData>`

/** 時刻（秒）→ Premiere の刻み */
const tick = (sec: number): number => Math.round(T0 + sec * PR_TICKS_PER_SEC)

describe('読めること', () => {
  const doc = xml(
    `${tick(0)},1.40625:0.5,5,0,4.78,0.3333,0,0.25;${tick(0.2)},0.5:0.5,5,0,0,0.4985,4.78,0.3333;`
  )
  const ps = parsePrfpset(doc)

  it('プリセットの名前は TreeItem 側にある', () => {
    expect(ps).toHaveLength(1)
    expect(ps[0].name).toBe('01.SLIDE_R')
  })

  it('エフェクトの種類が取れる', () => {
    expect(ps[0].effects).toHaveLength(1)
    expect(ps[0].effects[0].matchName).toBe('AE.ADBE Motion')
    expect(ps[0].effects[0].params[0].name).toBe('位置')
  })

  // **1時間ぶんの下駄を外すのが肝。** 外し忘れると、動きが3600秒後に始まる
  it('時刻は先頭を0にそろえる（Premiere は1時間から始まる）', () => {
    const [x] = ps[0].effects[0].params[0].keys
    expect(x[0].t).toBeCloseTo(0, 6)
    expect(x[1].t).toBeCloseTo(0.2, 4)
  })

  it('点は x と y に分けて持つ', () => {
    const keys = ps[0].effects[0].params[0].keys
    expect(keys).toHaveLength(2) // x と y
    expect(keys[0].map((k) => k.v)).toEqual([1.40625, 0.5])
    expect(keys[1].map((k) => k.v)).toEqual([0.5, 0.5])
  })

  it('接線（速度・影響）が入りと出に分かれて入る', () => {
    const x = ps[0].effects[0].params[0].keys[0]
    expect(x[0].in?.speed).toBeCloseTo(4.78, 3)
    expect(x[0].out?.speed).toBe(0) // 区間の内側は速度0＝ゆっくり始まる
    expect(x[1].in?.speed).toBe(0) // 内側は0＝ゆっくり終わる
    expect(x[1].out?.speed).toBeCloseTo(4.78, 3)
  })

  it('影響は 0〜1 に収める', () => {
    for (const k of ps[0].effects[0].params[0].keys[0]) {
      expect(k.in!.influence).toBeGreaterThanOrEqual(0)
      expect(k.in!.influence).toBeLessThanOrEqual(1)
    }
  })
})

describe('動きが付いていない項目', () => {
  it('固定値だけ持つ', () => {
    const ps = parsePrfpset(xml('', '960:540'))
    const p = ps[0].effects[0].params[0]
    expect(p.keys).toEqual([])
    expect(p.value).toEqual([960, 540])
  })
})

describe('壊れていても落ちない', () => {
  // 人からもらったファイルを開くことがある。ここで落ちると原因が分からない。
  it('空・でたらめ・途中で切れた XML', () => {
    expect(parsePrfpset('')).toEqual([])
    expect(parsePrfpset('<PremiereData>ぐちゃぐちゃ')).toEqual([])
    expect(() => parsePrfpset(xml('こわれた,,,;'))).not.toThrow()
  })

  it('参照先が無いときは、その分を飛ばす', () => {
    const broken = xml(`${tick(0)},1:0.5,5,0,0,0.16,0,0.16;`).replace(
      '<Component ObjectRef="10"/>',
      '<Component ObjectRef="999"/>'
    )
    const ps = parsePrfpset(broken)
    expect(ps).toHaveLength(1)
    expect(ps[0].effects[0].matchName).toBe('(不明)')
  })
})
