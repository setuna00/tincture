import { MinusSignIcon, PlusSignIcon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'

export function StepButton({ label, direction, disabled, onClick, testId }: { label: string; direction: 'dec' | 'inc'; disabled?: boolean; onClick: () => void; testId: string }) {
  return (
    <button type="button" tabIndex={-1} className="grid h-5 w-[18px] shrink-0 place-items-center rounded-[4px] text-ink-2 transition-colors duration-150 hover:bg-line-strong hover:text-ink-1 disabled:opacity-40" disabled={disabled} onClick={onClick} aria-label={`${label} ${direction === 'dec' ? '减小' : '增大'}`} data-testid={`${testId}-${direction}`}>
      <Icon icon={direction === 'dec' ? MinusSignIcon : PlusSignIcon} size={12} />
    </button>
  )
}
