// **正典台帳**——「この問いの答えはここ」の一覧。
//
// ## 何のためか
//
// 2026-08-03 に直した11件のうち**5件が「正典・仕組みはあるのに、その道を
// 通っていなかった」型**だった:
//
//   `overwriteCues` は移動のときだけ通っていた（端を伸ばす道は素通り）
//   `EMPTY_DRAG_IMG` は素材ビンだけ通っていた（見本帳は素通り）
//   全体が収まる拡大率が3か所バラバラだった
//   時間の計算を書き出しが手書きしていた（`Math.max(0, …)` が抜けていた）
//   保存する道と保存しない道が混ざっていた
//
// **どれも探せば見つかった。** 探す前にここを見れば済む。
//
// ## ここに載せる物・載せない物
//
// **2回以上書かれた実績がある物だけ。** 全部の関数を載せると誰も直さなくなり、
// 台帳そのものが腐る。「まだ1か所にしか無い物」は `npm run index`（目次）と
// grep で足りる。
//
// ## 腐らせない
//
// **照合できない台帳は書かない**（`readability.test.ts` の R1b と同じ論理）。
// `canon.test.ts` が3つ見張っている:
//
//   ① `home` に `name` が本当にある（引っ越したら赤）
//   ② その `name` が `home` の外から使われている（**参照0の正典は正典ではない**）
//   ③ `re` のある物は、生の式が `debt` を超えていない（`noDuplicate.test.ts`）
//
// **腐った台帳は無いより悪い。** AI はそれを信じて「ここが答えだ」と判断する
//——`lib/telopAnim.ts` に本体の無い説明が残っていて誰も気づかなかったのと同じ壊れ方をする。
//
// ## これはデータで、アプリからは import されない
//
// 読むのは検査と、人（と AI）。`src/shared/` に置いてあるのは、
// 同じ物を見張っている `noDuplicate.test.ts` の隣だから。

export interface Canon {
  /** どんな問いの答えか（人が探すときの言葉で書く） */
  what: string
  /** 正典のあるファイル（リポジトリからの相対パス） */
  home: string
  /** 正典の名前。`canon.test.ts` がここに実在するかを見る */
  name: string
  /** 呼ぶ側がどうすればよいか */
  use: string
  /**
   * **生で書いたら赤にする式**（書ける物だけ）。
   *
   * 名前ではなく式で見るのが肝。名前で見ていた頃は、08-03 の8件のうち
   * **5件がすり抜けた**——名前が違い、式が関数の中に埋まっていたから。
   */
  re?: RegExp
  /** まだ生のまま書いてある場所（ファイル → 件数）。**減らす方向にだけ動かす** */
  debt?: Record<string, number>
}

export const CANON: Canon[] = [
  {
    what: '重ねた動画クリップ（V2以降）の長さは？',
    home: 'src/shared/timeline.ts',
    name: 'vcLen',
    use: 'vcLen(c) を shared/timeline から import する',
    re: /Math\.max\(\s*0\.05\s*,\s*[\w.]+\.srcEnd\s*-\s*[\w.]+\.srcStart\s*\)/,
    // **全額返済（2026-08-03）。生の式は 0 件。**
    //
    // 13か所を寄せてみて、**2つの型に割れていた**:
    //
    //   ① もう手に持っていた（deps で `vcLen` を受けているのに、その行だけ生で書いた）
    //      … useClipDrag / useMediaDrop / useTimelineDrag×2 / useTimelineEdit の5件。
    //      **同じ関数の別の行では受け取った vcLen を使っている**ので、
    //      「知らなかった」のではなく**書くときに思い出さなかった**だけ
    //   ② 持っていなかった（import を足した）… 残り6件
    //
    // `LeftPanel.tsx` は①の極端な形で、**ローカル定数を `vcLen` と名づけて
    // 正典の名前を奪っていた**（`vcSec` に改名した）。
    // 画面側の元締め `useTrackGeom` も、自前の式をやめて正典を import して配っている。
    debt: {}
  },
  {
    what: '切片の再生速度は？（0以下なら等速）',
    home: 'src/shared/timeline.ts',
    name: 'segSpeed',
    use: 'segSpeed(s) を import する',
    re: /speed\s*&&\s*[\w.]*\.?speed\s*>\s*0\s*\?/,
    // **返済済み**（2026-08-03。exportRun の写しを消して正典を import した）
    debt: {}
  },
  {
    what: '切片のタイムライン上の長さは？（元の長さ ÷ 速度）',
    home: 'src/shared/timeline.ts',
    name: 'segTLen',
    use: 'segTLen(s) を import する',
    // **08-03 に見つかった実害**: 正典は Math.max(0, ...) で下を止めているが、
    // exportRun の写しには**それが無かった**。画面は0で止まるのに書き出しは負になる。
    re: /\(\s*[\w.]+\.srcEnd\s*-\s*[\w.]+\.srcStart\s*\)\s*\//,
    debt: { 'src/renderer/src/state/useSegmentDrag.ts': 1 }
  },
  {
    what: '寄せ（ズーム）を CSS の transform にするには？',
    home: 'src/renderer/src/lib/clipXform.ts',
    name: 'clipXform',
    use: 'clipXform(c, localT) を import する',
    // 08-03 に clipXform の**並べる順**を直した（反転で左右が真逆になっていた）。
    // 残る2か所は直していない。**同じ間違いが2つ残っている。**
    //
    // ※ 08-04 に片方の置き場が変わった（usePlaybackEngine → useSegClock）。
    //   **中身は1文字も変えていない**——借金の付け先だけ移した。
    //   直すには `clipXform(c, localT)` ではなく「Zoom 1つを transform にする」
    //   下位の物が要る（ここが持っているのは切片ではなく `xf.bZoom`）。
    re: /translate\(\$\{[^}]*\*\s*100\)\.toFixed\(3\)\}%/,
    debt: {
      'src/renderer/src/state/useSegClock.ts': 1,
      'src/renderer/src/state/usePreviewFrame.ts': 1
    }
  },

  // ---- ここから下は 2026-08-03 に足した。**式が書けない物も載せる** ----
  //
  // 上の4つは「生の式」で捕まえられるが、下の5つは形が定まらない（呼ぶだけの物・
  // 定数）。式が無くても **①実在する ②参照0でない** は照合できるので、
  // 「答えはここ」という台帳としては十分に働く。

  {
    what: 'テロップ同士が同じ段で重なったら、どちらを残す？',
    home: 'src/shared/overwrite.ts',
    name: 'overwriteCues',
    use:
      'overwriteCues(all, winnerIds, trackOf, nextId) を呼ぶ。' +
      '**置いた側／伸ばした側が勝つ**。採番は呼ぶ側で（updater の中で回すと StrictMode でずれる）',
    // 2026-08-03: 落として重ねる道は通っていたが、**端をつまんで伸ばす道だけ
    // 通っていなかった**ので、伸ばすと重なったまま残っていた。
  },
  {
    what: 'テロップの重なりを、画面（React）側から実際に当てるには？',
    home: 'src/renderer/src/state/cueOverwrite.ts',
    name: 'overwriteOverlapped',
    use:
      'overwriteOverlapped(cues, winnerIds, trackOf, nextId) を呼ぶ。' +
      '**判定は shared/overwrite、呼び方はここ**——採番を updater の外でやる／' +
      '複製は structuredClone、の2つは React 側でしか決められないので、ここに閉じてある',
    // **上の overwriteCues と別に載せてあるのは、事故が2回とも「呼び忘れ」だったから。**
    // 台帳は在り処しか書かないので、`overwriteCues` を引いただけでは
    // 「呼んでいる場所が全部で3つあるか」までは分からない。
    //
    //   2026-08-03 ①  端をつまんで伸ばす道が通っていなかった
    //   2026-08-03 ②  貼り付け・複製が通っていなかった（**秘書エージェントが発見**）
    //
    // → いまは 掴む（`useTimelineDrag`）／貼り付け（`useCopyPaste`）／
    //   複製（`useTimelineEdit`）の3つがここを通る。
    //   **4つ目の道を作るときは、必ずここを通すこと。**
  },
  {
    what: 'タイムライン全体がちょうど収まる拡大率は？',
    home: 'src/shared/zoomBar.ts',
    name: 'fitZoom',
    use: 'fitZoom(viewW, totalSec) を import する。「↔ 全体表示」もここを通る',
    // 2026-08-03: 「↔」と「拡大バーの端」と「Ctrl+ホイール」が別々の式を持っていて、
    // しかも下限 6px/秒 で頭打ちだったため**長い素材では全体が見えなかった**。
  },
  {
    what: '目一杯引いたとき、どこまで引ける？',
    home: 'src/shared/zoomBar.ts',
    name: 'minZoom',
    use:
      'minZoom(viewW, totalSec, floor) を import する。' +
      '**拡大バーの端・Ctrl+ホイール・↔ の3つとも同じ所を通すこと**',
    // zoomBar.ts の冒頭が「Ctrl+ホイールは別の道なので食い違う」と警告している型。
  },
  {
    what: '掴んでいる間、カーソルに何も握らせないには？',
    home: 'src/renderer/src/lib/dragChip.ts',
    name: 'EMPTY_DRAG_IMG',
    use:
      'e.dataTransfer.setDragImage(EMPTY_DRAG_IMG, 0, 0)。' +
      '**置き先はタイムラインの帯で見せる**ので、カーソル側にも絵があると二重になる',
    // 2026-08-03: 素材ビンは前から通っていたが、**見本帳とアイコンが素通り**で、
    // ブラウザ既定のゴースト（カード全体＝文字の見本）が付いてきていた。
  },
  {
    what: '書き出しで「この時刻に出す」窓の式は？',
    home: 'src/shared/filterGraph.ts',
    name: 'overlayEnableExpr',
    use:
      'overlayEnableExpr(start, end) を import する。**半開区間**（両端を含む between は使わない）',
    // 両端を含むと隣の窓と1フレーム重なり、半フレーム詰めると隙間ができて
    // **書き出した動画でテロップがチカチカする**。画面側の判定（shared/cueWindow）とも
    // 突き合わせてある。
  },
  {
    what: '心臓（context）の受け口の型は、どこから持ってくる？',
    home: 'src/renderer/src/state/wiredValue.ts',
    name: 'Wired',
    use:
      "type W = Wired<'キー'> と書いて、各メンバーを W['同じ名前'] にする。" +
      '**型を手で書かない**（実体は useAppWiring が詰めている1か所だけなので、そこから引ける）',
    // 2026-08-03: 受け口が**341件すべて手書きの `any`** だった。区画は心臓を
    // 自分で見に行くので、受け口が any だと**存在しない物を触っても型検査が素通りする**。
    // 08-03 の不具合11件のうち2件がその型（`draggingEmphasisRef`）。
    //
    // 引く形にしたら **363件に本物の型が付き、any は 0**。
    // その場で本物を1件見つけた（`TimelineArea` の手書き注釈に `kind` が無く、
    // `{ id, name }` と書き直した瞬間に段の種類が黙って消える形だった）。
    //
    // **1行の派生型（`= W`）にはしない**——キーごとの説明が全部消えるため。
    // 見張りは `ctxTypes.test.ts`（any を書かない／名前のズレも赤／
    // 配線側で注釈を付け直さない）。経緯は `引き継ぎ-受け口の型.md`。
    //
    // ※ **同じ穴が一段深い所（フックの deps）に 221件残っている**（`やること.md`）。
    //   ただし context と同じ手が使えるとは限らない——context は
    //   **詰める場所が1か所**だったから引けた。数えてから決めること。
  }
]
