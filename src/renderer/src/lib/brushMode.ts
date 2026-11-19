// ブラシの「いまの動き」と「いまの太さ」。絵の上（Stage）とオプションバー（LiveEditBar）で同じ決め方を使う。
//  ・動き：一から描いているグループ（drawChain）を選んでいるあいだは自動で「追加」。それ以外は ▼ で選んだもの（描き直す／追加）
//  ・太さ：線を選んでいれば、その線の太さ（ブラシの大きさの欄で変えたら、その値）。選んでいなければ、ブラシの大きさ
import { useSyncExternalStore } from 'react'
import { strokeParts } from '../engine/strokeParts'
import { useEditor } from '../store'
import { getBrushTarget, useBrushTarget, type BrushTarget } from './brushTarget'

type St = ReturnType<typeof useEditor.getState>

/** 選んでいる線（その線がもうなければ null） */
export function selectedLine(st: St): { strokeId: string; part: number; width: number } | null {
  const lp = st.livePart
  if (!lp) return null
  const stroke = st.project.strokes.find((x) => x.id === lp.strokeId)
  const part = stroke ? strokeParts(stroke)[lp.part] : undefined
  return stroke && part ? { strokeId: lp.strokeId, part: lp.part, width: part.width } : null
}

/** 一から描いているグループを選んでいるか（このあいだは自動で「追加」） */
export function drawingFresh(st: St): boolean {
  return !!st.drawChain && st.livePart?.strokeId === st.drawChain.id
}

export function effectiveBrushTarget(st: St): BrushTarget {
  return drawingFresh(st) ? 'add' : getBrushTarget()
}

// Shift を押しているか（PC：押しながらなぞると、その1回だけ「追加」。ボタンの表示もそのあいだ「追加」にする）
let shiftHeld = false
const shiftListeners = new Set<() => void>()
function setShift(v: boolean): void {
  if (v === shiftHeld) return
  shiftHeld = v
  shiftListeners.forEach((f) => f())
}
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => setShift(e.shiftKey), true)
  window.addEventListener('keyup', (e) => setShift(e.shiftKey), true)
  window.addEventListener('pointermove', (e) => setShift(e.shiftKey), true)
  window.addEventListener('blur', () => setShift(false))
}
function useShiftHeld(): boolean {
  return useSyncExternalStore(
    (f) => {
      shiftListeners.add(f)
      return () => void shiftListeners.delete(f)
    },
    () => shiftHeld
  )
}

/** いまの動き（表示用）。線を選んでいて Shift を押しているあいだは「追加」 */
export function useEffectiveBrushTarget(): BrushTarget {
  const target = useBrushTarget()
  const fresh = useEditor(drawingFresh)
  const lineSelected = useEditor((s) => !!selectedLine(s))
  const shift = useShiftHeld()
  return fresh || (shift && lineSelected) ? 'add' : target
}

/** ブラシで描く太さ */
export function brushWidthFor(st: St): number {
  const line = selectedLine(st)
  return line ? Math.round(st.lineBrushWidth ?? line.width) : st.project.settings.defaultRevealWidth
}

export function useBrushWidth(): number {
  return useEditor(brushWidthFor)
}
