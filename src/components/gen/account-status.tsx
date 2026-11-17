import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { hasOpus, usageImages, usageIsLow, usagePercent, usagePurchased, usageRefillPerDay, type OpusUsage } from '@/lib/nai-api'
import { accountOf, useNai } from '@/store/nai'

const fmt = (n: number) => n.toLocaleString('en-US')

export function AccountStatus() {
  const state = useNai((s) => s.account)
  const always = useNai((s) => s.alwaysShowOpus)
  const a = accountOf(state)
  if (state.status === 'none') return null
  if (!a)
    return state.status === 'error' ? (
      <span className="font-sans text-[11px]" data-testid="account-status" data-state="error">
        {state.error === 'unauthorized' ? 'NAI 令牌无效' : '无法连接 NAI'}
      </span>
    ) : null
  const usage = hasOpus(a) && a.usage && (always || usageIsLow(a.usage)) ? a.usage : null
  const text = (
    <span className="tabular-nums" data-testid="account-status" data-state={state.status}>
      {usage && (
        <>
          Opus 额度 <span data-testid="opus-percent">{fmt(usagePercent(usage))}%</span>
          {' · '}
        </>
      )}
      <span data-testid="anlas">{fmt(a.anlas)}</span> Anlas
    </span>
  )
  if (!usage) return text
  return (
    <Tooltip>
      <TooltipTrigger asChild>{text}</TooltipTrigger>
      <TooltipContent side="top" align="end" className="flex flex-col gap-0.5 font-sans" data-testid="opus-detail">
        <OpusDetail u={usage} />
      </TooltipContent>
    </Tooltip>
  )
}

function OpusDetail({ u }: { u: OpusUsage }) {
  const p = usagePercent(u)
  const extra = usagePurchased(u)
  const rate = usageRefillPerDay(u)
  return (
    <>
      <span>
        剩余 {fmt(p)}%{extra > 0 && `，额外 +${fmt(extra)}%`}（约 {fmt(usageImages(p + extra))} 张）
      </span>
      {u.percent > 100 ? <span>超过 100% 时停止回复</span> : rate > 0 && <span>每天回复 {fmt(rate)}%（约 {fmt(usageImages(rate))} 张）</span>}
      {p <= 0 && extra <= 0 && <span>Opus 额度已用完，回复前生成将消耗 Anlas</span>}
    </>
  )
}
