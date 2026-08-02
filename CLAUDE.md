# GiftCut

切り抜き動画に特化したテロップ編集アプリ。Electron + React + TypeScript + FFmpeg。

**このファイルは AI が毎回自動で読む。** 長くしないこと（長いと読み飛ばされる）。
詳しい話は各リンク先にある。

---

## 触る前に：担当を決める

**触ったファイルのパスで、持ち主が一意に決まる。**「直すところが違う」を構造で消すため。

| パス | 部門 | 決まり |
|---|---|---|
| `src/renderer/src/state/**` | 心臓・配線部 | `.company/engineering/departments/state/CLAUDE.md` |
| `src/renderer/src/components/**` | 画面部 | `.company/engineering/departments/ui/CLAUDE.md` |
| `src/renderer/src/lib/**`<br>`src/shared/**`<br>`src/main/**` `src/preload/**` | 計算・書き出し部 | `.company/engineering/departments/core/CLAUDE.md` |
| `e2e/**` `scripts/**` `**/*.test.ts` | 検査部 | `.company/engineering/departments/qa/CLAUDE.md` |

**2つ以上にまたがる作業は、着手前にどちらへ置くか決める**
（またがったまま進めると、両方に半分ずつ書かれて二重実装になる）。

※ `.company/` は .gitignore なので、clone しただけでは無い。無ければこのファイルの決まりだけで進めてよい。

---

## 決まりには検査が付いている

**書いただけの決まりは守られない**ので、機械で止めている。破ると `npm run verify` が赤くなる。

| 止めている失敗 | 検査 |
|---|---|
| ファイルが気づいたら1万行 | `src/shared/fileSize.test.ts`（上限1,250行＋借金の据え置き） |
| 同じ物を別の場所に二重に書く | `src/shared/noDuplicate.test.ts`（shared の作り直し／12行そっくり） |
| 使っていない物がたまる | tsconfig の `noUnusedLocals` |
| 時間計算がバラバラになる | `src/shared/timeline.test.ts` |
| 画面と書き出しで絵がズレる | `shared/clipMotion`・`shared/filterGraph` の試験 |

**検査が無い決まりは「願望」**として `.company/engineering/CLAUDE.md` に分けて書いてある。
決まりを増やすときは検査とセットで。

---

## やってはいけないこと（実際にやらかした物だけ）

1. **通しの e2e（`npm run e2e`、約12分）を勝手に回さない。** 普段は `--only=<語> --fast` で絞る。
   知らないフラグを渡すと**無視されて全件走る**（`e2e/run.mjs` は `includes` で拾うだけ）
2. **`--only` の赤／緑を通しの結果と同じだと思わない。** 順番に依存する項目がある
3. **赤を見たら、まず変更前と比べる。**
   `git stash push -u` → `npm run build` → 同じ `--only` → `git stash pop` → `npm run build`。
   既存の不具合を自分のせいだと思って直しにいかない
4. **大きいファイルを機械的に割らない。** 割る直前に「境目をまたぐ名前」を数える（目安40個）。
   数え方と、`useAppWiring` が割れないと出た実測は `引き継ぎ-App分割.md` の「段階4・5」
5. **一括置換をしない。** `(prev) =>` のような形を機械で置き換えると、
   関係ない所（別の setState のコールバック）まで巻き込む（実際に2回起きた）
6. **コードを heredoc で書かない。** バックスラッシュが1つ消えて、試験ごと壊れて素通りする

---

## よく使うコマンド

```
npm run verify                        型 + 単体673件（数秒。編集のたびにフックが自動で回す）
npm run build                         e2e の前に必ず要る
npm run e2e -- --only=<語> --fast     絞った確認
npm run e2e                           通し224項目・約12分（指示があったときだけ）
npm run dev                           開発起動
```

---

## いまの状態（2026-08-02）

- `npm run verify` 緑。`npm run e2e` **222 / 224**
- 落ちている2件は**リファクタ前から**の既存不具合（プレビュー上で複数選んだ
  テロップのまとめ操作）。`やること.md` に控えてある
- 大きいファイル上位: `src/main/index.ts` 3,352 / `lib/telopStyle.ts` 1,730 /
  `e2e/bench.mjs` 1,641 / `e2e/run.mjs` 1,457。**4つとも借金登録済みで、増やすと赤**

## どこに何が書いてあるか

| | |
|---|---|
| `引き継ぎ-App分割.md` | App.tsx を 11,404 → 198行にした経緯。測った数字と、やってはいけない理由 |
| `やること.md` | プレテストで出た直し・追加 約30件。**リファクタが終わってから着手**と書いてある |
| コードの真上のコメント | **なぜそう作ったか**。ここが一次情報 |
| `.company/engineering/docs/` | 設計の背景・製品の方針（git に乗らない） |
| `.company/engineering/debug-log/` | 調べた経緯・行き止まり（git に乗らない） |
