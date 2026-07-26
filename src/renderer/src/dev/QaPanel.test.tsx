// @vitest-environment jsdom
// ============================================================================
// 検査票の操作テスト
//
// 「2件目以降、修正内容が編集できない」という報告を受けて書いた。
// 目で見て分かる不具合でも、原因が操作の連鎖にある場合は再現テストが要る。
// ============================================================================
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import QaPanel from './QaPanel'

// act() の警告を消す（React にテスト環境だと伝える）
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function mount(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<QaPanel onClose={() => {}} />)
  })
}

async function click(el: Element | null | undefined): Promise<void> {
  if (!el) throw new Error('要素が見つかりません')
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/** React の制御下にある textarea に文字を入れる */
async function type(el: HTMLTextAreaElement, text: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  )?.set
  await act(async () => {
    setter?.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const rows = (): HTMLElement[] => Array.from(container.querySelectorAll('.qa-row'))
const noteOf = (row: HTMLElement): HTMLTextAreaElement | null =>
  row.querySelector('.qa-note')
const ngBtnOf = (row: HTMLElement): Element | null => row.querySelector('.qa-ng')
const commitBtnOf = (row: HTMLElement): Element | null =>
  row.querySelector('.qa-commit:not(.is-done) button')

beforeEach(() => {
  localStorage.clear()
})
afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  localStorage.clear()
})

describe('NG の記入', () => {
  it('1件目: ✕ → 記入 → 完了 で「直すもの」に入る', async () => {
    await mount()
    await click(ngBtnOf(rows()[0]))

    const ta = noteOf(rows()[0])
    expect(ta, '✕ を押したら記入欄が出るはず').toBeTruthy()
    await type(ta!, '止まらずにテロップごと消えた')
    expect(noteOf(rows()[0])!.value).toBe('止まらずにテロップごと消えた')

    await click(commitBtnOf(rows()[0]))
    expect(container.querySelector('.qa-nglist'), '直すものリストが出るはず').toBeTruthy()
  })

  it('2件目以降も記入できる（報告された不具合の再現）', async () => {
    await mount()

    // 1件目を記入して完了
    await click(ngBtnOf(rows()[0]))
    await type(noteOf(rows()[0])!, 'ひとつめの症状')
    await click(commitBtnOf(rows()[0]))

    // 消える演出のぶん待つ
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400))
    })

    // 2件目に ✕ を付ける
    const r2 = rows()[0] // 1件目が消えたので先頭が次の項目
    await click(ngBtnOf(r2))
    const ta2 = noteOf(rows()[0])
    expect(ta2, '2件目でも記入欄が出るはず').toBeTruthy()

    await type(ta2!, 'ふたつめの症状')
    expect(noteOf(rows()[0])!.value, '2件目も編集できるはず').toBe('ふたつめの症状')

    // さらに3件目
    await click(commitBtnOf(rows()[0]))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400))
    })
    await click(ngBtnOf(rows()[0]))
    await type(noteOf(rows()[0])!, 'みっつめの症状')
    expect(noteOf(rows()[0])!.value, '3件目も編集できるはず').toBe('みっつめの症状')
  })

  it('書き直すと記入欄が戻り、続きを書ける', async () => {
    await mount()
    await click(ngBtnOf(rows()[0]))
    await type(noteOf(rows()[0])!, '最初のメモ')
    await click(commitBtnOf(rows()[0]))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400))
    })

    // 「直すもの」から書き直す
    const back = container.querySelector('.qa-nglist .qa-done-row button')
    await click(back)

    const row = rows().find((x) => noteOf(x))
    expect(row, '書き直すと一覧に戻るはず').toBeTruthy()
    expect(noteOf(row!)!.value, '書いた内容が残っているはず').toBe('最初のメモ')
    await type(noteOf(row!)!, '最初のメモ + 追記')
    expect(noteOf(rows().find((x) => noteOf(x))!)!.value).toBe('最初のメモ + 追記')
  })
})

describe('OK の消し込み', () => {
  it('✓ は1クリックで確定して完了リストに入る', async () => {
    await mount()
    const first = rows()[0].textContent ?? ''
    await click(rows()[0].querySelector('.qa-ok'))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400))
    })
    const doneHead = container.querySelector('.qa-done:not(.qa-nglist) .qa-done-head')
    expect(doneHead, '完了リストが出るはず').toBeTruthy()
    expect(rows()[0].textContent, '先頭が次の項目に入れ替わるはず').not.toBe(first)
  })
})
