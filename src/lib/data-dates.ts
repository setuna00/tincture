import dates from '@/assets/data-dates.json'

export type DateKind = 'fetched' | 'until' | 'edited'
export const KIND_LABEL: Record<DateKind, string> = { fetched: '抓取', until: '截至', edited: '更新' }

export interface DataDateRow {
  key: string
  label: string
  source: string
  kind: DateKind
}

export const DATA_DATE_GROUPS: { title: string; rows: DataDateRow[] }[] = [
  {
    title: 'tag 库',
    rows: [
      { key: 'tags', label: 'tag 名单和作品数', source: 'Danbooru', kind: 'fetched' },
      { key: 'naiOld', label: 'NAI 识别的旧 tag', source: 'NAI 补全核对', kind: 'fetched' },
      { key: 'ratings', label: '分级（用于 NSFW 档位）', source: 'isek-ai/danbooru-tags-2024', kind: 'until' },
      { key: 'cooc', label: '共现（用于推荐）', source: 'newtextdoc1111/danbooru-tag-csv', kind: 'until' },
      { key: 'chars', label: '角色所属作品和性别', source: '按图统计', kind: 'until' },
      { key: 'tree', label: '细分类和 NSFW 档', source: '自行整理', kind: 'edited' },
      { key: 'zh', label: '中文名', source: '自行翻译', kind: 'edited' },
      { key: 'wiki', label: '中文释义', source: '自行编写', kind: 'edited' },
    ],
  },
  {
    title: '画师库',
    rows: [
      { key: 'artists', label: '画师名单和其他名字', source: 'Danbooru', kind: 'fetched' },
      { key: 'artistsPop', label: '画师人气', source: 'isek-ai/danbooru-tags-2024', kind: 'until' },
      { key: 'artistsTop', label: '排名靠前的画师的图片和题材', source: 'Danbooru', kind: 'fetched' },
    ],
  },
  {
    title: '长度条',
    rows: [
      { key: 'tokenizer', label: 'V5 的 tokenizer 词表', source: 'Qwen/Qwen3.5-0.8B', kind: 'fetched' },
      { key: 'tokenizerT5', label: 'V4 / V4.5 的 tokenizer 词表', source: 'google/t5_xxl_true_nli_mixture', kind: 'fetched' },
    ],
  },
]

export const DATA_DATES: Record<string, string> = dates
