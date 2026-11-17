import { useEffect, useMemo } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useCatalog } from '@/components/discover/data'
import { GachaCenter } from '@/components/gacha/center'
import { TemplateList } from '@/components/gacha/template-list'
import { dropTags, ensureResults, resolveSource, rerollTags, rollPools, toggleLockPools, toggleLockTags } from '@/components/gacha/data'
import { loadArtistList, useArtistData, useArtistPopularity } from '@/lib/artist-db'
import { useCharWorks } from '@/lib/char-works'
import { gachaTemplates } from '@/lib/gacha-templates'
import { overlayOpen } from '@/store/discover'
import { useGacha, useGachaRun } from '@/store/gacha'
import { useLists } from '@/store/lists'
import { usePrefs } from '@/store/prefs'

export function GachaPage() {
  const catalog = useCatalog()
  const charsReady = useCharWorks()
  const artistList = useArtistData((s) => s.list)
  const artistPop = useArtistPopularity()
  const nsfw = usePrefs((s) => s.nsfw !== 'off')
  useEffect(() => void loadArtistList().catch((e) => console.error('画师名单下载失败', e)), [])
  const lists = useLists((s) => s.lists)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 角色表、画师名单、人气到了要重新生成（resolveSource 里现读）
  const templates = useMemo(() => (catalog ? gachaTemplates((s) => resolveSource(s, catalog, lists)) : null), [catalog, charsReady, artistList, artistPop, nsfw, lists])
  const activeId = useGacha((s) => s.activeTemplate)
  const active = templates?.find((t) => t.id === activeId) ?? templates?.[0] ?? null

  useEffect(() => {
    if (active) ensureResults(active)
  }, [active])

  const ok = () => !!active && !overlayOpen()
  useHotkeys(
    'space',
    (e) => {
      if (!ok()) return
      e.preventDefault()
      rollPools(active!)
    },
    [active],
  )
  useHotkeys(
    'r',
    (e) => {
      if (!ok()) return
      const { selTags, selPools } = useGachaRun.getState()
      if (selTags.length) rerollTags(active!, selTags)
      else if (selPools.length) rollPools(active!, selPools)
      else return
      e.preventDefault()
    },
    [active],
  )
  useHotkeys(
    'l',
    (e) => {
      if (!ok()) return
      const { selTags, selPools } = useGachaRun.getState()
      if (selTags.length) toggleLockTags(active!, selTags)
      else if (selPools.length) toggleLockPools(active!, selPools)
      else return
      e.preventDefault()
    },
    [active],
  )
  useHotkeys(
    ['delete', 'backspace'],
    (e) => {
      if (!ok()) return
      const { selTags } = useGachaRun.getState()
      if (!selTags.length) return
      e.preventDefault()
      dropTags(active!, selTags)
    },
    [active],
  )
  useHotkeys(
    'escape',
    () => {
      if (overlayOpen()) return
      const run = useGachaRun.getState()
      if (run.selTags.length === 1) run.set({ selPools: [run.selTags[0].split('|')[0]], selTags: [], anchor: null })
      else run.set({ selTags: [], selPools: [], anchor: null })
    },
    [],
  )

  if (!templates || !active)
    return (
      <div className="flex h-full min-h-0" data-testid="gacha-page">
        <div className="grid flex-1 place-items-center bg-work text-[13px] text-ink-3">加载中…</div>
      </div>
    )
  return (
    <div className="flex h-full min-h-0" data-testid="gacha-page" data-tpl={active.id}>
      <TemplateList templates={templates} activeId={active.id} />
      <GachaCenter c={active} />
    </div>
  )
}

export function GachaHint() {
  const state = useGachaRun((s) => (s.selTags.length ? 'tags' : s.selPools.length ? 'pools' : 'none'))
  const text = {
    none: 'Space 抽一组 · 单击 tag / 池子选中 · Ctrl / Shift+点击 多选 · 右键 tag 打开菜单',
    tags: 'R 重抽选中项 · L 锁定 / 解锁 · Del 本次移除 · Ctrl / Shift+点击 加选 · Esc 返回池子',
    pools: 'R 重抽选中的池子 · L 锁定 / 解锁 · Ctrl+点击 加选池子 · Esc 取消选中',
  }[state]
  return (
    <span className="truncate max-sm:hidden" data-testid="status-hint" data-state={`gacha-${state}`}>
      {text}
    </span>
  )
}
