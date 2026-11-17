import { describe, expect, test } from 'vitest'
import { pageCount, pageMove, pageOf } from './suggest-paging'

describe('suggestion paging', () => {
  test('page of an index and page count', () => {
    expect(pageOf(-1)).toBe(0)
    expect(pageOf(0)).toBe(0)
    expect(pageOf(9)).toBe(0)
    expect(pageOf(10)).toBe(1)
    expect(pageOf(59)).toBe(5)
    expect(pageCount(0)).toBe(1)
    expect(pageCount(10)).toBe(1)
    expect(pageCount(11)).toBe(2)
    expect(pageCount(60)).toBe(6)
  })

  test('↓ / ↑ inside a page stay with cmdk', () => {
    expect(pageMove(0, 60, 'down')).toBeNull()
    expect(pageMove(8, 60, 'down')).toBeNull()
    expect(pageMove(15, 60, 'up')).toBeNull()
    expect(pageMove(6, 7, 'down')).toBeNull()
    expect(pageMove(0, 7, 'up')).toBeNull()
  })

  test('↓ on the last row = next page, ↑ on the first row = previous page, wrapping at the ends', () => {
    expect(pageMove(9, 60, 'down')).toBe(10)
    expect(pageMove(10, 60, 'up')).toBe(9)
    expect(pageMove(59, 60, 'down')).toBe(0)
    expect(pageMove(0, 60, 'up')).toBe(59)
    expect(pageMove(19, 23, 'down')).toBe(20)
    expect(pageMove(22, 23, 'down')).toBe(0)
    expect(pageMove(0, 23, 'up')).toBe(22)
  })

  test('PgDn / PgUp = first row of the next / previous page, no wrap', () => {
    expect(pageMove(0, 60, 'pageDown')).toBe(10)
    expect(pageMove(13, 60, 'pageDown')).toBe(20)
    expect(pageMove(13, 60, 'pageUp')).toBe(0)
    expect(pageMove(4, 60, 'pageUp')).toBeNull()
    expect(pageMove(52, 60, 'pageDown')).toBeNull()
    expect(pageMove(15, 23, 'pageDown')).toBe(20)
    expect(pageMove(3, 7, 'pageDown')).toBeNull()
    expect(pageMove(-1, 60, 'pageDown')).toBe(10)
    expect(pageMove(-1, 0, 'pageDown')).toBeNull()
  })
})
