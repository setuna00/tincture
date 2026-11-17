import { useState } from 'react'
import { useGen } from '@/store/gen'
import { AGENT_GEN_TITLE, closeGenConfirm, genDesc, useGenConfirm, type genPrice } from './gen-request'
import { PriceParts } from './price-parts'
import { SpendConfirm } from './spend-confirm'

export function GenConfirm({ tabId, n, parts }: { tabId: string; n: number; parts: ReturnType<typeof genPrice>['parts'] }) {
  const agent = useGenConfirm((s) => !!s.agent)
  const back = useGenConfirm((s) => s.back)
  return (
    <SpendConfirm
      title={<GenTitle />}
      desc={genDesc(n)}
      label="生成"
      price={parts.total}
      runTip={parts.total !== parts.gen ? <PriceParts parts={parts} /> : null}
      onRun={() => {
        const asked = !!useGenConfirm.getState().agent
        closeGenConfirm('run')
        if (!asked) void useGen.getState().generate(tabId)
      }}
      onCancel={() => closeGenConfirm()}
      refocus={back}
      align="end"
      ids={{ box: 'gen-confirm', cancel: 'gen-confirm-cancel', run: 'gen-confirm-run', price: 'gen-confirm-price' }}
      data={{ 'data-agent': agent ? '' : undefined }}
    />
  )
}

function GenTitle() {
  const [agent] = useState(() => !!useGenConfirm.getState().agent)
  return agent ? AGENT_GEN_TITLE : '生成'
}
