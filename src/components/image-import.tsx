import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FolderLibraryIcon, Image01Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/tip'
import { ensurePermission, fsSupported, hasPermission, pickDir, saveImageWithPrompt, savedDir, type SavedImage } from '@/lib/image-store'
import { useDocStore } from '@/store/context'

type Dir = Awaited<ReturnType<typeof pickDir>>

export function ImageImport() {
  const store = useDocStore()
  const [dir, setDir] = useState<Dir | null>(null)
  const [granted, setGranted] = useState(false)
  const [over, setOver] = useState(false)
  const [queue, setQueue] = useState<File[]>([])
  const [saved, setSaved] = useState<SavedImage[]>([])
  const supported = fsSupported()

  useEffect(() => {
    if (!supported) return
    savedDir().then(async (d) => {
      if (!d) return
      setDir(d)
      setGranted(await hasPermission(d).catch(() => false))
    })
  }, [supported])

  const save = async (d: Dir, files: File[]) => {
    for (const f of files) {
      try {
        const r = await saveImageWithPrompt(d, f, store.getState().doc)
        setSaved((s) => [r, ...s].slice(0, 6))
      } catch (e) {
        toast.error(`${f.name} 保存失败：${(e as Error).message}`)
        return
      }
    }
    toast.success(`已保存 ${files.length} 张图片到「${d.name}」，每张附带 .prompt.json`)
  }

  const choose = async () => {
    try {
      const d = await pickDir()
      setDir(d)
      setGranted(true)
      if (queue.length) {
        await save(d, queue)
        setQueue([])
      }
    } catch {
    }
  }

  const authorize = async () => {
    if (!dir) return
    if (await ensurePermission(dir)) {
      setGranted(true)
      if (queue.length) {
        await save(dir, queue)
        setQueue([])
      }
    }
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setOver(false)
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
    if (!files.length) return toast.error('仅支持拖入图片')
    if (dir && granted) return save(dir, files)
    // Browser folder permission requests require user activation; queue images until a button click grants access.
    setQueue((q) => [...q, ...files])
  }

  return (
    <div className="flex flex-col gap-2 border-t border-line p-3" data-testid="image-import">
      <div className="flex items-center gap-1.5">
        <Icon icon={Image01Icon} size={14} className="text-ink-2" />
        <span className="label-caps">保存生成图</span>
        {dir && (
          <Tip label="更换文件夹">
            <button type="button" className="ml-auto flex items-center gap-1 truncate text-[11px] text-ink-2 hover:text-ink-1" onClick={choose}>
              <Icon icon={FolderLibraryIcon} size={14} />
              {dir.name}
            </button>
          </Tip>
        )}
      </div>
      {!supported ? (
        <p className="text-[11px] leading-relaxed text-ink-2">保存到本地文件夹需要 Chrome 或 Edge</p>
      ) : (
        <div
          className="grid min-h-20 place-items-center rounded-md border border-dashed border-line-strong px-3 py-3 text-center text-[12px] leading-relaxed text-ink-2 data-[over]:border-lamp-text data-[over]:bg-surface-2 data-[over]:text-ink-1"
          data-over={over ? '' : undefined}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          data-testid="image-drop"
        >
          {queue.length ? (
            <div className="flex flex-col items-center gap-2">
              <span>{queue.length} 张图等待保存</span>
              {dir ? (
                <Button size="xs" onClick={authorize}>
                  授权写入「{dir.name}」
                </Button>
              ) : (
                <Button size="xs" onClick={choose}>
                  选择保存文件夹
                </Button>
              )}
            </div>
          ) : (
            <span>
              将生成的图片拖动到此处
              <br />
              {dir ? `保存到「${dir.name}」，附带结构化 prompt` : '首次使用需选择文件夹'}
            </span>
          )}
        </div>
      )}
      {saved.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-[11px] text-ink-2">
          {saved.map((s) => (
            <Tip key={s.file} label={s.json}>
              <li className="truncate">
                ✓ {s.file}
              </li>
            </Tip>
          ))}
        </ul>
      )}
    </div>
  )
}
