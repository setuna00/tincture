import type { ComponentProps, ReactNode } from 'react'

export function TagName({ en, zh, className = '', ...rest }: { en: ReactNode; zh?: string | null } & Omit<ComponentProps<'span'>, 'children'>) {
  const has = !!zh && zh !== en
  return (
    <span className={`tn ${className}`} data-has-zh={has ? '' : undefined} {...rest}>
      <span className="tn-en">{en}</span>
      {has && <span className="tn-zh">{zh}</span>}
    </span>
  )
}

export function LangText({ en, zh }: { en: string; zh: string }) {
  return (
    <>
      <span className="lang-en">{en}</span>
      <span className="lang-zh">{zh}</span>
    </>
  )
}
