import type { ClipRegion, ClipShape, Project, Stroke, StrokePoint } from './types'

export const ENGINE_VERSION: number

export interface PreparedStroke {
  stroke: Stroke
  pts: StrokePoint[]
  param: number[]
  length: number
}

export interface TimelineSegment {
  index: number
  prep: PreparedStroke
  start: number
  end: number
  gapEnd: number
}

export interface Timeline {
  segments: TimelineSegment[]
  drawEnd: number
  total: number
}

export interface HandState {
  x: number
  y: number
  angle: number
  drawing: boolean
  segIndex: number
}

export function prepareStroke(stroke: Stroke): PreparedStroke
export function buildTimeline(project: Project): Timeline
export function handStateAt(
  timeline: Timeline,
  t: number,
  width: number,
  height: number,
  followDirection: boolean
): HandState

export interface RenderAssets {
  image: CanvasImageSource | null
  hand: CanvasImageSource | null
}

export class WBRenderer {
  constructor(canvas: HTMLCanvasElement, project: Project, assets: RenderAssets)
  readonly canvas: HTMLCanvasElement
  readonly width: number
  readonly height: number
  readonly duration: number
  timeline: Timeline
  setProject(project: Project): void
  setAssets(assets: RenderAssets): void
  resetMask(): void
  renderAt(t: number, opts?: { hand?: boolean; background?: boolean }): void
}

export function loadImage(src: string): Promise<HTMLImageElement>

export function traceClipShape(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  shape: ClipShape,
  width: number,
  height: number
): void
export function rasterizeClip(clip: ClipRegion, width: number, height: number): HTMLCanvasElement | OffscreenCanvas
export function clipBounds(clip: ClipRegion, width: number, height: number): { x: number; y: number; w: number; h: number }
