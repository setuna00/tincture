import { create } from 'zustand'
import { nextCollectionTitle, useLibrary } from './library'

interface ArtistNav {
  open: string | null
  collection: string | null
}

export const useArtistNav = create<ArtistNav>(() => ({ open: null, collection: null }))

export const useArtistStatus = create(() => ({ detail: false, zoom: false }))

export function openInArtistLibrary(name: string) {
  useArtistNav.setState({ open: name, collection: null })
  location.hash = '/artists'
}

export function newCollectionInArtistLibrary(name: string) {
  const lib = useLibrary.getState()
  const c = lib.createCollection(nextCollectionTitle(lib.artistCollections), [name])
  useArtistNav.setState({ open: null, collection: c.id })
  location.hash = '/artists'
}
