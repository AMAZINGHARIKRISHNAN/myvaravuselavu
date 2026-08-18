import { it } from 'vitest'
import { parseExpenseText } from './parseExpenseText'
it('p', () => {
  for (const r of ['lent 5000 to kenji', 'lend 3000 kenji', '2000 loan to arun', 'lent 1500 to ravi cash',
                   'gave 3000 to kenji', '499 cosmos cash', 'lent 5000']) {
    const p = parseExpenseText(r)
    console.log(r.padEnd(24), `amt=${String(p.amount).padEnd(6)}`, `lentTo=${String(p.lentTo||'-').padEnd(8)}`,
      `store=${String(p.store||'-').padEnd(9)}`, `pay=${String(p.paymentMethod||'-').padEnd(6)}`, `note=${p.note||'-'}`)
  }
})
