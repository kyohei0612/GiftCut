# 引き継ぎ：App.tsx を割る

最終更新 2026-08-01。**11,404 → 4,721行**。

---

## 数え方を間違えないこと（この作業の要点）

**「大きい関数を1個ずつ」で数えると桁を見誤る。**

一度そう数えて「切り出せるのは 1,200〜1,500行」と見積もったが、
**話題ごとにまとめて**数え直したら、166個の関数が13の話題に1個残らず収まり、
実際には 2,100行以上出た。

理由は、話題の中どうしの呼び合いが「渡す物」から消えるから。
`cutAtPlayhead` を単体で出すと切片・選択・履歴・磁石…と数十個要るが、
**編集25個をまとめて出せば27個**で済む。

---

## いまの中身（4,721行）

| 行 | 何 | 出せるか |
|---|---|---|
| 315 | import と型 | — |
| 116 | App の外（定数・小さな部品） | — |
| 約2,250 | state / ref の宣言、心臓からの受け取り、残りの小さな関数 | 心臓へ移さないと出せない分が多い |
| 317 | `useEffect` 37個 | 1個8行と細かい。大きい塊は出し終えた |
| 1,720 | JSX | **要設計**（下記） |

---

## 出した先

### 帯（クリップ）… `components/timeline/`

`TelopBands` / `MainClipBands` / `SeBands` / `OverlayClipBands` /
`TransitionBands` / `DropGhosts` / `Ruler` / `ClipBand` / `KeyMarks`。
**App.tsx に `ClipBand` の直書きは無い。**

### 話題ごとのロジック… `state/use*`

| ファイル | 行 | 渡す物 |
|---|---|---|
| `useTimelineEdit` | 733 | 23 |
| `usePlaybackEngine` | 425 | 24 |
| `usePreviewManip` | 347 | 17 |
| `useMediaDrop` | 345 | 26 |
| `useTracksAdmin` | 326 | 12 |
| `useLibraries` | 281 | 1 |
| `useSessionMemory` | 239 | 28 |
| `useMotion` | 232 | 10 |
| `useVideoSync` | 221 | 23 |
| `useTelopLook` | 191 | 0 |
| `useProjectIO` | 185 | 21 |
| `useTransitions` | 178 | 9 |
| `useDiagnostics` | 150 | 9 |
| `useIconLibrary` | 149 | 14 |
| `useAppLayout` | 143 | 22 |
| `useSegmentPlace` | 137 | 6 |
| `usePreviewFrame` | 133 | 6 |
| `useViewNav` | 71 | 4 |
| `useSnap` | 69 | 2 |
| `useMarkers` | 68 | 4 |
| `useVisibleRange` | 55 | 1 |
| `useSelectionCleanup` | 42 | 0 |

### 画面… `components/`

`AppMenus`（右クリックの品書き6種）。

### 心臓（context）

`DragPreviewProvider` を足した（影・吹き出し・吸い付きの線・囲い・上書き先）。
**JSX を割る前に、掴んでいる最中の状態を心臓へ移す**のが要点。
props で配ると、区画を切り出したときに渡す物が一気に増える。

---

## 手順（次も同じでよい）

1. **話題ごとに「渡す物」を数える。** 心臓から取れる分を引く。目安は40個まで
2. **関数を、直上の説明1ブロックと一緒に**切り出す
   （続けて遡ると、既に別ファイルへ移った物の**取り残された説明**まで巻き込む）
3. deps を空で作って `npm run typecheck` を回す。`Cannot find name 'X'` が全部出るので、
   context / import / deps に振り分ける。**この往復が一番速い**
4. App から元の範囲を消し、呼び出しを入れる
5. `npm run verify` → `npm run build` → `npm run e2e -- --only=<語> --fast`

**一括置換はしないこと。** `(prev) =>` のような形を機械的に置き換えると、
関係ない所（別の setState のコールバック）まで巻き込む（実際に2回起きた）。
型を付けるときは行を見て1つずつ。

---

## 呼ぶ位置が最大の落とし穴

`function` 宣言は巻き上げられるので、どこから参照しても動いていた。
**`const`（フックの戻り値）に変わった瞬間に初期化前参照になる。**
型検査が捕まえてくれるが、順番の組み替えが要る。逃げ道は2つ。

1. **呼び出しを、渡す物が揃った後ろへ移す**
2. 相互参照なら「**呼ぶときに見に行く**」形で渡す
   （`razorSegment: (...a) => razorSegment(...a)`。`useProjectFile` が元からこの形）

いま2を使っているのは5か所（`razorSegment` / `setSegRotate` /
`confirmDiscard`・`rememberProject` / `stopPlayback`・`seekTo`（useSubtitles へ）/
`seekAndReveal`（usePlaybackEngine へ））。どれもコメントで理由を書いてある。

**呼ぶ順は依存の順に並んでいる。** いまはこう:

```
useAppLayout → useLibraries → useDiagnostics → useSegmentPlace → useTracksAdmin
→ useMotion → useSnap → useMediaDrop → useVideoSync → useViewNav → useMarkers
→ useTransitions → useTimelineDrag → useSegmentDrag → useTelopBox → useIconLibrary
→ useCopyPaste → useTimelineEdit → useProjectFile → useProjectIO → useSessionMemory
```

---

## 残っていること

### 1. `useEffect` 37個（317行）── **細かい物だけが残っている**

大きい塊（映像・音の追従／セッションと保存／計測）は出し終えた。
残りは1個8行ほどで、ほとんどが「state を ref へ写す」ような1〜3行の同期と、
メインプロセスからの受け口。**まとめても読みやすくならない**ので、
やるなら受け口だけを `useMainBridge` にまとめる程度（約57行）。

### 2. 小さな関数（約300行）── 残りは小粒

確認ダイアログ（約28）・ショートカット設定（約21）・履歴と時刻（約110）・
ref コールバック（約53）ほか。履歴は下の「出せない」を参照。

### 3. JSX（1,720行）── **これだけは設計が要る**

素直に「タイムライン区画」を部品にすると**渡す物が約130個**になり、目安40個を
大きく超える。プロパティの導管を作るだけで読みやすくならないので、**一度取り下げた**。

割るなら先に下ごしらえが要る:

- `DragPreviewProvider` … **済**
- `TimelineOpsProvider` … 掴む操作の入口をまとめる
  （`onClipPointerDown` / `onSegPointerDown` / `onTrimStart` / `openClipMenu` ほか約20個）
- `TimelineViewProvider` … タイムライン自身の見え方
  （`tool` / `hoverX` / `telopDrop` / `transDrop` / `segLayout` / `padTop` / `trackHOf` ほか）

この3つが揃えば、区画の部品は「自分で見に行く」形になり、渡す物は10個前後に収まる。
**下ごしらえ無しに部品化しないこと**（130個の導管ができるだけで、次の人が困る）。

### 4. 出せない・保留

- **本編映像の `<video>` 常設**（109行）… A/B面のプリロール。ユーザー指示待ち
- **履歴（元に戻す）**（69行）… `restore`（`useProjectFile` の戻り値）と相互参照。
  出すなら ref 経由にする必要がある

---

## 掃除の宿題

**説明の取り残し。** 以前の切り出しで関数だけ移り、説明が App.tsx に残っている箇所が
複数ある。中身の無い JSDoc なので、消すか、いまの持ち主のファイルへ移す。
説明は「なぜそうしたか」の記録なので、**捨てる前に持ち主側にあるか確かめること**。

**使っていない import。** 話題を出したぶん残っている。型検査は通るので動作には影響しない。
数えるなら「import 文の行だけを除いて本文を探す」形にすること
（`import './x.css'` のような from の無い行で素朴な探し方は壊れる）。
