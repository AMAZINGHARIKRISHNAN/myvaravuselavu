import { useEffect, useRef } from 'react'
import { useSettings } from './useSettings'
import { useBatchOps } from './useBatchOps'
import { useToast } from '../context/ToastContext'
import { formatJPY } from '../lib/format'
import { EDENRED_MONTHLY, edenredCreditDue, edenredCreditOp } from '../lib/wallet'

// The company's ¥10,000 Edenred credit, added on the first app open on or
// after the 16th.
//
// This used to live inside a component that was later dropped from the
// Dashboard for duplicating the Accounts card. Nothing noticed, because the
// effect had no output of its own — so the credit simply stopped happening and
// the card sat empty. It is a hook now so it belongs to no particular screen,
// and the rule it follows is a tested function rather than a condition buried
// in JSX.
export function useEdenredCredit() {
  const { settings, save } = useSettings()
  const batchOps = useBatchOps()
  const { toast } = useToast()
  // Guards against a second run while the first is still in flight; a failure
  // clears it so the next open tries again.
  const running = useRef(false)

  useEffect(() => {
    if (running.current) return
    const monthKey = edenredCreditDue(settings)
    if (!monthKey) return
    running.current = true
    ;(async () => {
      try {
        await batchOps([edenredCreditOp(monthKey)])
        await save({ edenredLastCredit: monthKey })
        toast(`🍴 ${formatJPY(EDENRED_MONTHLY.amount)} Edenred credit from company added`)
      } catch {
        running.current = false // retry on the next open
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.edenredLastCredit, Boolean(settings)])
}
