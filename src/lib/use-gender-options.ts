import { useMemo } from 'react'
import { genderOptions, type GenderDef } from './gender'
import { lookupTag } from './tagdb'
import { NSFW_MAX_LEVEL, usePrefs } from '@/store/prefs'

export function useGenderOptions(): GenderDef[] {
  const more = usePrefs((s) => s.moreGenders)
  const off = usePrefs((s) => s.genderPresetsOff)
  const customs = usePrefs((s) => s.customGenders)
  const nsfw = usePrefs((s) => s.nsfw)
  return useMemo(
    () => genderOptions({ moreGenders: more, genderPresetsOff: off, customGenders: customs }, NSFW_MAX_LEVEL[nsfw], (t) => lookupTag(t)?.level ?? 0),
    [more, off, customs, nsfw],
  )
}
