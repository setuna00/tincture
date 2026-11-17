import { beforeEach, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { blankDoc } from './sample'
import { useGen } from './gen'
import { useMarks } from './gallery-marks'
import { useGalleryUi } from './gallery'
import { imageStore, type GenImage } from './storage'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

const docId = 'history-trash-test'
const images = ['a', 'b', 'c', 'd'].map((id, index): GenImage => ({ id, tabId: docId, batch: 'batch', index, createdAt: 4 - index, seed: index, width: 64, height: 64, model: '', mime: 'image/webp', size: 1, doc: blankDoc() }))

beforeEach(() => {
  vi.clearAllMocks()
  useMarks.setState({ trash: { b: 1 }, fav: {} })
  useGen.setState({ history: { [docId]: images }, selected: { [docId]: 'a' } })
  useGalleryUi.getState().set({ selected: ['d'], anchor: 'd' })
})

it('trashes without deleting records or files and skips hidden neighbors', () => {
  const remove = vi.spyOn(imageStore, 'remove')
  useGen.getState().remove(docId, 'a')
  expect(useMarks.getState().trash.a).toBeTypeOf('number')
  expect(useGen.getState().history[docId]).toBe(images)
  expect(useGen.getState().selected[docId]).toBe('c')
  expect(useGalleryUi.getState().selected).toEqual(['d'])
  expect(remove).not.toHaveBeenCalled()
  remove.mockRestore()
})

it('undo restores and reselects the image without changing other trash marks', () => {
  useGen.getState().remove(docId, 'a')
  const options = vi.mocked(toast).mock.calls.at(-1)?.[1]
  const action = options?.action
  if (!action || typeof action !== 'object' || !('onClick' in action)) throw new Error('Missing undo action')
  action.onClick({} as Parameters<typeof action.onClick>[0])
  expect(useMarks.getState().trash).toEqual({ b: 1 })
  expect(useGen.getState().selected[docId]).toBe('a')
})

it('selects the previous visible image when deleting the last one', () => {
  useGen.setState({ selected: { [docId]: 'd' } })
  useGen.getState().remove(docId, 'd')
  expect(useGen.getState().selected[docId]).toBe('c')
})

it('ignores an already trashed or foreign image', () => {
  useGen.getState().remove(docId, 'b')
  useGen.getState().remove(docId, 'foreign')
  expect(toast).not.toHaveBeenCalled()
  expect(useMarks.getState().trash).toEqual({ b: 1 })
})
