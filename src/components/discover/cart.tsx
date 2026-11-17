import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Cancel01Icon, ShoppingBasket01Icon } from '@hugeicons/core-free-icons'
import { toast } from 'sonner'
import { FolderPicker } from '@/components/assistant/template-edit'
import { CopyButton } from '@/components/copy-button'
import { ColorGrid } from '@/components/editor/color-grid'
import { Icon } from '@/components/icon'
import { TagName } from '@/components/tag-name'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { folderPaths } from '@/lib/library-ops'
import { lookupTag } from '@/lib/tagdb'
import { untitledName } from '@/lib/discover'
import { useDiscover } from '@/store/discover'
import { useLibrary } from '@/store/library'
import { useLists } from '@/store/lists'
import type { SectionColor } from '@/types'

export function DiscoverCart() {
  const cart = useDiscover((s) => s.cart)
  const hasLists = useLists((s) => s.lists.length > 0)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!cart.length) setSaving(false)
  }, [cart.length])
  const clear = () => {
    const before = useDiscover.getState().cart
    useDiscover.getState().clearCart()
    toast(`已清空购物车（${before.length} 个）`, { action: { label: '撤销', onClick: () => useDiscover.setState({ cart: before }) } })
  }
  return (
    <aside className="flex w-(--discover-cart-w) shrink-0 flex-col border-l border-line bg-shell" data-testid="discover-cart" data-locate-keep="">
      <div className="app-drag flex h-9 shrink-0 items-center gap-1.5 border-b border-line pr-[max(0.375rem,var(--wco-w))] pl-3">
        <Icon icon={ShoppingBasket01Icon} size={14} className="shrink-0 text-ink-2" />
        <span className="pane-title">购物车</span>
        <span className="text-[11px] text-ink-2" data-testid="discover-cart-count">
          {cart.length}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-[12px] text-ink-2" disabled={!cart.length} onClick={clear} data-testid="discover-cart-clear">
          清空
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {cart.length === 0 ? (
          <p className="page-in px-4 py-8 text-center text-[12px] leading-relaxed text-ink-2">点击 tag 后的 + 加入购物车，可整组复制、保存为区块模板或加入 list</p>
        ) : (
          <div className="flex flex-col p-1.5" data-testid="discover-cart-items">
            <AnimatePresence initial={false}>
              {cart.map((n) => (
                <motion.div key={n} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }} className="overflow-hidden">
                  <div className="group flex h-7 items-center gap-1.5 rounded-md pr-1 pl-1.5 hover:bg-surface-2" data-testid="discover-cart-item" data-name={n}>
                    <TagName en={n} zh={lookupTag(n)?.zh} className="min-w-0 flex-1 text-[13px]" />
                    <button
                      type="button"
                      className="grid size-5 shrink-0 place-items-center rounded text-ink-2 hover:bg-surface-3 hover:text-ink-1"
                      onClick={() => useDiscover.getState().removeCart(n)}
                      aria-label={`移除 ${n}`}
                      data-testid="discover-cart-remove"
                    >
                      <Icon icon={Cancel01Icon} size={14} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </ScrollArea>
      <div className="border-t border-line">
        {saving ? (
          <SaveForm key="form" onDone={() => setSaving(false)} />
        ) : (
          <div key="ops" className="page-in flex flex-col gap-1.5 p-2.5">
            {cart.length > 0 && <p className="line-clamp-2 text-[12px] break-words text-ink-2" data-testid="discover-cart-preview">{cart.join(', ')}</p>}
            <CopyButton text={cart.join(', ')} what={`购物车里的 ${cart.length} 个 tag`} label="全部复制" className="w-full" testId="discover-cart-copy" />
            <div className="flex gap-1.5">
              <Button size="sm" className="h-7 min-w-0 flex-1 text-[12px]" disabled={!cart.length} onClick={() => setSaving(true)} data-testid="discover-cart-save">
                保存为区块模板
              </Button>
              {hasLists && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 min-w-0 flex-1 text-[12px]"
                  disabled={!cart.length}
                  onClick={() => useDiscover.getState().set({ put: { tags: cart, from: `购物车中的 ${cart.length} 个` } })}
                  data-testid="discover-cart-put"
                >
                  加入 list…
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

function SaveForm({ onDone }: { onDone: () => void }) {
  const cart = useDiscover((s) => s.cart)
  const templates = useLibrary((s) => s.sectionTemplates)
  const folders = useMemo(() => folderPaths(templates.map((t) => t.folder)), [templates])
  const [folder, setFolder] = useState('')
  const [name, setName] = useState<string | null>(null)
  const [color, setColor] = useState<SectionColor>('slate')
  const def = untitledName(templates.filter((t) => t.folder === folder).map((t) => t.name))
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  const save = () => {
    const lib = useLibrary.getState()
    const t = lib.saveSectionTemplate({ name: (name ?? def).trim() || def, color, folder, chips: cart.map((text) => ({ text, type: 'tag' as const, weight: 1, disabled: false })) })
    toast(`已保存为区块模板「${t.name}」· 模板库 › ${folder || '根目录'}`, { action: { label: '撤销', onClick: () => useLibrary.getState().removeSectionTemplate(t.id) } })
    onDone()
  }
  return (
    <form
      className="page-in flex flex-col gap-2 p-2.5"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.contains(e.target as Node) && onDone()}
      data-testid="discover-save"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-ink-1">保存为区块模板</span>
        <span className="text-[11px] text-ink-2">{cart.length} 个 tag</span>
      </div>
      <label className="flex flex-col gap-1 text-[11px] text-ink-2">
        名字
        <Input ref={input} className="h-7 text-[13px]" value={name ?? def} onChange={(e) => setName(e.target.value)} data-testid="discover-save-name" />
      </label>
      <div className="flex flex-col gap-1 text-[11px] text-ink-2">
        目录
        <FolderPicker value={folder} onChange={setFolder} folders={folders} />
      </div>
      <div className="flex flex-col gap-1 text-[11px] text-ink-2">
        区块色
        <div className="-mx-2">
          <ColorGrid value={color} onPick={setColor} testId="discover-save-color" />
        </div>
      </div>
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" className="h-7 text-[12px]" onClick={onDone}>
          取消
        </Button>
        <Button type="submit" size="sm" className="h-7 text-[12px]" data-testid="discover-save-ok">
          保存
        </Button>
      </div>
    </form>
  )
}
