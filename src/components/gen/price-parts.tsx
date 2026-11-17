import { Anlas } from '@/components/anlas'
import type { RefCost } from '@/lib/nai-refs'

export function PriceParts({ parts, label = '生成' }: { parts: RefCost & { gen: number }; label?: string }) {
  const row = (name: string, n: number) => (
    <span className="flex items-center justify-between gap-4">
      {name}
      <Anlas n={n} />
    </span>
  )
  return (
    <span className="flex min-w-36 flex-col gap-0.5" data-testid="gen-price-parts">
      {row(label, parts.gen)}
      {parts.encode > 0 && row(`Vibe 编码 ${parts.encodeCount} 张`, parts.encode)}
      {parts.extraVibes > 0 && row('Vibe 超过 4 张', parts.extraVibes)}
      {parts.characters > 0 && row('精准参考', parts.characters)}
    </span>
  )
}
