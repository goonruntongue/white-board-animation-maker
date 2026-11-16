import { useEffect, useState } from 'react'
import { useEditor } from '../store'

export function Toast(): React.JSX.Element | null {
  const toast = useEditor((s) => s.toast)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!toast) return
    setVisible(true)
    const id = setTimeout(() => setVisible(false), toast.kind === 'error' ? 6000 : 3200)
    return () => clearTimeout(id)
  }, [toast])

  if (!toast || !visible) return null
  return (
    <div className={`toast ${toast.kind}`} role="status" onClick={() => setVisible(false)}>
      {toast.text}
    </div>
  )
}
