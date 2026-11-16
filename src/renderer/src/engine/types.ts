// プロジェクトデータの型定義（PRD 5章）。.wbanim ファイルはこの JSON をそのまま保存する。

export interface StrokePoint {
  /** 画像の基準サイズに対する x 座標 (px) */
  x: number
  /** 画像の基準サイズに対する y 座標 (px) */
  y: number
  /** なぞり始めからの経過時間 (ms) */
  t: number
  /** 1 なら、この点の手前でペンを上げる（描き足した部分の書き始め）。ここまでの移動は描かない */
  b?: 1
  /** b の点だけ：ここから先の見せる幅 (px)。省略時は軌跡の revealWidth */
  w?: number
}

/** add: 追加 / subtract: 除外 / intersect: 交差（重なった部分だけ残す） */
export type ClipMode = 'add' | 'subtract' | 'intersect'

/** 選択範囲を構成する図形。rect / ellipse は外接矩形、poly は頂点列、all は画像全体 */
export type ClipShape =
  | { kind: 'rect' | 'ellipse'; mode: ClipMode; x: number; y: number; w: number; h: number }
  | { kind: 'poly'; mode: ClipMode; points: { x: number; y: number }[] }
  | { kind: 'all'; mode: ClipMode }
  /** ブラシでなぞった線（太さ width）。消しゴムの跡に使う */
  | { kind: 'stroke'; mode: ClipMode; points: { x: number; y: number }[]; width: number }
  /**
   * 画素単位の形（描き順の自動生成で使う）。gw×gh の格子上で、行ごとの連続区間を
   * [y, x, 長さ, y, x, 長さ, …] と並べたもの。box は格子上の外接矩形 [x0, y0, x1, y1]。
   * 描くときに画像の大きさへ引き伸ばすので、書き出しの解像度が変わっても作り直さなくてよい。
   */
  | { kind: 'rle'; mode: ClipMode; gw: number; gh: number; runs: number[]; box: [number, number, number, number] }
  /** 別の選択範囲をまるごと1つの図形として扱う（反転などで使う） */
  | { kind: 'region'; mode: ClipMode; region: ClipRegion }

/** 選択範囲。図形を先頭から順に「追加」「除外」して作る */
export interface ClipRegion {
  shapes: ClipShape[]
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
  /** この軌跡がマスクを外せる範囲（なければ制限なし） */
  clip?: ClipRegion
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
  /** true = 内蔵のイラスト（SVG・ペン色変更可） */
  builtin: boolean
  /** assets/hand の内蔵素材のとき、そのファイル名（拡張子なし）。保存時は画像本体を省く */
  presetId?: string
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
  /** 消しゴムの太さ (px) */
  eraserWidth: number
  /** 描き終わったら画像全体を表示する（薄い部分やなぞり残しを最後に補う） */
  finishFull: boolean
}

/** スライドの1ページ（画像1枚と、その描き順） */
export interface Page {
  id: string
  image: ImageAsset | null
  strokes: Stroke[]
}

export interface Project {
  version: 1
  name: string
  /** いま編集しているページの画像（pages[pageIndex] の作業用の写し） */
  image: ImageAsset | null
  hand: HandAsset
  settings: ProjectSettings
  /** いま編集しているページの描き順（pages[pageIndex] の作業用の写し） */
  strokes: Stroke[]
  /**
   * 全ページ。編集中のページの最新の内容は image / strokes にあり、
   * ページの切り替え・保存・書き出しのときに syncPages() でここへ書き戻す。
   */
  pages: Page[]
  pageIndex: number
}
