import type { SectionColor } from '@/types'
import { SECTION_COLORS } from '@/types'
import { sectionTint } from './labels'
import { Tip } from '@/components/tip'

export function ColorGrid({ value, onPick, testId }: { value: SectionColor | null; onPick: (c: SectionColor) => void; testId: string }) {
  return (
    <div className="grid grid-cols-6 gap-1.5 px-2 pb-1.5">
      {(Object.keys(SECTION_COLORS) as SectionColor[]).map((c) => (
        <Tip key={c} label={SECTION_COLORS[c].label}>
          <button
            type="button"
            className="size-4 rounded-full ring-offset-2 ring-offset-popover data-[on]:ring-2"
            style={{ background: sectionTint(c), '--tw-ring-color': sectionTint(c) } as React.CSSProperties}
            data-on={c === value ? '' : undefined}
            onClick={() => onPick(c)}
            data-testid={testId}
          />
        </Tip>
      ))}
    </div>
  )
}

