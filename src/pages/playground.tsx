import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Seg } from '@/components/seg'
import { ChipFace, chipAttrs } from '@/components/editor/chip-face'
import { sectionVars } from '@/components/editor/labels'
import { exportTokens, parsePrompt, toChip, type OutToken } from '@/lib/nai'
import { usePrefs, type ChipLang } from '@/store/prefs'
import { clearTokenOverrides, loadTokenOverrides, saveTokenOverrides } from '@/lib/token-overrides'
import type { Chip, SectionColor } from '@/types'
import { SECTION_COLORS } from '@/types'

interface RangeCtl {
  name: string
  label: string
  min: number
  max: number
  step: number
  unit?: string
  hue?: boolean
}

const GROUPS: { title: string; items: RangeCtl[] }[] = [
  {
    title: 'Chip 尺寸',
    items: [
      { name: '--chip-h', label: '高度', min: 18, max: 34, step: 1, unit: 'px' },
      { name: '--chip-px', label: '左右内边距', min: 3, max: 14, step: 1, unit: 'px' },
      { name: '--chip-radius', label: '圆角', min: 0, max: 14, step: 1, unit: 'px' },
      { name: '--chip-fs', label: '字号', min: 10.5, max: 15, step: 0.5, unit: 'px' },
      { name: '--chip-gap-x', label: '横向间距', min: 2, max: 14, step: 1, unit: 'px' },
      { name: '--chip-gap-y', label: '纵向间距', min: 2, max: 14, step: 1, unit: 'px' },
    ],
  },
  {
    title: '权重数字段',
    items: [
      { name: '--wseg-k', label: '加重：底色加深幅度', min: 0, max: 0.8, step: 0.02 },
      { name: '--wseg-fade', label: '减弱：底色变淡幅度', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Hover',
    items: [{ name: '--hover-x-size', label: '× 直径', min: 10, max: 22, step: 1, unit: 'px' }],
  },
  {
    title: '色相',
    items: [
      { name: '--hue-artist', label: '导出前缀', min: 0, max: 360, step: 1, hue: true },
      { name: '--hue-neg', label: '负权重角标', min: 0, max: 360, step: 1, hue: true },
      { name: '--hue-accent', label: 'UI 强调色', min: 0, max: 360, step: 1, hue: true },
      { name: '--hue-base', label: '底色偏色', min: 0, max: 360, step: 1, hue: true },
    ],
  },
  {
    title: 'Section',
    items: [
      { name: '--section-radius', label: '圆角', min: 0, max: 16, step: 1, unit: 'px' },
      { name: '--section-px', label: '左右内边距', min: 4, max: 20, step: 1, unit: 'px' },
      { name: '--section-py', label: '上下内边距', min: 4, max: 18, step: 1, unit: 'px' },
      { name: '--section-gap', label: 'section 间距', min: 2, max: 24, step: 1, unit: 'px' },
      { name: '--section-chroma', label: '标识色彩度', min: 0, max: 0.25, step: 0.01 },
    ],
  },
]

const FONTS: Record<string, string> = {
  plex: '"IBM Plex Sans Variable", "IBM Plex Sans", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif',
  geist: '"Geist Variable", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif',
  system: 'system-ui, "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", sans-serif',
}

function readToken(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

const mk = (s: string) => parsePrompt(s).map(toChip)

export function Playground() {
  const [overrides, setOverrides] = useState<Record<string, string>>(() => loadTokenOverrides())
  const [, force] = useState(0)
  const prefs = usePrefs()

  useEffect(() => {
    saveTokenOverrides(overrides)
  }, [overrides])

  const set = (name: string, value: string) => setOverrides((o) => ({ ...o, [name]: value }))
  const dirty = Object.keys(overrides).length

  const css = useMemo(() => `:root {\n${Object.entries(overrides).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`, [overrides])

  const writeBack = async () => {
    try {
      const r = await fetch('/__tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(overrides) })
      if (!r.ok) throw new Error(String(r.status))
      const { changed } = (await r.json()) as { changed: string[] }
      clearTokenOverrides()
      setOverrides({})
      toast.success(`已写回 tokens.css：${changed.length} 个 token`)
    } catch {
      toast.error('写回失败：仅在 pnpm dev 下可用，请使用「复制 CSS」手动粘贴')
    }
  }

  const reset = () => {
    clearTokenOverrides()
    setOverrides({})
    force((n) => n + 1)
    toast('已恢复为 tokens.css 的值')
  }

  const fontKey = Object.entries(FONTS).find(([, v]) => v === (overrides['--font-ui'] ?? readToken('--font-ui')))?.[0] ?? 'plex'

  return (
    <div className="relative grid h-full min-h-0 grid-cols-[300px_1fr] max-md:grid-cols-1" data-testid="playground">
      <div className="wco-backdrop bg-work" />
      <aside className="flex min-h-0 flex-col border-r border-line bg-shell max-md:border-r-0 max-md:border-b">
        <header className="app-drag flex h-9 shrink-0 items-center border-b border-line px-3">
          <span className="pane-title">设计台</span>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-5 p-4">
            <div className="flex flex-col gap-3">
              <span className="label-caps">显示</span>
              <Row label="主题">
                <Seg value={prefs.theme} onChange={(v) => prefs.set({ theme: v })} options={{ dark: '深', light: '浅', system: '系统' }} testId="pg-theme" />
              </Row>
              <Row label="chip 文字">
                <Seg<ChipLang> value={prefs.chipLang} onChange={(v) => prefs.set({ chipLang: v })} options={{ 'en-zh': '英前', 'zh-en': '中前', en: '英', zh: '中' }} testId="pg-chip-lang" />
              </Row>
              <Row label="UI 字体">
                <Select value={fontKey} onValueChange={(k) => set('--font-ui', FONTS[k])}>
                  <SelectTrigger size="sm" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="plex">IBM Plex Sans</SelectItem>
                    <SelectItem value="geist">Geist</SelectItem>
                    <SelectItem value="system">系统字体</SelectItem>
                  </SelectContent>
                </Select>
              </Row>
            </div>
            {GROUPS.map((g) => (
              <div key={g.title} className="flex flex-col gap-3">
                <span className="label-caps">{g.title}</span>
                {g.items.map((c) => (
                  <TokenSlider key={c.name} ctl={c} value={overrides[c.name]} onChange={(v) => set(c.name, v)} />
                ))}
              </div>
            ))}
          </div>
        </ScrollArea>
        <div className="flex flex-col gap-2 border-t border-line p-3">
          <div className="text-[11px] text-ink-2">{dirty ? `已修改 ${dirty} 个 token（已在编辑器生效）` : '与 tokens.css 一致'}</div>
          <div className="flex gap-1.5">
            <Button size="sm" disabled={!dirty} onClick={writeBack} data-testid="tokens-save">
              写回 tokens.css
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!dirty}
              onClick={() => navigator.clipboard.writeText(css).then(() => toast.success('已复制 CSS'), () => toast.error('复制失败'))}
            >
              复制 CSS
            </Button>
            <Button size="sm" variant="ghost" disabled={!dirty} onClick={reset}>
              重置
            </Button>
          </div>
        </div>
      </aside>
      <ScrollArea className="min-h-0 bg-work">
        <Specimens />
      </ScrollArea>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-[12px] font-normal text-ink-2">{label}</Label>
      {children}
    </div>
  )
}

function TokenSlider({ ctl, value, onChange }: { ctl: RangeCtl; value?: string; onChange: (v: string) => void }) {
  const current = parseFloat(value ?? readToken(ctl.name)) || 0
  return (
    <div className="flex flex-col gap-1.5" data-testid={`ctl${ctl.name}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] text-ink-2">{ctl.label}</span>
        <span className="text-[11px] text-ink-2 tabular-nums">
          {ctl.name} · {current}
          {ctl.unit ?? ''}
        </span>
      </div>
      <div className="relative">
        {ctl.hue && (
          <div
            className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full opacity-70"
            style={{ background: `linear-gradient(90deg, ${Array.from({ length: 13 }, (_, i) => `oklch(0.72 0.14 ${i * 30})`).join(',')})` }}
          />
        )}
        <Slider value={[current]} min={ctl.min} max={ctl.max} step={ctl.step} onValueChange={([v]) => onChange(`${+v.toFixed(3)}${ctl.unit ?? ''}`)} />
      </div>
    </div>
  )
}

const CATS = mk('long hair, artist:mika pikazo, year 2024, source#hug')
const GREY = mk('粉色眼睛睁开, a girl standing in the rain at night')
const WEIGHTS = [0.5, 0.8, 0.95, 1, 1.05, 1.2, 1.5, 2, -0.5, -1].map((w) => ({ ...toChip({ text: 'cherry blossoms', type: 'tag', weight: w }) }))
const DISABLED: Chip = { ...toChip({ text: 'cloud', type: 'tag', weight: 1 }), disabled: true }
const SECTION_DEMO = mk('1girl, solo, 1.2::silver hair, long hair::, blue eyes, 0.8::smile::, school uniform, -1::hat::')

function StaticChip({ chip, hover, selected }: { chip: Chip; hover?: boolean; selected?: boolean }) {
  return (
    <div className="chip" {...chipAttrs(chip)} data-force-hover={hover ? '' : undefined} data-selected={selected ? '' : undefined} data-testid="specimen-chip">
      <ChipFace chip={chip} />
      {hover && (
        <span className="chip-x">
          <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden>
            <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
      )}
    </div>
  )
}

function StaticSection({ name, color, chips, muted }: { name: string; color: SectionColor; chips: Chip[]; muted?: boolean }) {
  return (
    <div className="section" style={sectionVars(color)} data-muted={muted ? '' : undefined}>
      <div className="section-head">
        <span className="section-grip grid h-5 w-4 place-items-center font-mono text-[11px]">⋮⋮</span>
        <span className="section-name">{name}</span>
        <span className="text-[11px] text-ink-2">{chips.length}</span>
        {muted && <span className="rounded bg-surface-2 px-1.5 text-[11px] text-ink-2">已停用 · 不导出</span>}
      </div>
      <div className="section-body">
        {chips.map((c) => (
          <StaticChip key={c.id} chip={c} />
        ))}
        <input className="tag-input" placeholder="+ tag" readOnly />
      </div>
    </div>
  )
}

function Plate({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline gap-3">
        <h2 className="text-[13px] font-semibold text-ink-1">{title}</h2>
        {note && <p className="text-[12px] text-ink-2">{note}</p>}
      </header>
      {children}
    </section>
  )
}

function Specimens() {
  const exportSample = exportTokens([{ id: 's', name: '', color: 'slate', muted: false, chips: SECTION_DEMO }])
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-9 px-8 py-7 max-md:px-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-[17px] font-semibold text-balance">样张</h1>
        <p className="max-w-[65ch] text-[13px] leading-relaxed text-ink-2">
          在左侧调整 token，此处与编辑器同步生效。点击「写回 tokens.css」保存到 src/styles/tokens.css
        </p>
      </header>

      <Plate title="区块颜色" note="chip 颜色跟随所在区块（12 色）；未识别的 tag 和自然语言始终为灰色">
        <div className="flex flex-col" style={{ gap: 'var(--chip-gap-y)' }}>
          {(Object.keys(SECTION_COLORS) as SectionColor[]).map((color) => (
            <div key={color} className="flex flex-wrap items-center" style={{ ...sectionVars(color), gap: 'var(--chip-gap-x)' }}>
              <span className="w-10 text-[11px] text-ink-2">{SECTION_COLORS[color].label}</span>
              {CATS.map((c) => (
                <StaticChip key={c.id} chip={c} />
              ))}
              {GREY.map((c) => (
                <StaticChip key={c.id} chip={c} />
              ))}
            </div>
          ))}
        </div>
      </Plate>

      <Plate title="权重" note="数字位于最前，使用 chip 自身颜色：加重越深、减弱越浅，负数为斜纹 + 虚线框；tag 本体颜色不变">
        <div className="flex flex-wrap items-center" style={{ ...sectionVars('sky'), gap: 'calc(var(--chip-gap-y) + 6px) calc(var(--chip-gap-x) + 2px)' }}>
          {WEIGHTS.map((c) => (
            <StaticChip key={c.id} chip={c} />
          ))}
          <StaticChip chip={DISABLED} />
        </div>
      </Plate>

      <Plate title="Hover / 选中" note="悬停仅显示右上角的 ×；单击选中后显示描边，并在面板中显示">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-6 py-2" style={sectionVars('sky')}>
          <StaticChip chip={CATS[0]} hover />
          <StaticChip chip={WEIGHTS[5]} hover />
          <StaticChip chip={WEIGHTS[9]} selected />
          <StaticChip chip={CATS[3]} selected />
        </div>
      </Plate>

      <Plate title="Section" note="正常 / 停用">
        <div className="flex flex-col" style={{ gap: 'var(--section-gap)' }}>
          <StaticSection name="主体" color="sky" chips={SECTION_DEMO} />
          <StaticSection name="画师" color="rose" chips={mk('1.1::artist:mika pikazo::, artist:ciloranko, 0.7::artist:kantoku::')} />
          <StaticSection name="备用光影" color="amber" chips={mk('backlighting, light rays, sunbeam')} muted />
        </div>
      </Plate>

      <Plate title="导出高亮" note="权重语法使用强调色，负权重使用冰青色，前缀使用 artist 色">
        <div className="x-out rounded-(--section-radius) border border-line-strong bg-work p-3">
          <Tokens tokens={exportSample} />
          <span className="x-sep">, </span>
          <span className="x-prefix">artist:</span>mika pikazo
        </div>
      </Plate>
    </div>
  )
}

function Tokens({ tokens }: { tokens: OutToken[] }) {
  return (
    <>
      {tokens.map((t, i) => (
        <span key={i} className={t.k === 'sep' ? 'x-sep' : t.k === 'tag' ? undefined : t.neg ? 'x-neg' : 'x-weight'}>
          {t.t}
        </span>
      ))}
    </>
  )
}
