import { assetStore } from '@/store/storage'
import { useEffect, useState } from 'react'
import { useLibrary } from '@/store/library'

const key = (name: string) => `artist-img:${name}`

export async function saveArtistImage(name: string, file: Blob) {
  await assetStore.set(key(name), file)
  useLibrary.getState().updateArtist(name, { imageKey: key(name) })
}

export async function removeArtistImage(name: string) {
  await assetStore.del(key(name))
  useLibrary.getState().updateArtist(name, { imageKey: undefined })
}

export function useArtistImage(name: string): string | null {
  const imageKey = useLibrary((s) => s.artists[name]?.imageKey)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!imageKey) return
    let alive = true
    let objectUrl: string | null = null
    assetStore.get<Blob>(imageKey)
      .then((blob) => {
        if (!alive || !blob) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {})
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [imageKey])
  return (imageKey && url) || null
}

export function placeholderStyle(name: string): React.CSSProperties {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  return { background: `linear-gradient(135deg, oklch(0.7 0.11 ${h}), oklch(0.32 0.08 ${(h + 50) % 360}))` }
}
