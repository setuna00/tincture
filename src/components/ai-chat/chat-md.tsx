import type { ReactNode } from 'react'

function inline(s: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g
  let at = 0
  let i = 0
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > at) out.push(s.slice(at, m.index))
    out.push(m[1] !== undefined ? <b key={`${key}-${i++}`}>{m[1]}</b> : <code key={`${key}-${i++}`}>{m[2]}</code>)
    at = m.index + m[0].length
  }
  if (at < s.length) out.push(s.slice(at))
  return out
}

export function ChatMd({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: { tag: 'ul' | 'ol'; items: ReactNode[] } | null = null
  const flush = () => {
    if (!list) return
    const L = list.tag
    blocks.push(<L key={`l${blocks.length}`}>{list.items}</L>)
    list = null
  }
  text.split('\n').forEach((line, n) => {
    const m = /^\s*(?:([-*•])|(\d+)[.、)])\s+(.*)$/.exec(line)
    if (m) {
      const tag = m[1] ? 'ul' : 'ol'
      if (list?.tag !== tag) {
        flush()
        list = { tag, items: [] }
      }
      list!.items.push(<li key={n}>{inline(m[3], `i${n}`)}</li>)
      return
    }
    flush()
    if (line.trim()) blocks.push(<p key={n}>{inline(line, `p${n}`)}</p>)
  })
  flush()
  return <div className="chat-md select-text">{blocks}</div>
}
