import { useEffect, useState } from 'react'
import wikiZhUrl from '@/assets/tags/wiki.json.gz?url'
import { fetchJsonGz } from './tag-data'
import { parseWikiZh, type WikiZh, type WikiZhFile } from './wiki-zh'

let wikiZh: WikiZh | null = null
let wikiZhLoading: Promise<WikiZh | null> | null = null
export function loadWikiZh(): Promise<WikiZh | null> {
  return (wikiZhLoading ??= fetchJsonGz<WikiZhFile>(new URL(wikiZhUrl, location.href).href)
    .then((f) => (wikiZh = parseWikiZh(f)))
    .catch((e) => {
      console.error('中文释义加载失败', e)
      return null
    }))
}

export function useWikiZh(): WikiZh | null {
  return useWikiZhPack(true).pack
}

export function useWikiZhPack(enabled: boolean): { pack: WikiZh | null; done: boolean } {
  const [st, setSt] = useState(() => ({ pack: wikiZh, done: !!wikiZh }))
  useEffect(() => {
    let alive = true
    if (enabled && !st.done) loadWikiZh().then((x) => alive && setSt({ pack: x, done: true }))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
  return st
}
