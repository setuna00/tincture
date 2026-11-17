import { makeThumb } from './thumb-core'

self.onmessage = async (e: MessageEvent<{ id: number; blob: Blob }>) => {
  const { id, blob } = e.data
  try {
    self.postMessage({ id, blob: await makeThumb(blob) })
  } catch (err) {
    self.postMessage({ id, error: String(err) })
  }
}
