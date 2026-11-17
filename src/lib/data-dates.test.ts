import { describe, expect, it } from 'vitest'
import { DATA_DATE_GROUPS, DATA_DATES } from './data-dates'

describe('设置页「数据日期」', () => {
  const rows = DATA_DATE_GROUPS.flatMap((g) => g.rows)

  it('产物里的每个日期都有一行、每一行都有日期（打包脚本新加了 key 要在这里配上名字）', () => {
    expect(rows.map((r) => r.key).sort()).toEqual(Object.keys(DATA_DATES).sort())
  })

  it('日期是 YYYY-MM-DD；数据集「截至」可以只到月', () => {
    for (const r of rows) expect(DATA_DATES[r.key], r.key).toMatch(r.kind === 'until' ? /^\d{4}-\d{2}(-\d{2})?$/ : /^\d{4}-\d{2}-\d{2}$/)
  })
})
