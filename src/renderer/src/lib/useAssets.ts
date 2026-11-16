import { useEffect, useState } from 'react'
import { loadImage } from '../engine/wb-engine'
import type { Project } from '../engine/types'

const cache = new Map<string, HTMLImageElement>()

function useLoadedImage(src: string | undefined): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(() => (src ? (cache.get(src) ?? null) : null))
  useEffect(() => {
    if (!src) {
      setImg(null)
      return
    }
    const hit = cache.get(src)
    if (hit) {
      setImg(hit)
      return
    }
    let alive = true
    loadImage(src)
      .then((im) => {
        // 巨大な data URL を無制限に保持しないよう、キャッシュは小さく保つ
        if (cache.size > 8) cache.clear()
        cache.set(src, im)
        if (alive) setImg(im)
      })
      .catch(() => alive && setImg(null))
    return () => {
      alive = false
    }
  }, [src])
  return img
}

export function useAssets(project: Project): { image: HTMLImageElement | null; hand: HTMLImageElement | null } {
  const image = useLoadedImage(project.image?.dataUrl)
  const hand = useLoadedImage(project.hand.dataUrl)
  return { image, hand }
}
