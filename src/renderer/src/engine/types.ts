// プロジェクトデータの型定義（PRD 5章）。.wbanim ファイルはこの JSON をそのまま保存する。

export interface StrokePoint {
  /** 画像の基準サイズに対する x 座標 (px) */
  x: number
  /** 画像の基準サイズに対する y 座標 (px) */
  y: number
  /** なぞり始めからの経過時間 (ms) */
  t: number
}

export interface Stroke {
  id: string
  name: string
  points: StrokePoint[]
  /** マスクを消す太さ (px)。文字や図より少し太めにする */
  revealWidth: number
  /** 再生時間 (ms) */
  duration: number
  /** この軌跡のあとに待つ時間 (ms) */
  delayAfter: number
  /** なぞったときの速度の緩急を再現する */
  useRecordedTiming: boolean
  /** 一時的に再生から外す */
  hidden?: boolean
  /** エディタ上の表示色 */
  color: string
}

export interface ImageAsset {
  name: string
  dataUrl: string
  width: number
  height: number
}

export interface HandAsset {
  name: string
  dataUrl: string
  width: number
  height: number
  /** 素材内のペン先位置 (px) */
  tipX: number
  tipY: number
  builtin: boolean
}

export interface ProjectSettings {
  /** 全体速度（倍率） */
  speed: number
  /** 再生開始前の待機 (ms) */
  startDelay: number
  /** 描き終わったあとの静止 (ms) */
  endHold: number
  boardColor: string
  showHand: boolean
  handShadow: boolean
  handFollowDirection: boolean
  /** 手の大きさ（画像の高さに対する比率） */
  handSize: number
  /** 内蔵の手素材のペン色 */
  penColor: string
  /** 新しく録画する軌跡の既定値 */
  defaultRevealWidth: number
  defaultDelayAfter: number
}

export interface Project {
  version: 1
  name: string
  image: ImageAsset | null
  hand: HandAsset
  settings: ProjectSettings
  strokes: Stroke[]
}
