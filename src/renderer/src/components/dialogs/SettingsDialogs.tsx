// 設定まわりのダイアログ 2種。
//
//   ShortcutSettings … キーボードショートカットの割り当て
//   IconAssignSettings … 色／レーンごとに、テロップの前に出すアイコンを割り当てる
//
// どちらも状態は App が持ち、ここは形だけを受け持つ。

export function ShortcutSettings<Id extends string>({
  actions,
  groups,
  shortcuts,
  capturingId,
  onCapture,
  onReset,
  onClose,
  formatCombo
}: {
  actions: { id: Id; label: string; group: string }[]
  /** 並べる順（見出しになる） */
  groups: string[]
  shortcuts: Record<Id, string>
  /** いま「キーを押す…」の待ち受け中の行 */
  capturingId: Id | null
  onCapture: (id: Id) => void
  onReset: () => void
  onClose: () => void
  formatCombo: (combo: string) => string
}): React.JSX.Element {
  const ids = Object.keys(shortcuts) as Id[]
  return (
    <div className="prefs-overlay" onClick={onClose}>
      <div className="prefs-box" onClick={(e) => e.stopPropagation()}>
        <div className="prefs-head">
          <span>環境設定 — キーボードショートカット</span>
          <button className="prefs-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="prefs-body">
          {groups.map((group) => (
            <div key={group} className="prefs-group">
              <div className="prefs-group-title">{group}</div>
              {actions
                .filter((a) => a.group === group)
                .map((a) => {
                  const combo = shortcuts[a.id]
                  // 同じキーが2つの操作に付いていたら赤く出す。
                  // 黙って後勝ちにすると「押しても効かないキー」ができる。
                  const conflict = ids.some((k) => k !== a.id && shortcuts[k] === combo)
                  return (
                    <div className="prefs-row" key={a.id}>
                      <span className="prefs-label">{a.label}</span>
                      <button
                        className={`prefs-key ${capturingId === a.id ? 'capturing' : ''} ${conflict ? 'conflict' : ''}`}
                        onClick={() => onCapture(a.id)}
                        title={conflict ? '他のショートカットと重複しています' : ''}
                      >
                        {capturingId === a.id ? 'キーを押す…' : formatCombo(combo)}
                      </button>
                    </div>
                  )
                })}
            </div>
          ))}
        </div>
        <div className="prefs-foot">
          <span className="prefs-hint">
            行のキーをクリック → 新しいキーを押す（Esc でキャンセル）
          </span>
          <button className="btn" onClick={onReset}>
            ショートカットをリセット
          </button>
        </div>
      </div>
    </div>
  )
}

export function IconAssignSettings({
  library,
  colorRows,
  laneRows,
  colorAssign,
  laneAssign,
  onAssignColor,
  onAssignLane,
  ringColors,
  onRingColor,
  templates,
  templateOf,
  onPickTemplate,
  onApplyTemplate,
  hasTelop,
  onClose
}: {
  library: { id: number; name: string; image: string }[]
  /** 出す色（使用中の色＋割当済みの色だけ。全色は並べない） */
  colorRows: { color: string; name: string }[]
  /** テロップを置けるレーン */
  laneRows: { id: string; label: string }[]
  colorAssign: Record<string, string>
  laneAssign: Record<string, string>
  onAssignColor: (color: string, image: string | null) => void
  onAssignLane: (lane: string, image: string | null) => void
  /**
   * 人物（＝ラベルの色）ごとの**アイコンの縁の色**。空ならラベル色をそのまま使う。
   * ラベル色は帯の色分けにも使うので、**縁だけ別にしたい**が通らなかった（2026-08-16）。
   */
  ringColors: Record<string, string>
  onRingColor: (color: string, ring: string | null) => void
  /**
   * 人物ごとの**テロップの見た目**（テンプレートの名前）と、それを当てる操作。
   *
   * **勝手には当てない。** 選んだ時と「当てる」を押した時だけ、その人物の
   * テロップ全部に当たる。自動にすると、後から色を付け替えた瞬間に
   * 手で直した見た目が黙って上書きされる。
   */
  templates: { name: string }[]
  templateOf: Record<string, string>
  onPickTemplate: (color: string, name: string | null) => void
  onApplyTemplate: (color: string) => void
  hasTelop: boolean
  onClose: () => void
}): React.JSX.Element {
  // 画像を選ぶ並び（色の行でもレーンの行でも同じ物を使う）
  const picker = (
    cur: string | undefined,
    pick: (img: string | null) => void
  ): React.JSX.Element => (
    <div className="assign-picker">
      <button className={`assign-thumb ${!cur ? 'on' : ''}`} onClick={() => pick(null)} title="なし">
        ✕
      </button>
      {library.map((it) => (
        <button
          key={it.id}
          className={`assign-thumb ${cur === it.image ? 'on' : ''}`}
          onClick={() => pick(it.image)}
          title={it.name}
        >
          <img src={it.image} alt="" />
        </button>
      ))}
    </div>
  )
  return (
    <div className="prefs-overlay" onClick={onClose}>
      <div className="prefs-box" onClick={(e) => e.stopPropagation()}>
        <div className="prefs-head">
          <span>アイコン設定 — 人物（色）ごとに アイコン・縁の色・テロップの見た目</span>
          <button className="prefs-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="prefs-body">
          <div className="prefs-hint" style={{ marginBottom: 10 }}>
            「アイコン」タブで追加した画像を割り当て。優先順位は 個別D&amp;D → 色 → レーン。
          </div>
          {library.length === 0 && (
            <div className="sp-label" style={{ marginBottom: 10 }}>
              先に「アイコン」タブで画像を追加してください。
            </div>
          )}
          <div className="sp-subhead">
            <span>色ごと（使用中の色のみ表示）</span>
          </div>
          {colorRows.length === 0 && !hasTelop && (
            <div className="sp-label" style={{ marginBottom: 8 }}>
              テロップがまだありません。テロップに色を付けるとここに出ます。
            </div>
          )}
          {colorRows.map((l) => (
            <div className="assign-row assign-row-person" key={l.color}>
              <span className="lg-swatch" style={{ background: l.color }} />
              <span className="assign-name">{l.name}</span>
              {picker(colorAssign[l.color], (img) => onAssignColor(l.color, img))}
              {/* **縁の色は人物ごと。** 空ならラベル色（今までの見え方）。
                  「戻す」で空に戻せる＝一度触ったら二度とラベル色へ戻せない、を作らない */}
              <label className="assign-ring" title="アイコンの縁の色（未設定ならラベル色）">
                縁
                <input
                  type="color"
                  value={ringColors[l.color] || l.color}
                  onChange={(e) => onRingColor(l.color, e.target.value)}
                />
              </label>
              {ringColors[l.color] && (
                <button className="btn small" onClick={() => onRingColor(l.color, null)}>
                  縁を戻す
                </button>
              )}
              {/* **この人のテロップの見た目。** 選ぶとその場で当たる。
                  あとから足したテロップには「当てる」で追いつかせる */}
              <select
                className="assign-tpl"
                value={templateOf[l.color] ?? ''}
                onChange={(e) => onPickTemplate(l.color, e.target.value || null)}
                title="この人物のテロップの見た目（選ぶと今あるぶんに当たります）"
              >
                <option value="">見た目：指定なし</option>
                {templates.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
              {templateOf[l.color] && (
                <button
                  className="btn small"
                  onClick={() => onApplyTemplate(l.color)}
                  title="この人物のテロップ全部に、いまの見た目を当て直します"
                >
                  当てる
                </button>
              )}
            </div>
          ))}
          <div className="sp-subhead" style={{ marginTop: 12 }}>
            <span>レーンごと（そのトラックのテロップ全部に表示）</span>
          </div>
          {laneRows.map((t) => (
            <div className="assign-row" key={t.id}>
              <span className="assign-name" style={{ minWidth: 64 }}>
                {t.label}
              </span>
              {picker(laneAssign[t.id], (img) => onAssignLane(t.id, img))}
            </div>
          ))}
        </div>
        <div className="prefs-foot">
          <span className="prefs-hint">画像は「アイコン」タブで管理（追加・削除）</span>
          <button className="btn" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
