import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'

export const DROPDOWN_KIT = {
  Item: DropdownMenuItem,
  CheckboxItem: DropdownMenuCheckboxItem,
  RadioGroup: DropdownMenuRadioGroup,
  RadioItem: DropdownMenuRadioItem,
  Label: DropdownMenuLabel,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
}
export type MenuKit = typeof DROPDOWN_KIT

export const CONTEXT_KIT = {
  Item: ContextMenuItem,
  CheckboxItem: ContextMenuCheckboxItem,
  RadioGroup: ContextMenuRadioGroup,
  RadioItem: ContextMenuRadioItem,
  Label: ContextMenuLabel,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
} as unknown as MenuKit

/** Right-click focuses the field for paste; freeze focus-driven resizing until typing or left-click so contextmenu hit-testing stays on the field. */
export function keepNativeMenuOnFields(e: React.MouseEvent) {
  const field = (e.target as HTMLElement).closest<HTMLElement>('input, textarea, [contenteditable="true"]')
  if (!field) return
  if (e.type === 'mousedown') {
    if (e.button === 2 && document.activeElement !== field) holdSize(field)
  } else e.stopPropagation()
}

function holdSize(field: HTMLElement) {
  field.dataset.ctxFocus = ''
  const release = () => {
    delete field.dataset.ctxFocus
    field.removeEventListener('blur', release)
    field.removeEventListener('input', release)
    field.removeEventListener('pointerdown', onPointer)
  }
  const onPointer = (ev: PointerEvent) => ev.button === 0 && release()
  field.addEventListener('blur', release)
  field.addEventListener('input', release)
  field.addEventListener('pointerdown', onPointer)
}
