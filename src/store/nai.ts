import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { fetchSubscription, NaiError, type NaiAccount } from '@/lib/nai-api'
import { DEFAULT_FILENAME_TEMPLATE } from '@/lib/filename-template'
import { safeStorage } from './storage'

export const TRANSPARENCY_BG = ['checker', 'checkerLight', 'checkerDark', 'none', 'black', 'white', 'gray', 'red', 'green', 'blue', 'custom'] as const
export type TransparencyBg = (typeof TRANSPARENCY_BG)[number]

export interface NaiSettings {
  token: string
  alwaysShowOpus: boolean
  stream: boolean
  rawIntermediates: boolean
  imageFormat: 'png' | 'webp'
  transparencyBg: TransparencyBg
  transparencyColor: string
  /** NAI alpha mode is true for Straight and false for Premultiplied; transparent-image requests send this flag. */
  straightAlpha: boolean
  filenameTemplateOn: boolean
  filenameTemplate: string
  confirmSpend: boolean
}

export type AccountState =
  | { status: 'none' }
  | { status: 'checking'; account?: NaiAccount }
  | { status: 'ok'; account: NaiAccount }
  | { status: 'error'; error: 'unauthorized' | 'network' | 'server'; account?: NaiAccount }

interface NaiState extends NaiSettings {
  account: AccountState
  set(patch: Partial<NaiSettings>): void
  setToken(token: string): void
  refresh(): Promise<void>
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export const NAI_DEFAULTS: NaiSettings = {
  token: '',
  alwaysShowOpus: true,
  stream: !reducedMotion(),
  rawIntermediates: false,
  imageFormat: 'png',
  transparencyBg: 'checker',
  transparencyColor: '#808080',
  straightAlpha: true,
  filenameTemplateOn: false,
  filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
  confirmSpend: true,
}

let seq = 0

export const useNai = create<NaiState>()(
  persist(
    (set, get) => ({
      ...NAI_DEFAULTS,
      account: { status: 'none' },
      set: (patch) => set(patch),
      setToken: (token) => {
        set({ token: token.trim() })
        void get().refresh()
      },
      refresh: async () => {
        const token = get().token
        const my = ++seq
        if (!token) {
          set({ account: { status: 'none' } })
          return
        }
        const prev = get().account
        const kept = prev.status === 'ok' ? prev.account : prev.status !== 'none' ? prev.account : undefined
        set({ account: { status: 'checking', account: kept } })
        try {
          const account = await fetchSubscription(token)
          if (my === seq) set({ account: { status: 'ok', account } })
        } catch (e) {
          if (my !== seq) return
          const kind = e instanceof NaiError ? e.kind : 'network'
          set({ account: { status: 'error', error: kind === 'unauthorized' || kind === 'network' ? kind : 'server', account: kind === 'unauthorized' ? undefined : kept } })
        }
      },
    }),
    {
      name: 'pe:nai',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s): NaiSettings => ({
        token: s.token,
        alwaysShowOpus: s.alwaysShowOpus,
        stream: s.stream,
        rawIntermediates: s.rawIntermediates,
        imageFormat: s.imageFormat,
        transparencyBg: s.transparencyBg,
        transparencyColor: s.transparencyColor,
        straightAlpha: s.straightAlpha,
        filenameTemplateOn: s.filenameTemplateOn,
        filenameTemplate: s.filenameTemplate,
        confirmSpend: s.confirmSpend,
      }),
    },
  ),
)

export const useConnected = () => useNai((s) => s.token !== '')

export const accountOf = (a: AccountState): NaiAccount | null => (a.status === 'none' ? null : (a.account ?? null))

if (typeof window !== 'undefined') queueMicrotask(() => void useNai.getState().refresh())
