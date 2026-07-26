// クリップのラベルカラー（プレミアのラベル相当）

export interface LabelColor {
  name: string
  color: string
}

export const LABEL_COLORS: LabelColor[] = [
  { name: 'バイオレット', color: '#a679f0' },
  { name: 'ブルー', color: '#4ea1f0' },
  { name: 'ティール', color: '#3fb6c8' },
  { name: 'グリーン', color: '#4fd18b' },
  { name: 'イエロー', color: '#f0c04e' },
  { name: 'オレンジ', color: '#f0924e' },
  { name: 'レッド', color: '#f07a7a' },
  { name: 'ピンク', color: '#f09fd6' },
  { name: 'グレー', color: '#8a8f98' }
]

export const DEFAULT_LABEL = '#a679f0'

export function labelName(color: string): string {
  return LABEL_COLORS.find((l) => l.color === color)?.name ?? 'カスタム'
}
