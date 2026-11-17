import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'

/** shadcn overrides SVG sizes without a size- class; inline dimensions keep the requested icon size authoritative. */
export function Icon({ icon, size = 14, className, strokeWidth = 1.8 }: { icon: IconSvgElement; size?: number; className?: string; strokeWidth?: number }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={strokeWidth} className={className} style={{ width: size, height: size }} />
}
