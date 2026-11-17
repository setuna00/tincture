import { useMemo } from 'react'
import { useStore } from 'zustand'
import { maxSamplesForSize, naiModelId } from '@/lib/nai-api'
import { inpaintPrice, inpaintSettings, inpaintSize } from '@/lib/nai-inpaint'
import { effectiveSettings } from '@/lib/nai-write'
import { vibeEncoded, type GenImage } from '@/store/gen'
import { useInpaint } from '@/store/inpaint'
import { accountOf, useNai } from '@/store/nai'
import { useVibeCodes } from '@/store/ref-images'
import { getDocStore } from '@/store/tabs'

export function useInpaintPrice(tabId: string, img: GenImage) {
  const doc = useStore(getDocStore(tabId), (s) => s.doc)
  const account = useNai((s) => accountOf(s.account))
  const strength = useInpaint((s) => s.strength)
  const have = useVibeCodes((v) => v.have)
  return useMemo(() => {
    const size = inpaintSize(img.width, img.height)
    const n = Math.min(doc.settings.gen.nSamples ?? 1, maxSamplesForSize(size.width, size.height))
    return { price: inpaintPrice(doc.settings, size, n, strength, account, vibeEncoded(have, naiModelId(inpaintSettings(effectiveSettings(doc.settings))))), n }
  }, [img, doc, strength, account, have])
}
