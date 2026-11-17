import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { PaneHeader } from '@/components/assistant/panel'
import { toast } from 'sonner'
import { Add01Icon, AiChat02Icon, AiImageIcon, ArrowDown01Icon, Cancel01Icon, Copy01Icon, Delete02Icon, FileAddIcon, Folder01Icon, InformationCircleIcon, Key01Icon, Tick02Icon, ViewIcon, ViewOffIcon } from '@hugeicons/core-free-icons'
import { VERSION } from '@/App'
import { cn } from 'cn'
import { ChipFace, chipAttrs } from '@/components/editor/chip-face'
import { sectionVars } from '@/components/editor/labels'
import { TagSuggest, useTagSuggest } from '@/components/editor/tag-suggest'
import { isSuggestKey } from '@/lib/suggest-paging'
import { GenderIcon } from '@/components/gender'
import { composing } from '@/components/draft-field'
import { Icon } from '@/components/icon'
import type { IconSvgElement } from '@hugeicons/react'
import { Seg } from '@/components/seg'
import { DefaultSettingsCards } from '@/components/settings-panel'
import { Button } from '@/components/ui/button'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/tip'
import { DATA_DATE_GROUPS, DATA_DATES, KIND_LABEL, type DataDateRow } from '@/lib/data-dates'
import { DEFAULT_FILENAME_TEMPLATE, renderFilename, TemplateError, type FilenameMeta } from '@/lib/filename-template'
import { TIER_NAME } from '@/lib/nai-api'
import { isV5Default } from '@/lib/doc-defaults'
import { cleanTags, defTags, GENDER_LABEL, GENDER_PRESETS, GENDERS, presetVisible, type CustomGender } from '@/lib/gender'
import { parseNodeText } from '@/lib/lists'
import { looksLikePromptString, newId, parsePrompt, toChip } from '@/lib/nai'
import { lookupTag } from '@/lib/tagdb'
import { useGen } from '@/store/gen'
import { TRANSPARENCY_BG, useNai, type TransparencyBg } from '@/store/nai'
import { AI_PRESETS, aiErrorText, newRuleId, newServiceId, presetOf, serviceKey, serviceName, useAi, type AgentGen, type AgentMode, type AiConn, type AiPresetId, type AiRule, type AiServiceConf } from '@/store/ai'
import { useAgentConn, type AgentConn } from '@/store/agent'
import { formatTime } from '@/lib/format-time'
import { desktop } from '@/lib/desktop'
import { clearSettingsPage, pendingSettingsPage, pendingSettingsTarget, type SettingsPageId } from '@/lib/settings-nav'
import { BROWSER_ONLY, changeLibraryDir, libraryDir, revealLibraryDir } from '@/store/storage'
import { NSFW_MAX_LEVEL, nsfwOf, usePrefs, type ChatEntry, type ChatSendKey } from '@/store/prefs'
import type { Gender, TagEntry } from '@/types'

const NSFW_HINT = {
  off: '仅显示全年龄 tag（含泳装、内衣等）；画师库仅使用一般 / 敏感分级的图片',
  on: '显示露骨 tag；画师库使用全部分级的图片',
}

const ALL_PAGES: readonly { id: SettingsPageId; title: string; icon: IconSvgElement }[] = [
  { id: 'account', title: 'NAI 账号', icon: Key01Icon },
  { id: 'gen', title: '出图', icon: AiImageIcon },
  { id: 'defaults', title: '新文档', icon: FileAddIcon },
  { id: 'content', title: '内容', icon: ViewIcon },
  { id: 'ai', title: 'AI', icon: AiChat02Icon },
  { id: 'library', title: '图库', icon: Folder01Icon },
  { id: 'about', title: '关于', icon: InformationCircleIcon },
]
const PAGES = ALL_PAGES.filter((g) => !BROWSER_ONLY || (g.id !== 'library' && g.id !== 'ai'))

const NARROW = '(max-width: 767.98px)'
const subscribeNarrow = (cb: () => void) => {
  const mq = matchMedia(NARROW)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
const useNarrow = () => useSyncExternalStore(subscribeNarrow, () => matchMedia(NARROW).matches)

function flash(el: HTMLElement) {
  const on = `color-mix(in oklab, ${getComputedStyle(el).getPropertyValue('--accent')} 24%, transparent)`
  return el.animate([{ backgroundColor: on }, { backgroundColor: on, offset: 0.31 }, { backgroundColor: 'transparent' }], { duration: 1600, easing: 'ease-out' })
}

export function SettingsPage() {
  const [jumpTo] = useState(() => PAGES.find((x) => x.id === pendingSettingsPage())?.id ?? null)
  const [target] = useState(pendingSettingsTarget)
  const [active, setActive] = useState<SettingsPageId>(jumpTo ?? 'account')
  const narrow = useNarrow()
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    clearSettingsPage()
    if (!jumpTo) return
    const el = body.current?.querySelector<HTMLElement>(`[data-jump-target="${target || 'true'}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'nearest' })
    if (!target) el.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
    const a = flash(el)
    return () => a.cancel() // React StrictMode reruns effects; cancel the first animation so highlights do not stack.
  }, [jumpTo, target])
  return (
    <div className="relative flex h-full min-h-0" data-testid="settings-page">
      <div className="wco-backdrop bg-work" />
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-line bg-shell max-md:w-14" data-testid="settings-nav">
        <PaneHeader title={<span className="max-md:hidden">设置</span>} />
        <nav className="flex flex-col gap-0.5 p-2">
          {PAGES.map((g) => (
            <Tip key={g.id} label={narrow ? g.title : undefined} side="right" sideOffset={6}>
              <button
                type="button"
                className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-ink-2 transition-colors duration-(--dur-fast) hover:bg-surface-2 hover:text-ink-1 data-[active]:bg-surface-2 data-[active]:font-medium data-[active]:text-ink-1 max-md:justify-center max-md:px-0"
                data-active={active === g.id ? '' : undefined}
                onClick={() => setActive(g.id)}
                aria-label={g.title}
                aria-current={active === g.id ? 'page' : undefined}
                data-testid={`settings-nav-${g.id}`}
              >
                <Icon icon={g.icon} size={16} className="shrink-0" />
                <span className="truncate max-md:hidden">{g.title}</span>
              </button>
            </Tip>
          ))}
        </nav>
        <p className="mt-auto border-t border-line px-3 py-2 text-[11px] leading-relaxed text-ink-2 max-md:hidden">对所有页面生效</p>
      </aside>
      <ScrollArea key={active} className="h-full min-w-0 flex-1 bg-work">
        <div
          ref={body}
          className="animate-in duration-180 ease-(--ease-out) fade-in-0 slide-in-from-bottom-1 motion-reduce:slide-in-from-bottom-0"
          data-page={active}
          data-testid="app-settings"
        >
          {active === 'account' && <AccountSettings />}
          {active === 'gen' && <GenSettings />}
          {active === 'defaults' && (
            <Page title="新文档的默认设置" sub="仅作用于新建的文档" action={<ResetDefaults />} testId="doc-defaults">
              <DefaultSettingsCards />
            </Page>
          )}
          {active === 'content' && <ContentSettings />}
          {active === 'ai' && <AiSettings />}
          {active === 'library' && <LibrarySettings />}
          {active === 'about' && <AboutSettings />}
        </div>
      </ScrollArea>
    </div>
  )
}

function ContentSettings() {
  const nsfw = usePrefs((s) => s.nsfw)
  const r18gOn = usePrefs((s) => s.r18gOn)
  const set = usePrefs((s) => s.set)
  const on = nsfw !== 'off'
  return (
    <Page title="内容" sub="作用于补全、「可能是」、区块推荐、替换候选和画师库，不影响文档中已有的 tag">
      <Section title="NSFW">
        <div data-jump-target>
          <Row label="显示 NSFW 内容" hint={NSFW_HINT[on ? 'on' : 'off']}>
            <Switch checked={on} onCheckedChange={(v) => set({ nsfw: nsfwOf(v, r18gOn) })} aria-label="显示 NSFW 内容" data-testid="set-nsfw" />
          </Row>
        </div>
        <div className="transition-opacity duration-200 data-[off]:opacity-45" data-off={on ? undefined : ''} data-testid="set-r18g-row">
          <Row label="显示 R18G / 重口内容" hint="显示猎奇、排泄类 tag" indent>
            <Switch className="data-disabled:opacity-100" checked={r18gOn} disabled={!on} onCheckedChange={(v) => set({ r18gOn: v, nsfw: nsfwOf(on, v) })} aria-label="显示 R18G / 重口内容" data-testid="set-r18g" />
          </Row>
        </div>
      </Section>
      <Section title="角色">
        <MoreGenders />
      </Section>
    </Page>
  )
}

function AboutSettings() {
  return (
    <Page title="关于">
      <Section>
        <div className="flex items-baseline gap-6 px-4 py-3">
          <span className="flex-1 text-[13px] text-ink-1">版本</span>
          <span className="text-[13px] text-ink-2 tabular-nums" data-testid="about-version">
            {VERSION}
          </span>
        </div>
      </Section>
      <Section title="数据日期" testId="data-dates">
        {DATA_DATE_GROUPS.map((g) => (
          <div key={g.title} className="px-4 pt-2.5 pb-2">
            <div className="pb-1 text-(length:--fs-label) font-semibold tracking-(--tracking-label) text-ink-2">{g.title}</div>
            {g.rows.map((r) => (
              <DateRow key={r.key} row={r} />
            ))}
          </div>
        ))}
      </Section>
    </Page>
  )
}

function Page({ title, sub, action, testId, children }: { title: string; sub?: string; action?: ReactNode; testId?: string; children: ReactNode }) {
  return (
    <div className="flex max-w-[860px] flex-col gap-7 px-8 pt-7 pb-16 max-md:px-4" data-testid={testId}>
      <header className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-[20px] font-semibold text-ink-1">{title}</h1>
          {sub && <p className="text-[12px] text-ink-2">{sub}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      {children}
    </div>
  )
}

function Section({ title, sub, testId, jump, children }: { title?: string; sub?: string; testId?: string; jump?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      {title && (
        <div className="flex items-baseline gap-2 px-1">
          <h2 className="text-[13px] font-semibold text-ink-1">{title}</h2>
          {sub && <span className="text-[12px] text-ink-2">{sub}</span>}
        </div>
      )}
      <div className="divide-y divide-line overflow-hidden rounded-lg border border-line-strong" data-jump-target={jump}>
        {children}
      </div>
    </section>
  )
}

function DateRow({ row: { key, label, source, kind } }: { row: DataDateRow }) {
  return (
    <div
      className="grid grid-cols-[13rem_minmax(0,1fr)_auto] items-baseline gap-x-4 py-1 max-md:grid-cols-[minmax(0,1fr)_auto] max-md:py-1.5"
      data-testid="data-date-row"
      data-key={key}
    >
      <span className="text-[13px] text-ink-1 max-md:col-start-1 max-md:row-start-1">{label}</span>
      <Tip label={source}>
        <span className="truncate text-[12px] text-ink-2 max-md:col-span-2 max-md:row-start-2">
          {source}
        </span>
      </Tip>
      <span className="flex items-baseline gap-1.5 max-md:col-start-2 max-md:row-start-1">
        <span className="text-[12px] text-ink-2">{KIND_LABEL[kind]}</span>
        <span className="w-[10ch] text-[12px] text-ink-2 tabular-nums" data-testid="data-date-value">
          {DATA_DATES[key] ?? '—'}
        </span>
      </span>
    </div>
  )
}

function ResetDefaults() {
  const saved = usePrefs((s) => s.docDefaults)
  const set = usePrefs((s) => s.set)
  const reset = () => {
    set({ docDefaults: null })
    toast('已恢复 V5 默认', { action: { label: '撤销', onClick: () => set({ docDefaults: saved }) } })
  }
  return (
    <Button variant="ghost" size="sm" className="text-ink-2" disabled={isV5Default(saved)} onClick={reset} data-testid="doc-defaults-reset">
      恢复 V5 默认
    </Button>
  )
}

function Row({ label, hint, note, indent, children }: { label: string; hint?: string; note?: string; indent?: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex items-start gap-6 px-4 py-3 max-md:flex-col max-md:gap-2', indent && 'pl-10')}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[13px] text-ink-1">{label}</span>
        {hint && (
          <span className="text-[12px] text-ink-2" data-testid="settings-hint">
            {hint}
          </span>
        )}
        {note && <span className="text-[12px] text-ink-3">{note}</span>}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  )
}

const TRANSPARENCY_LABEL: Record<TransparencyBg, string> = {
  checker: '棋盘格（跟随主题）',
  checkerLight: '浅色棋盘格',
  checkerDark: '深色棋盘格',
  none: '无',
  black: '黑',
  white: '白',
  gray: '灰',
  red: '红',
  green: '绿',
  blue: '蓝',
  custom: '自定义颜色',
}

function GenSettings() {
  const nai = useNai()
  const set = nai.set
  return (
    <Page title="出图" testId="gen-settings">
      <Section title="生成">
        <Row label="流式出图" hint={nai.stream ? '生成时显示中间图' : '生成时仅显示进度'}>
          <Switch checked={nai.stream} onCheckedChange={(v) => set({ stream: v })} aria-label="流式出图" data-testid="set-stream" />
        </Row>
        <div className="transition-opacity duration-200 data-[off]:opacity-45" data-off={nai.stream ? undefined : ''}>
          <Row label="流式中间图不处理" hint={nai.rawIntermediates ? '中间图原样显示' : '中间图模糊处理，隐藏前 5 步'} indent>
            <Switch className="data-disabled:opacity-100" checked={nai.rawIntermediates} disabled={!nai.stream} onCheckedChange={(v) => set({ rawIntermediates: v })} aria-label="流式中间图不处理" data-testid="set-raw" />
          </Row>
        </div>
        <Row label="Alpha 模式" hint={nai.straightAlpha ? 'Straight：透明背景生成时颜色不预乘 alpha' : 'Premultiplied：透明背景生成时颜色预乘 alpha'}>
          <Seg value={nai.straightAlpha ? 'straight' : 'pre'} onChange={(v) => set({ straightAlpha: v === 'straight' })} options={{ straight: 'Straight', pre: 'Premultiplied' }} testId="set-alpha" />
        </Row>
        <Row label="生成前确认" hint={nai.confirmSpend ? '需花费 Anlas 时先确认' : '直接生成；放大、Enhance 等仍先确认'}>
          <Switch checked={nai.confirmSpend} onCheckedChange={(v) => set({ confirmSpend: v })} aria-label="生成前确认" data-testid="set-confirm-spend" />
        </Row>
      </Section>
      <Section title="保存">
        <Row label="图片格式" hint={nai.imageFormat === 'png' ? '保存为 PNG，图片信息写入文本块' : '保存为 NAI 返回的无损 WebP'}>
          <Seg value={nai.imageFormat} onChange={(v) => set({ imageFormat: v })} options={{ png: 'PNG', webp: 'WebP' }} testId="set-format" />
        </Row>
        <FilenameRow />
      </Section>
      <Section title="显示">
        <Row label="透明区域底色" hint="仅影响显示，不写入图片">
          <div className="flex items-center gap-2">
            {nai.transparencyBg === 'custom' && (
              <input
                type="color"
                className="h-7 w-9 cursor-pointer rounded-md border border-line bg-transparent p-0.5"
                value={nai.transparencyColor}
                onChange={(e) => set({ transparencyColor: e.target.value })}
                aria-label="自定义颜色"
                data-testid="set-transparency-color"
              />
            )}
            <Select value={nai.transparencyBg} onValueChange={(v) => set({ transparencyBg: v as TransparencyBg })}>
              <SelectTrigger className="w-40 text-[12px]" aria-label="透明区域底色" data-testid="set-transparency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSPARENCY_BG.map((k) => (
                  <SelectItem key={k} value={k}>
                    {TRANSPARENCY_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Row>
      </Section>
    </Page>
  )
}

function AccountSettings() {
  const nai = useNai()
  return (
    <Page title="NAI 账号" sub="填写 Persistent API Token 后可在编辑器中生成图片">
      <Section>
        <TokenRow />
        <Row label="始终显示 Opus 额度" hint={nai.alwaysShowOpus ? '状态栏显示 Opus 免费额度' : '仅在额度低于 5% 时显示'} note="仅适用于 Opus 订阅">
          <Switch checked={nai.alwaysShowOpus} onCheckedChange={(v) => nai.set({ alwaysShowOpus: v })} aria-label="始终显示 Opus 额度" data-testid="set-always-opus" />
        </Row>
      </Section>
    </Page>
  )
}

function TokenRow() {
  const token = useNai((s) => s.token)
  const account = useNai((s) => s.account)
  const [draft, setDraft] = useState(token)
  const [shown, setShown] = useState(false)
  const commit = (v: string) => {
    if (v.trim() !== useNai.getState().token) useNai.getState().setToken(v)
  }
  useEffect(() => {
    if (draft.trim() === token) return
    const t = setTimeout(() => commit(draft), 600)
    return () => clearTimeout(t)
  }, [draft, token])
  const hint =
    account.status === 'none'
      ? '未填写：仅可通过复制使用'
      : account.status === 'checking'
        ? '验证中…'
        : account.status === 'ok'
          ? `已连接 · ${TIER_NAME[account.account.tier] && account.account.active ? TIER_NAME[account.account.tier] : '无订阅'} · ${account.account.anlas.toLocaleString('en-US')} Anlas`
          : account.error === 'unauthorized'
            ? '无法连接：令牌无效'
            : account.error === 'network'
              ? '无法连接：网络错误'
              : '无法连接 NAI'
  return (
    <div className="flex items-start gap-6 px-4 py-3 max-md:flex-col max-md:gap-2" data-jump-target>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[13px] text-ink-1">NAI 令牌</span>
        <span className={cn('text-[12px]', account.status === 'error' ? 'text-danger' : 'text-ink-2')} data-testid="token-status" data-state={account.status}>
          {hint}
        </span>
        <span className="text-[12px] text-ink-2">在 NAI 的账号设置中点击「Get Persistent API Token」获取；仅发送至 novelai.net</span>
      </div>
      <InputGroup className="w-72 shrink-0">
        <InputGroupInput
          type={shown ? 'text' : 'password'}
          className="font-mono text-[12px]"
          value={draft}
          placeholder="pst-…"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => e.key === 'Enter' && commit(draft)}
          aria-label="Persistent API Token"
          data-testid="set-token"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" className="text-ink-2" onClick={() => setShown((v) => !v)} aria-label={shown ? '隐藏令牌' : '显示令牌'} data-testid="token-toggle">
            <Icon icon={shown ? ViewOffIcon : ViewIcon} size={16} />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

const FILENAME_SAMPLE: FilenameMeta = {
  prompt: '1girl, cherry blossoms, outdoors, smile, looking at viewer',
  name: '樱花下的少女',
  seed: 1431428736,
  model: 'nai-diffusion-5-full',
  width: 832,
  height: 1216,
  index: 0,
  id: 'a1b2c3',
  type: '',
  characters: [{ prompt: 'girl, frieren, elf, white hair' }],
}

function FilenameRow() {
  const on = useNai((s) => s.filenameTemplateOn)
  const text = useNai((s) => s.filenameTemplate)
  const set = useNai((s) => s.set)
  const [now] = useState(() => new Date())
  let preview = ''
  let error = ''
  try {
    preview = renderFilename(text || DEFAULT_FILENAME_TEMPLATE, { ...FILENAME_SAMPLE, date: now })
  } catch (e) {
    error = e instanceof TemplateError ? e.message : String(e)
  }
  return (
    <div>
      <Row label="文件名模板" hint={on ? '保存图片时按模板命名' : '默认文件名：prompt 前 80 字 + s-seed'}>
        <Switch checked={on} onCheckedChange={(v) => set({ filenameTemplateOn: v })} aria-label="文件名模板" data-testid="set-filename-on" />
      </Row>
      <Collapse open={on} testId="filename-wrap">
        <div className="flex flex-col gap-1.5 pr-4 pb-3 pl-10">
          <input
            className="h-7 w-full rounded-md border border-line bg-surface-2/60 px-2 font-mono text-[12px] text-ink-1 outline-none focus:border-lamp-text"
            value={text}
            placeholder={DEFAULT_FILENAME_TEMPLATE}
            spellCheck={false}
            onChange={(e) => set({ filenameTemplate: e.target.value })}
            aria-label="模板"
            data-testid="set-filename"
          />
          <span className={cn('truncate text-[12px]', error ? 'text-danger' : 'text-ink-2')} data-testid="filename-preview">
            {error || (
              <>
                预览：<span className="font-mono">{preview}.png</span>
              </>
            )}
          </span>
          <span className="text-[12px] leading-relaxed text-ink-2">
            变量 <code className="font-mono">{'{prompt} {name} {seed} {date} {time} {model} {modelname} {resolution} {width} {height} {index} {id} {type} {characters}'}</code> · 过滤器（写在 | 后）
            <code className="font-mono">first:N last:N words:N tags:N pre:文字 suf:文字 pad:N lower upper</code> · {'{characters}'} 专用{' '}
            <code className="font-mono">max:N at:N each:N join:文字 full</code> · <code className="font-mono">{'{{'}</code> = 字面的 {'{'}
          </span>
        </div>
      </Collapse>
    </div>
  )
}

function connLine(s: AiServiceConf, conn: AiConn | undefined, token: string): { text: string; error?: boolean } | null {
  const nai = presetOf(s.preset).naiToken
  if (nai ? !token : !s.key.trim()) return { text: nai ? '未填写 NAI 令牌' : '未填写 API Key' }
  if (!conn) return null
  if (conn.state === 'checking') return { text: '验证中…' }
  if (conn.state === 'done') return conn.models.length ? { text: '已连接' } : null
  return { text: aiErrorText(conn.error, s), error: true }
}

function AiSettings() {
  const services = useAi((s) => s.services)
  const rules = useAi((s) => s.rules)
  const [openId, setOpenId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  useEffect(() => {
    const st = useAi.getState()
    for (const s of st.services) if (!st.conn[s.id] && serviceKey(s)) void st.check(s.id)
  }, [])
  const toggle = (id: string) => setOpenId((x) => (x === id ? null : id))
  const addService = (id: AiPresetId = 'deepseek') => {
    const p = presetOf(id)
    const s: AiServiceConf = { id: newServiceId(), preset: p.id, url: '', model: p.model ?? '', key: '' }
    useAi.getState().saveService(s)
    if (p.naiToken) void useAi.getState().check(s.id)
    setOpenId(s.id)
    setFocusId(s.id)
  }
  const nai = services.filter((s) => s.preset === 'novelai')
  const others = services.filter((s) => s.preset !== 'novelai')
  const addRule = () => {
    const r: AiRule = { id: newRuleId(), name: '', body: '', on: true }
    useAi.getState().saveRule(r)
    setOpenId(r.id)
    setFocusId(r.id)
  }
  return (
    <Page title="AI" sub="「问 AI」使用的服务和规则，以及 AI 代理的连接" testId="ai-settings">
      <Section title="NovelAI" sub="使用「NAI 账号」中的 NAI 令牌" testId="ai-services-nai">
        {nai.map((s) => (
          <ServiceRow key={s.id} s={s} open={openId === s.id} onToggle={() => toggle(s.id)} autoFocus={focusId === s.id} onFocused={() => setFocusId(null)} />
        ))}
        {!nai.length && (
          <div className="flex items-center gap-2.5 py-1 pr-3 pl-4" data-testid="ai-nai-none">
            <span className="text-[13px] text-ink-2">未添加</span>
            <Button variant="outline" size="xs" className="ml-auto" onClick={() => addService('novelai')} data-testid="ai-add-nai">
              <Icon icon={Add01Icon} size={14} />
              添加 NovelAI
            </Button>
          </div>
        )}
      </Section>
      <Section title="其他 AI 服务" sub="API Key 保存在本机，仅发送至对应的 AI 服务" testId="ai-services">
        {others.map((s) => (
          <ServiceRow key={s.id} s={s} open={openId === s.id} onToggle={() => toggle(s.id)} autoFocus={focusId === s.id} onFocused={() => setFocusId(null)} />
        ))}
        <div className="flex px-3 py-1" data-jump-target>
          <Button variant="ghost" size="xs" className="text-ink-2" onClick={() => addService()} data-testid="ai-add-service">
            <Icon icon={Add01Icon} size={14} />
            添加服务
          </Button>
        </div>
      </Section>
      <ChatSettings />
      <Section title="规则" sub="发送时添加在说明之前，可在「问 AI」中勾选" testId="ai-rules" jump="rules">
        {rules.map((r) => (
          <RuleRow key={r.id} r={r} open={openId === r.id} onToggle={() => toggle(r.id)} autoFocus={focusId === r.id} onFocused={() => setFocusId(null)} />
        ))}
        <div className="flex px-3 py-1">
          <Button variant="ghost" size="xs" className="text-ink-2" onClick={addRule} data-testid="ai-add-rule">
            <Icon icon={Add01Icon} size={14} />
            添加规则
          </Button>
        </div>
      </Section>
      <AgentSettings />
    </Page>
  )
}

const CHAT_ENTRY_HINT: Record<ChatEntry, string> = { rail: '位于竖条底部', tab: '位于助手栏顶部，与「模板库」并列' }
const CHAT_SEND_HINT: Record<ChatSendKey, string> = { enter: 'Enter 发送，Shift+Enter 换行', shift: 'Shift+Enter 发送，Enter 换行' }

function ChatSettings() {
  const entry = usePrefs((s) => s.chatEntry)
  const sendKey = usePrefs((s) => s.chatSendKey)
  const set = usePrefs((s) => s.set)
  return (
    <Section title="问 AI" testId="chat-settings">
      <Row label="入口" hint={CHAT_ENTRY_HINT[entry]}>
        <Seg value={entry} onChange={(chatEntry) => set({ chatEntry })} options={{ rail: '竖条按钮', tab: '助手栏标签' }} testId="chat-entry" />
      </Row>
      <Row label="发送键" hint={CHAT_SEND_HINT[sendKey]}>
        <Seg value={sendKey} onChange={(chatSendKey) => set({ chatSendKey })} options={{ enter: 'Enter', shift: 'Shift+Enter' }} testId="chat-send-key" />
      </Row>
    </Section>
  )
}

function agentHint(on: boolean, conn: AgentConn): string {
  if (!on) return 'AI 代理无法连接'
  if (conn.state !== 'ready') return '连接中…'
  if (!conn.client && !conn.lastCall) return '等待 AI 代理连接'
  return ['已连接', conn.client, conn.lastCall ? `上次调用 ${formatTime(conn.lastCall).slice(11)}` : ''].filter(Boolean).join(' · ')
}

const AGENT_MODE_HINT: Record<AgentMode, string> = { preview: '打开预览，勾选后应用', direct: '直接应用，可撤销' }
const AGENT_GEN_HINT: Record<AgentGen, string> = { confirm: '先确认再生成，0 Anlas 时也确认', direct: '直接生成，可能花费 Anlas' }

function AgentSettings() {
  const agent = useAi((s) => s.agent)
  const setAgent = useAi((s) => s.setAgent)
  const conn = useAgentConn()
  const url = `${location.origin}/mcp`
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`已复制${what}`)
    } catch {
      toast.error('复制失败：无剪贴板权限')
    }
  }
  const off = agent.on ? undefined : ''
  return (
    <Section title="AI 代理" sub="Claude Code、Cursor 等通过 MCP 连接后可查询 tag 库、修改文档和 list、生成图片" testId="agent-settings">
      <Row label="允许 AI 代理连接" hint={agentHint(agent.on, conn)}>
        <Switch checked={agent.on} onCheckedChange={(on) => setAgent({ on })} aria-label="允许 AI 代理连接" data-testid="agent-on" />
      </Row>
      <div className="transition-opacity duration-200 data-[off]:pointer-events-none data-[off]:opacity-45" data-off={off} inert={!agent.on} data-testid="agent-sub">
        <div className="flex items-start gap-6 px-4 py-3 pl-10 max-md:flex-col max-md:gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[13px] text-ink-1">地址</span>
            <span className="font-mono text-[12px] break-all text-ink-2" data-testid="agent-url">
              {url}
            </span>
            <span className="text-[12px] text-ink-3">Claude Code 在终端运行命令；Cursor 等将配置写入 MCP 设置</span>
          </div>
          <div className="flex shrink-0 gap-2 pt-0.5">
            <Button variant="outline" size="sm" onClick={() => copy(`claude mcp add --transport http tincture ${url}`, ' Claude Code 命令')} data-testid="agent-copy-cmd">
              <Icon icon={Copy01Icon} size={14} />
              复制命令
            </Button>
            <Button variant="outline" size="sm" onClick={() => copy(JSON.stringify({ mcpServers: { tincture: { url } } }, null, 2), '配置')} data-testid="agent-copy-json">
              <Icon icon={Copy01Icon} size={14} />
              复制配置
            </Button>
          </div>
        </div>
        <div className="border-t border-line">
          <Row label="修改文档时" hint={AGENT_MODE_HINT[agent.mode]} note="list 的修改直接应用，可撤销" indent>
            <Seg value={agent.mode} onChange={(mode) => setAgent({ mode })} options={{ preview: '先预览', direct: '直接应用' }} testId="agent-mode" />
          </Row>
        </div>
        <div className="border-t border-line">
          <Row label="出图时" hint={AGENT_GEN_HINT[agent.gen]} indent>
            <Seg value={agent.gen} onChange={(gen) => setAgent({ gen })} options={{ confirm: '每次确认', direct: '直接出图' }} testId="agent-gen" />
          </Row>
        </div>
      </div>
    </Section>
  )
}

function removeWithUndo<T extends { id: string }>(label: string, item: T, list: () => T[], save: (l: T[]) => void) {
  const i = list().findIndex((x) => x.id === item.id)
  save(list().filter((x) => x.id !== item.id))
  toast(`已删除${label}`, { action: { label: '撤销', onClick: () => save(list().some((x) => x.id === item.id) ? list() : [...list().slice(0, i), item, ...list().slice(i)]) } })
}

function ServiceRow({ s, open, onToggle, autoFocus, onFocused }: { s: AiServiceConf; open: boolean; onToggle: () => void; autoFocus: boolean; onFocused: () => void }) {
  const conn = useAi((st) => st.conn[s.id])
  const token = useNai((st) => st.token)
  const preset = presetOf(s.preset)
  const [key, setKey] = useState(s.key)
  const [url, setUrl] = useState(s.url)
  const [shown, setShown] = useState(false)
  const save = (patch: Partial<AiServiceConf>, check = false) => {
    const cur = useAi.getState().services.find((x) => x.id === s.id)
    if (!cur) return
    useAi.getState().saveService({ ...cur, ...patch })
    if (check) void useAi.getState().check(s.id)
  }
  const commit = (field: 'key' | 'url', v: string) => {
    const cur = useAi.getState().services.find((x) => x.id === s.id)
    if (cur && v.trim() !== cur[field]) save({ [field]: v.trim() }, true)
  }
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const edit = (field: 'key' | 'url', v: string) => {
    ;(field === 'key' ? setKey : setUrl)(v)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => commit(field, v), 600)
  }
  const changePreset = (id: AiPresetId) => {
    const p = presetOf(id)
    const cur = useAi.getState().services.find((x) => x.id === s.id)
    // Preserve the debounced key draft for undo because providers may reveal a key only once.
    const prev = cur && { preset: cur.preset, key: key.trim() || cur.key, url: url.trim() || cur.url, model: cur.model }
    clearTimeout(timer.current)
    setKey('')
    setUrl('')
    save({ preset: id, key: '', url: '', model: p.model ?? '' }, !!p.naiToken)
    if (prev?.key)
      toast('已清空 API Key', {
        action: {
          label: '撤销',
          onClick: () => {
            setKey(prev.key)
            setUrl(prev.url)
            save(prev, true)
          },
        },
      })
  }
  const line = connLine(s, conn, token)
  const remove = () =>
    removeWithUndo(`服务「${serviceName(s)}」`, s, () => useAi.getState().services, (services) => {
      const st = useAi.getState()
      useAi.setState({ services, current: st.current && services.some((x) => x.id === st.current) ? st.current : (services[0]?.id ?? null) })
    })
  return (
    <div data-testid="ai-service" data-open={open ? '' : undefined} data-preset={s.preset}>
      <button type="button" className="flex min-h-8 w-full items-center gap-2.5 px-4 py-1 text-left transition-colors hover:bg-surface-2/60" onClick={onToggle} aria-expanded={open} data-testid="ai-service-head">
        <span className="w-[6.5rem] shrink-0 truncate text-[13px] text-ink-1">{serviceName(s)}</span>
        <span className={cn('min-w-0 truncate font-mono text-[12px]', s.model.trim() ? 'text-ink-2' : 'text-ink-3')} data-testid="ai-service-model">
          {s.model.trim() || '未选择模型'}
        </span>
        {line && (
          <span className={cn('ml-auto shrink-0 text-[12px]', line.error ? 'text-danger' : 'text-ink-2')} data-testid="ai-service-status" data-state={conn?.state ?? 'none'}>
            {line.text}
          </span>
        )}
        <Icon icon={ArrowDown01Icon} size={14} className={cn('shrink-0 text-ink-2 transition-transform duration-200', !line && 'ml-auto', open && 'rotate-180')} />
      </button>
      <Collapse open={open}>
        <div className="flex flex-col gap-2 border-t border-line bg-shell px-4 py-2.5">
          {!preset.naiToken && (
          <Field label="服务">
            <Select value={s.preset} onValueChange={(v) => changePreset(v as AiPresetId)}>
              <SelectTrigger
                className="w-40 text-[12px]"
                aria-label="服务"
                ref={(el) => {
                  if (el && autoFocus) {
                    el.focus()
                    onFocused()
                  }
                }}
                data-testid="ai-service-preset"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AI_PRESETS.filter((p) => !p.naiToken).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          )}
          <Field label="API Key">
            {preset.naiToken ? (
              <span className="text-[12px] text-ink-2" data-testid="ai-service-nai-token">
                使用 NAI 令牌
              </span>
            ) : (
              <InputGroup className="w-72">
                <InputGroupInput
                  type={shown ? 'text' : 'password'}
                  className="font-mono text-[12px]"
                  value={key}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => edit('key', e.target.value)}
                  onBlur={() => commit('key', key)}
                  onKeyDown={(e) => e.key === 'Enter' && commit('key', key)}
                  aria-label="API Key"
                  data-testid="ai-service-key"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton size="icon-xs" className="text-ink-2" onClick={() => setShown((v) => !v)} aria-label={shown ? '隐藏 API Key' : '显示 API Key'} data-testid="ai-service-key-toggle">
                    <Icon icon={shown ? ViewOffIcon : ViewIcon} size={16} />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            )}
          </Field>
          <Field label="地址">
            {s.preset === 'custom' ? (
              <Input
                className="h-7 w-72 font-mono text-[12px]"
                value={url}
                placeholder="http://localhost:11434/v1"
                spellCheck={false}
                onChange={(e) => edit('url', e.target.value)}
                onBlur={() => commit('url', url)}
                onKeyDown={(e) => e.key === 'Enter' && commit('url', url)}
                aria-label="地址"
                data-testid="ai-service-url"
              />
            ) : (
              <span className="truncate font-mono text-[12px] text-ink-2" data-testid="ai-service-url-fixed">
                {preset.url}
              </span>
            )}
          </Field>
          <Field label="模型">
            <ModelPicker value={s.model} models={conn?.state === 'done' ? conn.models : []} onChange={(model) => save({ model })} />
          </Field>
          <div className="flex justify-end">
            <Button variant="ghost" size="xs" className="text-danger hover:text-danger" onClick={remove} data-testid="ai-service-delete">
              <Icon icon={Delete02Icon} size={14} />
              删除
            </Button>
          </div>
        </div>
      </Collapse>
    </div>
  )
}

function ModelPicker({ value, models, onChange }: { value: string; models: string[]; onChange: (model: string) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const typed = q.trim()
  const pick = (m: string) => {
    onChange(m)
    setOpen(false)
    setQ('')
  }
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQ('')
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="h-7 w-72 justify-between px-2.5 font-mono text-[12px] font-normal" data-testid="ai-service-model-picker">
          <span className={cn('truncate', !value && 'font-sans text-ink-3')}>{value || '选择或输入模型'}</span>
          <Icon icon={ArrowDown01Icon} size={14} className="shrink-0 text-ink-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0" data-testid="ai-model-menu">
        <Command>
          <CommandInput placeholder={models.length ? '搜索，或输入模型名' : '输入模型名'} value={q} onValueChange={setQ} data-testid="ai-model-search" />
          <CommandList className="max-h-64">
            {models.length > 0 && (
              <CommandGroup>
                {models.map((m) => (
                  <CommandItem key={m} value={m} onSelect={() => pick(m)} className="font-mono text-[12px]" data-testid="ai-model-option">
                    <span className="truncate">{m}</span>
                    <Icon icon={Tick02Icon} size={14} className={cn('ml-auto shrink-0 text-ink-2', value !== m && 'invisible')} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {typed && !models.includes(typed) && (
              <CommandGroup forceMount>
                <CommandItem forceMount value={`使用 ${typed}`} onSelect={() => pick(typed)} data-testid="ai-model-use">
                  <span className="truncate">
                    使用「<b className="font-mono font-medium">{typed}</b>」
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
            {!typed && !models.length && <div className="px-2 py-3 text-center text-[12px] text-ink-3">暂无模型列表</div>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function RuleRow({ r, open, onToggle, autoFocus, onFocused }: { r: AiRule; open: boolean; onToggle: () => void; autoFocus: boolean; onFocused: () => void }) {
  const update = (patch: Partial<AiRule>) => {
    const cur = useAi.getState().rules.find((x) => x.id === r.id)
    if (cur) useAi.getState().saveRule({ ...cur, ...patch })
  }
  const remove = () => removeWithUndo(`规则「${r.name.trim() || '未命名'}」`, r, () => useAi.getState().rules, (rules) => useAi.setState({ rules }))
  return (
    <div data-testid="ai-rule" data-open={open ? '' : undefined}>
      <div className="flex min-h-8 items-center gap-2.5 pr-3 transition-colors hover:bg-surface-2/60">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch py-1 pl-3 text-left" onClick={onToggle} aria-expanded={open} data-testid="ai-rule-head">
          <span className={cn('w-[6.5rem] shrink-0 truncate text-[13px]', r.name.trim() ? 'text-ink-1' : 'text-ink-3')}>{r.name.trim() || '未命名'}</span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{r.body.trim() || '暂无内容'}</span>
          <Icon icon={ArrowDown01Icon} size={14} className={cn('shrink-0 text-ink-2 transition-transform duration-200', open && 'rotate-180')} />
        </button>
        <span className="shrink-0 text-[12px] text-ink-2">默认勾选</span>
        <Switch size="sm" checked={r.on} onCheckedChange={(on) => update({ on })} aria-label="默认勾选" data-testid="ai-rule-on" />
      </div>
      <Collapse open={open}>
        <div className="flex flex-col gap-2 border-t border-line bg-shell px-4 py-2.5">
          <Field label="名字">
            <Input
              className="h-7 w-48 text-[13px]"
              value={r.name}
              placeholder="如：保留画师"
              ref={(el) => {
                if (el && autoFocus) {
                  el.focus()
                  onFocused()
                }
              }}
              onChange={(e) => update({ name: e.target.value })}
              data-testid="ai-rule-name"
            />
          </Field>
          <div className="flex items-start gap-3">
            <span className="w-14 shrink-0 pt-1.5 text-[12px] text-ink-2">正文</span>
            <Textarea className="min-h-20 flex-1 text-[13px]" value={r.body} placeholder="如：不修改「画师」区块" onChange={(e) => update({ body: e.target.value })} data-testid="ai-rule-body" />
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" size="xs" className="text-danger hover:text-danger" onClick={remove} data-testid="ai-rule-delete">
              <Icon icon={Delete02Icon} size={14} />
              删除
            </Button>
          </div>
        </div>
      </Collapse>
    </div>
  )
}

function LibrarySettings() {
  const [dir] = useState(libraryDir)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Switching libraries reloads the page and would lose an in-flight image after Anlas is spent, so block it during generation.
  const running = useGen((s) => !!s.running)
  const input = useRef<HTMLInputElement>(null)
  const edit = async () => {
    let next = dir
    if (desktop) {
      const picked = await desktop.pickFolder(dir)
      if (!picked) return
      next = picked
    }
    setDraft(next)
    setError('')
    setEditing(true)
    requestAnimationFrame(() => input.current?.select())
  }
  const same = draft.trim() === dir
  const blocked = running ? '图片生成中，无法更换图库文件夹' : same ? '与当前图库文件夹相同' : null
  const apply = async () => {
    if (busy || !draft.trim() || same || useGen.getState().running) return
    setBusy(true)
    const r = await changeLibraryDir(draft)
    if ('error' in r) {
      setError(r.error)
      setBusy(false)
      input.current?.focus()
      return
    }
    location.reload()
  }
  return (
    <Page title="图库" sub="文档、模板和生成的图片保存在图库文件夹中" testId="library-settings">
      <Section>
        <div className="flex items-start gap-6 px-4 py-3 max-md:flex-col max-md:gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[13px] text-ink-1">图库文件夹</span>
            <span className="font-mono text-[12px] break-all text-ink-2" data-testid="library-dir">
              {dir}
            </span>
          </div>
          <div className="flex shrink-0 gap-2 pt-0.5">
            <Button variant="outline" size="sm" onClick={() => void revealLibraryDir().catch(() => toast.error('无法打开图库文件夹'))} data-testid="library-reveal">
              在资源管理器中打开
            </Button>
            <Button variant="outline" size="sm" disabled={editing} onClick={() => void edit()} data-testid="library-change">
              更换
            </Button>
          </div>
        </div>
        <Collapse open={editing} testId="library-edit">
          <div className="flex flex-col gap-1.5 pr-4 pb-3 pl-10" onKeyDown={(e) => e.key === 'Escape' && !composing(e) && setEditing(false)}>
            <div className="flex items-center gap-2">
              <input
                ref={input}
                className="h-7 min-w-0 flex-1 rounded-md border border-line bg-surface-2/60 px-2 font-mono text-[12px] text-ink-1 outline-none focus:border-lamp-text aria-invalid:border-danger"
                value={draft}
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                onChange={(e) => (setDraft(e.target.value), setError(''))}
                onKeyDown={(e) => e.key === 'Enter' && !composing(e) && void apply()}
                aria-label="新的图库文件夹"
                data-testid="library-input"
              />
              <Tip label={blocked}>
                <span className="flex">
                  <Button size="sm" disabled={!draft.trim() || !!blocked} onClick={() => void apply()} data-testid="library-apply">
                    使用此文件夹
                  </Button>
                </span>
              </Tip>
              <Button variant="ghost" size="sm" className="text-ink-2" onClick={() => setEditing(false)} data-testid="library-cancel">
                取消
              </Button>
            </div>
            <span className={cn('text-[12px]', error ? 'text-danger' : 'text-ink-2')} data-testid="library-hint">
              {error || '将改用该文件夹并重新载入（空文件夹则新建图库）；当前内容留在原文件夹，不复制'}
            </span>
          </div>
        </Collapse>
      </Section>
    </Page>
  )
}

function Collapse({ open, children, testId }: { open: boolean; children: ReactNode; testId?: string }) {
  return (
    <div
      className="grid transition-[grid-template-rows,opacity] duration-200"
      style={{ gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0 }}
      inert={!open}
      data-open={open ? '' : undefined}
      data-testid={testId}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

const levelOf = (t: string) => lookupTag(t)?.level ?? 0
const setCustoms = (f: (list: CustomGender[]) => CustomGender[]) => usePrefs.getState().set({ customGenders: f(usePrefs.getState().customGenders) })

function MoreGenders() {
  const on = usePrefs((s) => s.moreGenders)
  const off = usePrefs((s) => s.genderPresetsOff)
  const customs = usePrefs((s) => s.customGenders)
  const nsfw = usePrefs((s) => s.nsfw)
  const set = usePrefs((s) => s.set)
  const [openId, setOpenId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const presets = GENDER_PRESETS.filter((p) => presetVisible(p, NSFW_MAX_LEVEL[nsfw], levelOf))
  const add = () => {
    const c: CustomGender = { id: newId('gd'), name: '', gender: 'female', tags: [] }
    setCustoms((l) => [...l, c])
    setFocusId(c.id)
    setOpenId(c.id)
  }
  return (
    <div>
      <Row label="更多性别" hint="性别选项中加入下方已开启的项，导出时在角色正面开头添加对应 tag" note="不影响已有角色">
        <Switch checked={on} onCheckedChange={(v) => set({ moreGenders: v })} aria-label="更多性别" data-testid="set-more-genders" />
      </Row>
      <Collapse open={on} testId="gender-list-wrap">
        <div>
          <div className="divide-y divide-line border-t border-line" data-testid="gender-list">
            {presets.map((p) => (
              <div key={p.id} className="flex min-h-8 items-center gap-2.5 px-4 py-1 pl-10" data-testid="gender-preset" data-id={p.id}>
                <GenderIcon gender={p.gender} size={14} />
                <span className="w-[6.5rem] shrink-0 text-[13px] text-ink-1">{p.name}</span>
                <span className="min-w-0 truncate text-[12px] text-ink-2">{defTags(p)}</span>
                <span className="ml-auto flex">
                  <Switch
                    size="sm"
                    checked={!off.includes(p.id)}
                    onCheckedChange={(v) => set({ genderPresetsOff: v ? off.filter((x) => x !== p.id) : [...off, p.id] })}
                    aria-label={p.name}
                    data-testid="gender-preset-switch"
                  />
                </span>
              </div>
            ))}
            {customs.map((c) => (
              <CustomRow
                key={c.id}
                c={c}
                open={openId === c.id}
                onToggle={() => setOpenId((x) => (x === c.id ? null : c.id))}
                autoFocus={focusId === c.id}
                onFocused={() => setFocusId(null)}
              />
            ))}
            <div className="flex py-1 pl-8">
              <Button variant="ghost" size="xs" className="text-ink-2" onClick={add} data-testid="add-custom-gender">
                <Icon icon={Add01Icon} size={14} />
                添加性别
              </Button>
            </div>
          </div>
        </div>
      </Collapse>
    </div>
  )
}

const GENDER_SEG = Object.fromEntries(
  GENDERS.map((g) => [
    g,
    <span key={g} className="flex items-center gap-1">
      <GenderIcon gender={g} size={14} />
      {GENDER_LABEL[g]}
    </span>,
  ]),
) as Record<Gender, ReactNode>

function CustomRow({ c, open, onToggle, autoFocus, onFocused }: { c: CustomGender; open: boolean; onToggle: () => void; autoFocus: boolean; onFocused: () => void }) {
  const update = (patch: Partial<CustomGender>) => setCustoms((l) => l.map((x) => (x.id === c.id ? { ...x, ...patch } : x)))
  const remove = () => {
    const i = usePrefs.getState().customGenders.findIndex((x) => x.id === c.id)
    setCustoms((l) => l.filter((x) => x.id !== c.id))
    toast(`已删除性别「${c.name.trim() || '未命名'}」`, {
      action: { label: '撤销', onClick: () => setCustoms((l) => (l.some((x) => x.id === c.id) ? l : [...l.slice(0, i), c, ...l.slice(i)])) },
    })
  }
  return (
    <div data-testid="gender-custom" data-open={open ? '' : undefined}>
      <button
        type="button"
        className="flex min-h-8 w-full items-center gap-2.5 px-4 py-1 text-left transition-colors hover:bg-surface-2/60"
        onClick={onToggle}
        aria-expanded={open}
        data-testid="gender-custom-head"
      >
        <GenderIcon gender={c.gender} size={14} />
        <span className={cn('w-[6.5rem] shrink-0 truncate text-[13px]', c.name.trim() ? 'text-ink-1' : 'text-ink-3')}>{c.name.trim() || '未命名'}</span>
        <span className="min-w-0 truncate text-[12px] text-ink-2">{c.tags.length ? defTags(c) : '暂无 tag'}</span>
        <Icon icon={ArrowDown01Icon} size={14} className={cn('ml-auto shrink-0 text-ink-2 transition-transform duration-200', open && 'rotate-180')} />
      </button>
      <Collapse open={open}>
        <div className="flex flex-col gap-2 border-t border-line bg-shell px-4 py-2.5 pl-9">
          <Field label="名字">
            <input
              className="h-6 w-40 rounded-md border border-line bg-work px-1.5 text-[13px] text-ink-1 outline-none focus:border-lamp-text"
              value={c.name}
              placeholder="如：女装少年"
              ref={(el) => {
                if (el && autoFocus) {
                  el.focus()
                  onFocused()
                }
              }}
              onChange={(e) => update({ name: e.target.value })}
              data-testid="gender-custom-name"
            />
          </Field>
          <Field label="NAI 性别">
            <Seg value={c.gender} onChange={(gender) => update({ gender })} options={GENDER_SEG} testId="gender-custom-base" />
          </Field>
          <Field label="tag">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-(--chip-gap-x) gap-y-(--chip-gap-y)" style={sectionVars('slate')} data-testid="gender-custom-tags">
              {c.tags.map((t) => (
                <TagChip key={t} tag={t} onRemove={() => update({ tags: c.tags.filter((x) => x !== t) })} />
              ))}
              <AddTagInput onAdd={(names) => update({ tags: cleanTags([...c.tags, ...names]) })} />
            </div>
          </Field>
          <div className="flex justify-end">
            <Button variant="ghost" size="xs" className="text-danger hover:text-danger" onClick={remove} data-testid="gender-custom-delete">
              <Icon icon={Delete02Icon} size={14} />
              删除
            </Button>
          </div>
        </div>
      </Collapse>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-[12px] text-ink-2">{label}</span>
      {children}
    </div>
  )
}

function TagChip({ tag, onRemove }: { tag: string; onRemove: () => void }) {
  const chip = { ...toChip(parsePrompt(tag)[0] ?? { text: tag, type: 'tag', weight: 1 }), id: tag }
  return (
    <span className="chip group relative" {...chipAttrs(chip)} data-testid="gender-custom-tag" data-tag={tag}>
      <ChipFace chip={chip} />
      <button type="button" className="chip-x" onClick={onRemove} aria-label={`移除 ${tag}`}>
        <Icon icon={Cancel01Icon} size={14} />
      </button>
    </span>
  )
}

function AddTagInput({ onAdd }: { onAdd: (names: string[]) => void }) {
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const s = useTagSuggest(q)
  const composing = useRef(false)
  const open = focused && s.searching && s.results.length > 0
  const add = (names: string[]) => {
    setQ('')
    const clean = names.map((n) => n.trim()).filter(Boolean)
    if (clean.length) onAdd(clean)
  }
  const addRaw = () => add(parseNodeText(q))
  const accept = (tag?: TagEntry) => (tag ? add([tag.name]) : addRaw())
  const confirm = () => {
    if (!q.trim()) return
    if (!s.searching) return addRaw()
    const r = s.enterPickLatest()
    if (r instanceof Promise) r.then(accept)
    else accept(r)
  }
  return (
    <TagSuggest
      s={s}
      open={focused}
      isolate
      onPick={(tag) => accept(tag)}
      hints={
        <>
          <span>Tab / ↓ 选择候选</span>
          <span>↵ 补全英文，否则保留原文</span>
        </>
      }
    >
      <input
        className="tag-input"
        placeholder="+ tag"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => (composing.current = false)}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text')
          if (!looksLikePromptString(text)) return
          e.preventDefault()
          add(parseNodeText(text))
        }}
        onKeyDown={(e) => {
          if (composing.current || e.nativeEvent.isComposing) return
          if (!isSuggestKey(e.key)) e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) addRaw()
            else confirm()
          } else if (e.key === 'Tab' && open) {
            e.preventDefault()
            accept(s.pick())
          } else if (e.key === ',' || e.key === '，') {
            e.preventDefault()
            confirm()
          } else if (e.key === 'Escape') {
            setQ('')
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        data-testid="gender-custom-tag-input"
      />
    </TagSuggest>
  )
}
