import { describe, expect, it } from 'vitest'
import { closeConfirm, confirmDelete, confirmSpend, useConfirm } from './confirm'

const spend = { title: 'AI 代理请求生成', body: '', action: '生成', price: 20 }

describe('confirm slot', () => {
  it('a new dialog ends the open one as cancel, so its wait finishes', async () => {
    const first = confirmSpend(spend)
    const second = confirmDelete({ title: '删除？', body: '', action: '删除' })
    await expect(first.ok).resolves.toBe(false)
    expect(useConfirm.getState().ask?.kind).toBe('delete')
    closeConfirm('ok')
    await expect(second).resolves.toBe(true)
    expect(useConfirm.getState().ask).toBeNull()
  })

  it('a handle closes only its own dialog', async () => {
    const mine = confirmSpend(spend)
    const other = confirmSpend(spend)
    await expect(mine.ok).resolves.toBe(false)
    mine.close()
    expect(useConfirm.getState().ask).not.toBeNull()
    other.close()
    await expect(other.ok).resolves.toBe(false)
    expect(useConfirm.getState().ask).toBeNull()
  })
})
