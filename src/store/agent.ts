// Route agent generation through generate() so it shares the paid-request lock with UI generation and image actions.
import { create } from 'zustand'
import { toast } from 'sonner'
import { listTree, loadCatalog, normalizeListTags } from '@/components/discover/data'
import { rerollRandom } from '@/components/editor/random-ops'
import { askAgentGenerate, dropAgentGenerate } from '@/components/gen/gen-request'
import { aiAgentText, AI_DOC_SCHEMA_IDS, applyPlan, chipWithWeight, planReply, randomLocked, toAiSection, type AiPlan } from '@/lib/ai-doc'
import { checkDocument, withSimilar, type CheckChip } from '@/lib/doc-check'
import { atomVisible, nodeAtoms, nodeCount, UNASSIGNED_PATH, type ListNode } from '@/lib/discover'
import { desktop } from '@/lib/desktop'
import { chipLiteral, parseTagItem } from '@/lib/nai'
import { applyListOps, isBuiltinList, listForAgent, newList, walk, type ListOp } from '@/lib/lists'
import { hasScope } from '@/lib/random-block'
import { toBase64 } from '@/lib/ref-request'
import { aliasOf, lookupTag, matchTags, recommendTags, searchTags } from '@/lib/tagdb'
import { shrinkJpeg } from '@/lib/thumb-core'
import type { TagEntry } from '@/types'
import { useAi } from './ai'
import { aiOptions, reviewAgentPlan } from './ai-import'
import { findSection } from './doc'
import { genBlocked, imageBlob, useGen, type GenFailKind, type GenResult } from './gen'
import { useLibrary } from './library'
import { useLists } from './lists'
import { accountOf, useNai } from './nai'
import { NSFW_MAX_LEVEL, usePrefs } from './prefs'
import { DOC_PRESETS, presetDoc } from './presets'
import { BROWSER_ONLY, imageStore } from './storage'
import { getDocStore, useTabs } from './tabs'
import { useUi } from './ui'
import { recordAiVersion } from './versions'
import type { BuiltinListId } from './prefs'

export type AgentConn = { state: 'off' } | { state: 'connecting' } | { state: 'ready'; client: string; lastCall: number | null }
export const useAgentConn = create<AgentConn>(() => ({ state: 'off' }))

class ToolError extends Error {}

const args = <T>(a: unknown) => (a && typeof a === 'object' ? a : {}) as T
const json = (v: unknown) => JSON.stringify(v, null, 2)
const maxLevel = () => NSFW_MAX_LEVEL[usePrefs.getState().nsfw]
const written = (t: TagEntry) => (t.category === 'artist' ? chipLiteral({ type: 'artist', text: t.name }) : t.name)
const tagOut = (t: TagEntry) => ({ name: written(t), zh: t.zh || undefined, category: t.category, count: t.nai ? undefined : t.count, nsfw: t.level ?? 0 })
function libName(raw: string): string {
  const c = parseTagItem(raw)[0]
  if (!c) return raw.trim().toLowerCase()
  return (c.type === 'year' ? chipLiteral(c) : c.text).toLowerCase()
}

function docTabs() {
  const { order, starts, activeId } = useTabs.getState()
  return order.filter((id) => !starts.includes(id)).map((id) => ({ tab: id, title: getDocStore(id).getState().doc.meta.title || '未命名', active: id === activeId }))
}
function tabOf(ref: unknown): string {
  const tabs = docTabs()
  if (typeof ref === 'string' && ref) {
    if (!tabs.some((t) => t.tab === ref)) throw new ToolError(`No open tab "${ref}"; call get_editor_state for the open tabs.`)
    return ref
  }
  const active = tabs.find((t) => t.active)
  if (!active) throw new ToolError('The active tab has no document (it shows the new-tab page); ask the user to open one, or pass `tab`.')
  return active.tab
}

const BUILTIN = ['a', 'b', 'c'] as const

async function browse(list: BuiltinListId, path: string, limit: number) {
  const c = await loadCatalog()
  const lv = maxLevel()
  const root = listTree(list)
  const node = path ? byTitles(root, path) : root
  if (!node) throw new ToolError(`No category "${path}" in list "${list}".`)
  const kids = node.children.filter((n) => n.path !== UNASSIGNED_PATH && nodeCount(c, n, lv) > 0)
  if (kids.length) return { list, path, categories: kids.map((k) => ({ title: k.title, path: path ? `${path}/${k.title}` : k.title, tags: nodeCount(c, k, lv) })) }
  const seen = new Set<string>()
  const tags: TagEntry[] = []
  for (const a of nodeAtoms(node))
    if (atomVisible(c, a, lv))
      for (const t of c.byAtom.get(a) ?? [])
        if ((t.level ?? 0) <= lv && !seen.has(t.name)) {
          seen.add(t.name)
          tags.push(t)
        }
  tags.sort((a, b) => b.count - a.count)
  return { list, path, total: tags.length, tags: tags.slice(0, limit).map(tagOut) }
}
function byTitles(root: ListNode, path: string): ListNode | undefined {
  let cur: ListNode | undefined = root
  for (const part of path.split('/').map((s) => s.trim()).filter(Boolean)) cur = cur?.children.find((k) => k.title === part)
  return cur
}

async function lookup(names: string[]) {
  const c = await loadCatalog()
  return Promise.all(
    names.slice(0, 200).map(async (raw) => {
      const k = libName(raw)
      const t = lookupTag(k)
      if (t) {
        const to = c.renamedTo.get(t.name)
        return to ? { tag: raw, status: 'old name', official: to } : { tag: raw, status: 'known', ...tagOut(t) }
      }
      const a = aliasOf(k)
      if (a) return { tag: raw, status: 'alias', official: c.renamedTo.get(a) ?? a }
      const similar = (await matchTags(k, 5)).map((s) => written(s.tag))
      return { tag: raw, status: 'unknown', similar }
    }),
  )
}

const placeOut = (x: CheckChip) => ({
  tag: x.tag,
  ...(x.weight !== 1 ? { weight: x.weight } : {}),
  ...(x.disabled ? { disabled: true } : {}),
  section: x.sectionId,
  section_name: x.sectionName,
  box: x.field,
  ...(x.character ? { character: x.character.id, character_name: x.character.name } : {}),
})

async function checkDocumentTool(a: { tab?: string }) {
  const tabId = tabOf(a.tab)
  const c = await loadCatalog()
  const r = await withSimilar(checkDocument(getDocStore(tabId).getState().doc, { variants: useLibrary.getState().variants, renamedTo: c.renamedTo }))
  return json({
    tab: tabId,
    unknown: r.unknown.map((x) => ({ ...placeOut(x), similar: x.similar ?? [] })),
    alias: r.alias.map((x) => ({ ...placeOut(x), official: x.official })),
    old_name: r.oldName.map((x) => ({ ...placeOut(x), new_name: x.newName })),
    duplicate: r.duplicate.map((d) => ({ tag: d.tag, copies: d.copies.map(placeOut) })),
    nai_duplicate: r.naiDuplicate.map((x) => ({ ...placeOut(x), added_by: x.addedBy })),
  })
}

async function editDocument(a: { tab?: string; reply?: unknown; request?: string }) {
  const tabId = tabOf(a.tab)
  let raw = a.reply
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      throw new ToolError('`reply` must be a JSON object.')
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ToolError('`reply` must be a JSON object.')
  const reply = raw as Record<string, unknown>
  if (!AI_DOC_SCHEMA_IDS.includes(reply.$schema as string)) throw new ToolError('`reply` needs "$schema": "pe-doc-ai/2" (see read_document).')
  const store = getDocStore(tabId)
  const plan = planReply(store.getState().doc, reply, aiOptions())
  const request = (a.request ?? '').trim().slice(0, 500)
  const skipped = plan.skipped.length ? plan.skipped : undefined
  if (!plan.changes.length) return json({ applied: 0, note: 'The reply matches the document; nothing to change.', skipped })

  if (useAi.getState().agent.mode === 'direct') {
    const picks = new Set(plan.changes.filter((c) => c.defaultOn).map((c) => c.key))
    if (!picks.size) return json({ applied: 0, note: 'None of the ids matched this document (wrong tab?); nothing was applied.', changes: lines(plan, picks) })
    const before = store.getState().doc
    store.getState().applyDoc(applyPlan(before, plan, picks))
    const after = store.getState().doc
    const undo = () => (store.getState().doc === after ? store.temporal.getState().undo() : store.getState().replaceDoc(before))
    toast(`已应用 AI 代理的 ${picks.size} 处修改`, { description: after.meta.title || undefined, action: { label: '撤销', onClick: undo } })
    if (after !== before) void recordAiVersion(after, picks.size, request || undefined)
    return json({ applied: picks.size, of: plan.changes.length, changes: lines(plan, picks), skipped })
  }

  useTabs.getState().activate(tabId)
  if (location.hash.replace(/^#\/?/, '')) location.hash = '/'
  useUi.getState().blur()
  desktop?.flash()
  const r = await reviewAgentPlan(tabId, plan, request)
  if (r === 'cancelled') return json({ applied: 0, of: plan.changes.length, note: 'The user closed the review without applying anything.' })
  if (r === 'replaced') return json({ applied: 0, of: plan.changes.length, note: 'The review was replaced by another one before the user applied it; nothing was applied.' })
  const picks = new Set(r.applied)
  return json({ applied: picks.size, of: plan.changes.length, changes: lines(plan, picks), skipped })
}
const lines = (plan: AiPlan, picks: ReadonlySet<string>) => plan.changes.map((c) => `${picks.has(c.key) ? 'applied' : 'not applied'}: ${c.line}`)

async function editList(a: { list?: string; create?: string; ops?: ListOp[] }) {
  const c = await loadCatalog()
  const st = useLists.getState()
  const before = st.lists
  let list = a.list ? before.find((l) => l.id === a.list) : undefined
  let created = false
  if (a.list && isBuiltinList(a.list)) throw new ToolError('Built-in lists are read-only; create a new list instead.')
  if (a.create?.trim()) {
    const name = a.create.trim()
    if (before.some((l) => l.name === name)) throw new ToolError(`A list named "${name}" already exists (${before.find((l) => l.name === name)!.id}).`)
    list = newList(name)
    created = true
  }
  if (!list) throw new ToolError(a.list ? `No list "${a.list}"; call list_lists.` : 'Pass `list` (an id) or `create` (a name).')
  const ops = Array.isArray(a.ops) ? a.ops : []
  const r = applyListOps(list, ops, (tags) => normalizeListTags(tags, c))
  if (r.list.name !== list.name && before.some((l) => l.id !== list.id && l.name === r.list.name)) throw new ToolError(`A list named "${r.list.name}" already exists.`)
  const next = created ? [...before, r.list] : before.map((l) => (l.id === list.id ? r.list : l))
  if (created || r.list !== list) {
    st.replaceLists(next)
    const after = useLists.getState().lists
    const undo = () => (useLists.getState().lists === after ? useLists.getState().undo() : useLists.getState().replaceLists(before))
    toast(created ? `AI 代理已新建 list「${r.list.name}」` : `AI 代理已修改 list「${r.list.name}」`, { action: { label: '撤销', onClick: undo } })
  }
  let tags = 0
  walk(r.list.nodes, (n) => (tags += n.tags.length))
  return json({ list: r.list.id, name: r.list.name, created: created || undefined, tags, log: r.log })
}

function newDocument(a: { title?: unknown }) {
  const title = (typeof a.title === 'string' ? a.title.trim().slice(0, 200) : '') || '未命名'
  const tabs = useTabs.getState()
  const tab = tabs.newTab()
  tabs.openInTab(tab, presetDoc(DOC_PRESETS.find((p) => p.id === 'blank')!, title))
  return json({ tab, title, note: 'This is now the active tab. Call read_document for its section ids, then edit_document.' })
}

async function rerollSection(a: { tab?: string; section?: unknown }) {
  const tabId = tabOf(a.tab)
  const id = typeof a.section === 'string' ? a.section.trim() : ''
  if (!id) throw new ToolError('`section` is required: a random section id from read_document.')
  const store = getDocStore(tabId)
  const f = findSection(store.getState().doc, id)
  if (!f) throw new ToolError(`No section "${id}" in tab ${tabId}; call read_document for the ids.`)
  const rule = f.section.random
  if (!rule) throw new ToolError(`Section "${id}" is not a random section; read_document lists the random sections after the document.`)
  if (!hasScope(rule)) throw new ToolError(`Random section "${id}" has no range yet, so it cannot draw; ask the user to choose its range in Tincture.`)
  if (rule.lockAll) return json({ tab: tabId, section: id, tags: toAiSection(f.section).tags, drawn: [], note: 'The whole section is locked; nothing changed.' })
  const before = new Set(f.section.chips.map((c) => c.id))
  await rerollRandom(store, id)
  const now = findSection(store.getState().doc, id)?.section
  if (!now) throw new ToolError(`Section "${id}" was deleted while drawing.`)
  const drawn = now.chips.filter((c) => !before.has(c.id) && !c.disabled).map(chipWithWeight)
  const locked = randomLocked(now)
  return json({
    tab: tabId,
    section: id,
    tags: toAiSection(now).tags,
    drawn,
    ...(locked.length ? { locked } : {}),
    ...(drawn.length ? {} : { note: 'Nothing new was drawn: the range has nothing else to draw.' }),
  })
}

// Must stay below the server's AGENT_TIMEOUTS.reviewMs (15 min): the remainder is the generation budget after the user confirms.
export const GEN_CONFIRM_MS = 12 * 60_000
// Pace agent generations: wait gapMs after the last generation by anyone; answer busy if one starts while waiting.
export const AGENT_GEN = { gapMs: 15_000 }
let lastGenEnd = 0
useGen.subscribe((s, p) => {
  if (p.running && !s.running) lastGenEnd = Date.now()
})

/** Resolves false if `running` turns on during the wait; the caller must then answer busy instead of generating. */
function waitGap(ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off()
      resolve(true)
    }, ms)
    const off = useGen.subscribe((s) => {
      if (!s.running) return
      clearTimeout(timer)
      off()
      resolve(false)
    })
  })
}
const AGENT_IMAGE_PX = 768

const GEN_FAIL_TEXT: Record<GenFailKind, string> = {
  no_token: 'No NovelAI token is set in Tincture, so it cannot generate. Ask the user to fill in the NAI token (Settings → NAI 账号).',
  generating: 'Tincture is already generating; nothing was queued. Try again after it finishes.',
  too_long: "The document's size and steps are over NovelAI's limit for one image; change them with edit_document.",
  unchanged: 'The seed is fixed and nothing changed since the last generation; change the document or clear the seed.',
  reference: 'A reference image in the document cannot be read, or too many character references are on.',
  failed: 'Some images failed.',
  unauthorized: 'NovelAI rejected the token (401); ask the user to set a valid NAI token.',
  anlas: 'Not enough Anlas (402).',
  busy: 'NovelAI is busy with another generation on this account, or requests are too frequent (429); try again later.',
  network: 'Cannot reach NovelAI (network error).',
  timeout: 'NovelAI did not answer within 120 seconds.',
  server: 'NovelAI returned an error.',
}
const failText = (e: NonNullable<GenResult['error']>) => (e.message ? `${GEN_FAIL_TEXT[e.kind]} (${e.message})` : GEN_FAIL_TEXT[e.kind])

/** Refuse overlapping agent confirmations so one call cannot replace another call awaiting permission to spend Anlas. */
let step: 'waiting' | 'asking' | null = null

async function genButtonShown(tabId: string): Promise<boolean> {
  const sel = `[data-testid=gen-footer][data-tab="${CSS.escape(tabId)}"] [data-testid=gen-button]`
  const start = Date.now()
  for (;;) {
    if (window.innerWidth >= 768 && document.querySelector(sel)?.getClientRects().length) return true
    // Animation frames stop in minimized windows; timers still run, though throttled.
    if (Date.now() - start > 1000) return false
    await new Promise((r) => setTimeout(r, 50))
  }
}

async function anlasAfter(): Promise<number | null> {
  const settled = () => useNai.getState().account.status !== 'checking'
  if (!settled())
    await new Promise<void>((done) => {
      const stop = () => {
        clearTimeout(timer)
        off()
        done()
      }
      const timer = setTimeout(stop, 10_000)
      const off = useNai.subscribe(() => settled() && stop())
    })
  return accountOf(useNai.getState().account)?.anlas ?? null
}

async function generateImages(a: { tab?: string }): Promise<AgentReply> {
  let tabId = tabOf(a.tab)
  const blocked = genBlocked(tabId)
  if (blocked) throw new ToolError(GEN_FAIL_TEXT[blocked])
  if (step === 'waiting') throw new ToolError('Another generate call is waiting out the gap between generations; wait for that call to finish.')
  if (step === 'asking') throw new ToolError('Tincture is already asking the user to confirm another generate; wait for that call to finish.')
  const start = Date.now()
  const gap = lastGenEnd + AGENT_GEN.gapMs - start
  if (gap > 0) {
    step = 'waiting'
    let free
    try {
      free = await waitGap(gap)
    } finally {
      step = null
    }
    if (!free) throw new ToolError(`A generation started while Tincture was waiting between generations. ${GEN_FAIL_TEXT.generating}`)
    // Recheck after waiting: the tab, document and paid-request lock may have changed.
    tabId = tabOf(tabId)
    const now = genBlocked(tabId)
    if (now) throw new ToolError(GEN_FAIL_TEXT[now])
  }
  const waited = Math.round((Date.now() - start) / 100) / 10
  if (useAi.getState().agent.gen === 'confirm') {
    step = 'asking'
    let answer
    try {
      useTabs.getState().activate(tabId)
      if (location.hash.replace(/^#\/?/, '')) location.hash = '/'
      useUi.getState().blur()
      usePrefs.getState().set({ rightTab: 'gen', exportOpen: true })
      desktop?.flash()
      const shown = await genButtonShown(tabId)
      const timer = setTimeout(dropAgentGenerate, GEN_CONFIRM_MS)
      answer = await askAgentGenerate(tabId, shown).finally(() => clearTimeout(timer))
    } finally {
      step = null
    }
    if (answer === 'busy') throw new ToolError(GEN_FAIL_TEXT.generating)
    if (answer === 'cancel') return json({ tab: tabId, generated: 0, waited_seconds: waited, note: 'The user did not confirm; nothing was generated.' })
  }
  const before = accountOf(useNai.getState().account)?.anlas ?? null
  const r = await useGen.getState().generate(tabId)
  if (!r.images.length) throw new ToolError(failText(r.error ?? { kind: 'failed', message: 'no image came back' }))
  const [left, images, paths] = await Promise.all([
    anlasAfter(),
    Promise.all(r.images.map(async (img) => ({ data: await toBase64(await shrinkJpeg(await imageBlob(img), AGENT_IMAGE_PX)), mimeType: 'image/jpeg' }))),
    Promise.all(r.images.map((img) => imageStore.path(img.id))),
  ])
  const text = json({
    tab: tabId,
    version: r.images[0].version ?? null,
    waited_seconds: waited,
    images: r.images.map((img, i) => ({ seed: img.seed, width: img.width, height: img.height, path: paths[i] })),
    anlas_spent: before !== null && left !== null ? Math.max(0, before - left) : null,
    anlas_left: left,
    ...(r.error ? { error: failText(r.error) } : {}),
  })
  return { text, images }
}

type AgentReply = string | { text: string; images: { data: string; mimeType: string }[] }

export async function runAgentTool(tool: string, input: unknown): Promise<AgentReply> {
  switch (tool) {
    case 'get_editor_state':
      return json({ tabs: docTabs() })
    case 'new_document':
      return newDocument(args(input))
    case 'reroll_random':
      return rerollSection(args(input))
    case 'read_document': {
      const tabId = tabOf(args<{ tab?: string }>(input).tab)
      return `tab: ${tabId}\n\n${aiAgentText(getDocStore(tabId).getState().doc, aiOptions())}`
    }
    case 'edit_document':
      return editDocument(args(input))
    case 'search_tags': {
      const a = args<{ query?: string; limit?: number }>(input)
      if (!a.query?.trim()) throw new ToolError('`query` is required.')
      const hits = await searchTags(a.query.trim(), Math.min(Math.max(a.limit ?? 20, 1), 50))
      return json(hits.map((h) => tagOut(h.tag)))
    }
    case 'lookup_tags': {
      const a = args<{ tags?: unknown }>(input)
      if (!Array.isArray(a.tags)) throw new ToolError('`tags` must be an array of strings.')
      return json(await lookup(a.tags.map(String)))
    }
    case 'check_document':
      return checkDocumentTool(args(input))
    case 'related_tags': {
      const a = args<{ tag?: string; limit?: number }>(input)
      const t = a.tag?.trim() ? libName(a.tag) : ''
      if (!t) throw new ToolError('`tag` is required.')
      const name = lookupTag(t)?.name ?? aliasOf(t)
      if (!name) throw new ToolError(`"${a.tag}" is not in the tag library; try search_tags.`)
      const recs = await recommendTags([{ name, weight: 1 }], [name], Math.min(Math.max(a.limit ?? 20, 1), 50))
      return json(recs.flatMap((r) => (lookupTag(r.name) ? [tagOut(lookupTag(r.name)!)] : [])))
    }
    case 'browse_categories': {
      const a = args<{ list?: string; path?: string; limit?: number }>(input)
      const list = (BUILTIN as readonly string[]).includes(a.list ?? '') ? (a.list as BuiltinListId) : 'a'
      return json(await browse(list, a.path?.trim() ?? '', Math.min(Math.max(a.limit ?? 100, 1), 500)))
    }
    case 'list_lists':
      return json(
        useLists.getState().lists.map((l) => {
          let nodes = 0
          let tags = 0
          walk(l.nodes, (n) => {
            nodes++
            tags += n.tags.length
          })
          return { id: l.id, name: l.name, nodes, tags }
        }),
      )
    case 'read_list': {
      const id = args<{ list?: string }>(input).list
      const l = useLists.getState().lists.find((x) => x.id === id)
      if (!l) throw new ToolError(isBuiltinList(id ?? '') ? 'Built-in lists are read through browse_categories.' : `No list "${id}"; call list_lists.`)
      return json(listForAgent(l))
    }
    case 'edit_list':
      return editList(args(input))
    case 'generate':
      return generateImages(args(input))
    default:
      throw new ToolError(`Unknown tool: ${tool}`)
  }
}

let source: EventSource | null = null

async function answer(id: string, tool: string, input: unknown) {
  let ok = true
  let reply: AgentReply
  try {
    reply = await runAgentTool(tool, input)
  } catch (e) {
    ok = false
    reply = e instanceof ToolError ? e.message : `Tincture failed: ${e instanceof Error ? e.message : String(e)}`
    if (!(e instanceof ToolError)) console.error('AI 代理的工具出错', tool, e)
  }
  const body = typeof reply === 'string' ? { id, ok, text: reply } : { id, ok, ...reply }
  await fetch('/api/agent/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {})
}

function connect() {
  if (source) return
  useAgentConn.setState({ state: 'connecting' }, true)
  // No manual re-subscribe: EventSource reconnects by itself after a backend restart or sleep.
  const es = new EventSource('/api/agent/events')
  source = es
  es.onmessage = (e) => {
    const m = JSON.parse(e.data as string) as { type: string; id?: string; tool?: string; args?: unknown; client?: string }
    const cur = useAgentConn.getState()
    const prev = cur.state === 'ready' ? cur : { client: '', lastCall: null }
    if (m.type === 'ready') useAgentConn.setState({ state: 'ready', client: prev.client, lastCall: prev.lastCall }, true)
    else if (m.type === 'client') useAgentConn.setState({ state: 'ready', client: m.client ?? '', lastCall: prev.lastCall }, true)
    else if (m.type === 'call' && m.id && m.tool) {
      useAgentConn.setState({ state: 'ready', client: m.client || prev.client, lastCall: Date.now() }, true)
      void answer(m.id, m.tool, m.args)
    }
  }
  es.onerror = () => {
    if (source === es && es.readyState !== EventSource.OPEN) useAgentConn.setState({ state: 'connecting' }, true)
  }
}

function disconnect() {
  source?.close()
  source = null
  useAgentConn.setState({ state: 'off' }, true)
}

export function startAgentBridge() {
  if (BROWSER_ONLY) return () => {}
  const sync = (on: boolean) => (on ? connect() : disconnect())
  sync(useAi.getState().agent.on)
  const off = useAi.subscribe((s, p) => s.agent.on !== p.agent.on && sync(s.agent.on))
  return () => {
    off()
    disconnect()
  }
}
