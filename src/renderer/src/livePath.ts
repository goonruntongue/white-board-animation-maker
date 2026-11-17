// ライブ編集の「パス編集」の操作（キャンバス・オプションバー・Delete キーから共通で使う）
import { applyPath, removeAnchor, type PathNode } from './engine/pathEdit'
import { useEditor } from './store'

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
