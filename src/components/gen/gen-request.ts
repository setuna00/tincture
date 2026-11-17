import { create } from 'zustand'
import { generationPriceParts, maxSamplesForSize, naiModelId, type NaiAccount } from '@/lib/nai-api'
import { effectiveSettings } from '@/lib/nai-write'
import { confirmSpend } from '@/store/confirm'
import { useGen, vibeEncoded } from '@/store/gen'
import { accountOf, useNai } from '@/store/nai'
import { usePrefs } from '@/store/prefs'
import { useVibeCodes } from '@/store/ref-images'
import { getDocStore } from '@/store/tabs'
import type { DocSettings } from '@/types'

export function genPrice(settings: DocSettings, account: NaiAccount | null, have: Set<string>) {
  const eff = effectiveSettings(settings)
  const g = eff.gen
  const n = Math.min(settings.gen.nSamples ?? 1, maxSamplesForSize(g.width, g.height))
  return { n, parts: generationPriceParts(settings, n, account, vibeEncoded(have, naiModelId(eff))) }
}

export type GenAnswer = 'run' | 'cancel' | 'busy'

export const useGenConfirm = create<{ tabId: string | null; back: HTMLElement | null; agent?: (answer: GenAnswer) => void }>(() => ({ tabId: null, back: null }))

export function closeGenConfirm(answer: GenAnswer = 'cancel') {
  const { agent } = useGenConfirm.getState()
  useGenConfirm.setState({ tabId: null, back: null, agent: undefined })
  agent?.(answer)
}

export const genDesc = (n: number) => `将按当前 prompt 和参数生成${n > 1 ? ` ${n} 张` : ''}图片，结果加入历史`
export const AGENT_GEN_TITLE = 'AI 代理请求生成'

export async function requestGenerate(tabId: string, shown = true) {
  const run = () => void useGen.getState().generate(tabId)
  const nai = useNai.getState()
  if (!nai.confirmSpend || useGen.getState().running) return run()
  const { n, parts } = genPrice(getDocStore(tabId).getState().doc.settings, accountOf(nai.account), useVibeCodes.getState().have)
  // Zero means free; negative prices mean unavailable or unknown. generate() must validate those cases.
  if (parts.total <= 0) return run()
  if (!shown) {
    if (await confirmSpend({ title: '生成', body: genDesc(n), action: '生成', price: parts.total }).ok) run()
    return
  }
  const el = document.activeElement
  usePrefs.getState().set({ rightTab: 'gen', exportOpen: true })
  useGenConfirm.setState({ tabId, back: el instanceof HTMLElement && el !== document.body ? el : null })
}

let agentDialog: ReturnType<typeof confirmSpend> | null = null

export async function askAgentGenerate(tabId: string, shown: boolean): Promise<GenAnswer> {
  const { n, parts } = genPrice(getDocStore(tabId).getState().doc.settings, accountOf(useNai.getState().account), useVibeCodes.getState().have)
  if (!shown) {
    agentDialog = confirmSpend({ title: AGENT_GEN_TITLE, body: genDesc(n), action: '生成', price: Math.max(0, parts.total) })
    const ok = await agentDialog.ok
    return ok ? (useGen.getState().running ? 'busy' : 'run') : 'cancel'
  }
  return new Promise((resolve) => useGenConfirm.setState({ tabId, back: null, agent: resolve }))
}

export function dropAgentGenerate() {
  if (useGenConfirm.getState().agent) return closeGenConfirm('cancel')
  agentDialog?.close()
}
