import { create } from 'zustand'

export const useStartView = create<{ picking: string | null }>(() => ({ picking: null }))
