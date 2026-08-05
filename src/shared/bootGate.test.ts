// 読み込み係の判断（`bootGate.js`）。
//
// **ここが落ちると、アプリが起動しなくなる。** しかも自動更新で全員に配られるので、
// 気づいたときには全員の手元にある。書き出しの不具合と違って、
// 使う人には手で入れ直す以外の道が無い。
//
// なので**断る側を厚く**見る。通すのは1通りしかないが、断り損ねる形は何通りもある。
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { join } from 'node:path'

// 素の JS（`out/` より先に動くので TypeScript にしていない）をそのまま読む
const req = createRequire(import.meta.url)
const gate = req(join(__dirname, '..', '..', 'bootGate.js')) as {
  compareVersion: (a: string, b: string) => number
  makeFingerprint: (electronVersion: string, format: number) => string
  decide: (o: {
    state: unknown
    entryExists: boolean
    builtInVersion: string
    fingerprint: string
  }) => { use: boolean; discard?: boolean; writeTried?: number; reason: string }
}

const FP = gate.makeFingerprint('31.7.7', 1)

/** 素直に読める形（確認済み・新しい・土台が同じ） */
const ok = {
  state: { version: '0.1.28', fingerprint: FP, verified: true },
  entryExists: true,
  builtInVersion: '0.1.27',
  fingerprint: FP
}

describe('版の比べ方', () => {
  it('**数として比べる**（文字列だと 0.1.9 の方が新しくなる）', () => {
    expect(gate.compareVersion('0.1.27', '0.1.9')).toBe(1)
    expect(gate.compareVersion('0.1.9', '0.1.27')).toBe(-1)
  })

  it('同じなら 0', () => {
    expect(gate.compareVersion('0.1.27', '0.1.27')).toBe(0)
  })

  it('桁数が違っても比べられる', () => {
    expect(gate.compareVersion('1.0', '1.0.0')).toBe(0)
    expect(gate.compareVersion('1.0.1', '1.0')).toBe(1)
  })

  it('壊れた値でも落ちない（読めない＝0 として扱う）', () => {
    expect(gate.compareVersion('', '0.0.0')).toBe(0)
    expect(gate.compareVersion('あ', '0.0.1')).toBe(-1)
  })
})

describe('土台の指紋', () => {
  it('Electron の版が違えば別物', () => {
    expect(gate.makeFingerprint('31.7.7', 1)).not.toBe(gate.makeFingerprint('32.0.0', 1))
  })

  it('**format を上げると、それ以前の差し替えを無効にできる**', () => {
    expect(gate.makeFingerprint('31.7.7', 1)).not.toBe(gate.makeFingerprint('31.7.7', 2))
  })
})

describe('差し替えを読むか', () => {
  it('確認済み・新しい・土台が同じなら読む', () => {
    const d = gate.decide(ok)
    expect(d.use).toBe(true)
    expect(d.discard).toBeFalsy()
  })

  it('差し替えが無ければ同梱（**捨てる物も無い**）', () => {
    const d = gate.decide({ ...ok, state: null })
    expect(d.use).toBe(false)
    expect(d.discard).toBeFalsy()
  })

  it('**土台が違えば読まない。しかもその場で捨てる**（Electron が戻ると生き返るため）', () => {
    const d = gate.decide({
      ...ok,
      state: { ...(ok.state as object), fingerprint: gate.makeFingerprint('32.0.0', 1) }
    })
    expect(d.use).toBe(false)
    expect(d.discard).toBe(true)
  })

  it('**同梱の方が新しければ読まない**（後からインストーラを当てた形）', () => {
    const d = gate.decide({ ...ok, builtInVersion: '0.1.30' })
    expect(d.use).toBe(false)
    expect(d.discard).toBe(true)
  })

  it('同梱と同じ版でも読まない（読む意味が無いうえ、古い方を掴む危険だけ残る）', () => {
    const d = gate.decide({ ...ok, builtInVersion: '0.1.28' })
    expect(d.use).toBe(false)
    expect(d.discard).toBe(true)
  })

  it('中身が無ければ読まない', () => {
    const d = gate.decide({ ...ok, entryExists: false })
    expect(d.use).toBe(false)
    expect(d.discard).toBe(true)
  })

  it('**まだ確かめていない版は1回だけ試す**（試した印を残してから）', () => {
    const d = gate.decide({
      ...ok,
      state: { version: '0.1.28', fingerprint: FP, verified: false, tried: 0 }
    })
    expect(d.use).toBe(true)
    expect(d.writeTried).toBe(1)
  })

  it('**2回目に来たら、前回起動できなかったということ**。捨てて同梱へ', () => {
    const d = gate.decide({
      ...ok,
      state: { version: '0.1.28', fingerprint: FP, verified: false, tried: 1 }
    })
    expect(d.use).toBe(false)
    expect(d.discard).toBe(true)
  })

  it('版が書かれていなければ捨てる（壊れた印を残さない）', () => {
    const d = gate.decide({ ...ok, state: { fingerprint: FP, verified: true } })
    expect(d.use).toBe(false)
    expect(d.discard).toBe(true)
  })

  it('**verified が真っぽいだけの値では通さない**（"true" や 1 を通すと、確認していない版が居座る）', () => {
    for (const v of ['true', 1, {}]) {
      const d = gate.decide({
        ...ok,
        state: { version: '0.1.28', fingerprint: FP, verified: v, tried: 1 }
      })
      expect(d.use).toBe(false)
    }
  })
})
