// ライブ編集の「パス編集」の操作（キャンバス・オプションバー・Delete キーから共通で使う）
import { applyPath, removeAnchor, type PathNode } from './engine/pathEdit'
import { addRevealMarkUnderErase } from './engine/selection'
import { strokeParts } from './engine/strokeParts'
import { useEditor } from './store'

/**
 * 線が通る所を、そのグループで見える範囲に加える（通過部分を表示）。
 * 線を動かす・太さや大きさを変える・パス編集したあとに自動で行う。part が -1 ならグループのすべての線。
 * mergeKey を変更と同じにすると、元に戻す1回分にまとまる
 */
export function revealLine(strokeId: string, part: number, mergeKey?: string): void {
  const st = useEditor.getState()
  st.commit(
    (p) => ({
      ...p,
      strokes: p.strokes.map((s) => {
        if (s.id !== strokeId || !s.clip) return s
        const parts = strokeParts(s)
        const chosen = part < 0 ? parts.map((q, i) => ({ q, i })) : parts.slice(part, part + 1).map((q) => ({ q, i: part }))
        let clip = s.clip
        // その線だけに効く。消しゴムで消した所は消えたまま（消しゴムの跡より下に加える）
        for (const { q, i } of chosen) clip = addRevealMarkUnderErase(clip, s.points.slice(q.start, q.end + 1), q.width, i) ?? clip
        return clip === s.clip ? s : { ...s, clip }
      })
    }),
    mergeKey
  )
}

let revealTimer = 0
/** 続けて変えている間（スライダー・キー・ボタン連打）は待ち、止まってから1回だけ表示範囲に加える */
export function revealLineSoon(strokeId: string, part: number, mergeKey?: string): void {
  clearTimeout(revealTimer)
  revealTimer = window.setTimeout(() => revealLine(strokeId, part, mergeKey), 350)
}

/**
 * パス編集中の曲線を nodes に変え、線の点を作り直して軌跡に書き戻す。
 * mergeKey が同じあいだ（ドラッグ中など）の変更は、元に戻す1回分にまとめる
 */
export function updatePathNodes(nodes: PathNode[], mergeKey?: string, selected?: number | null): void {
  const st = useEditor.getState()
  const lp = st.livePath
  if (!lp) return
  const stroke = st.project.strokes.find((s) => s.id === lp.strokeId)
  if (!stroke) return
  const next = applyPath(stroke, lp.part, nodes)
  st.commit((p) => ({ ...p, strokes: p.strokes.map((s) => (s.id === stroke.id ? next : s)) }), mergeKey)
  st.setLivePath({ ...lp, nodes, pointsRef: next.points, selected: selected === undefined ? lp.selected : selected })
  // アンカーの追加・削除のような1回きりの変更は、すぐ通過部分を表示する（ドラッグ中は、離したときに行う）
  if (mergeKey === undefined) revealLine(stroke.id, lp.part)
}

/** 選んでいるアンカーを消す（アンカーが2つしかないときは消さない）。消したら true */
export function deleteSelectedAnchor(): boolean {
  const st = useEditor.getState()
  const lp = st.livePath
  if (!lp || lp.selected === null) return false
  if (lp.nodes.length <= 2) {
    st.notify('アンカーが2つしかないので、これ以上は消せません', 'error')
    return true
  }
  updatePathNodes(removeAnchor(lp.nodes, lp.selected), undefined, null)
  return true
}
