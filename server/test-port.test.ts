import { describe, expect, it } from 'vitest'
import { BAD_PORTS, fetchablePort } from './test-port.ts'

describe('fetchablePort', () => {
  it("fetch() refuses every listed port before connecting ('bad port')", async () => {
    for (const port of BAD_PORTS) {
      const err = await fetch(`http://127.0.0.1:${port}/`).then(
        () => null,
        (e: Error & { cause?: Error }) => e,
      )
      expect(err?.cause?.message, `port ${port}`).toBe('bad port')
    }
  })

  it('a bad port is stopped and port 0 tried again until a fetchable one', async () => {
    const got = [6665, 6666, 6670]
    const log: string[] = []
    const port = await fetchablePort(
      async () => (log.push('start'), got.shift()!),
      async () => void log.push('stop'),
    )
    expect(port).toBe(6670)
    expect(log).toEqual(['start', 'stop', 'start', 'stop', 'start'])
  })
})
