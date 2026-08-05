import { describe, it, expect } from 'vitest'
import { askJarvis, sayYen } from './jarvis'

const now = new Date(2026, 7, 1, 12, 0) // 1 Aug 2026

const ctx = {
  now,
  settings: { salaryDate: 25 },
  expenses: [
    { id: 'e1', amount: 450, category: 'Coffee', date: now },
    { id: 'e2', amount: 1200, category: 'Food', date: new Date(2026, 7, 1, 9) },
    { id: 'e3', amount: 5000, category: 'Food', date: new Date(2026, 6, 20) }, // last month
    { id: 'e4', amount: 900, category: 'Food', country: 'IN', date: now }, // rupees
  ],
  income: [{ id: 'i1', amount: 213849, date: now }],
  transfers: [{ id: 't1', amountSent: 100000, fee: 857, date: now }],
  balances: [
    { label: 'MUFJ', balance: 665533, country: 'JP' },
    { label: 'ICICI', balance: 58335, country: 'IN' },
  ],
  cardBalances: { Pasmo: 2370, Edenred: 10000 },
  reimbursement: { outstanding: 2610, toClaim: 0, approved: 2610 },
  profit: { gained: 5000, lost: 336 },
  safe: { perDay: 3200.7, available: 96021, daysLeft: 30 },
  recurring: [
    { id: 'r1', label: 'NTT Docomo', amount: 3126, dayOfMonth: 31, active: true, lastGeneratedMonth: null },
  ],
}

describe('sayYen', () => {
  // Spoken aloud, so no ¥ symbol and no bare numbers a voice would run together.
  it('speaks an amount rather than printing it', () => {
    expect(sayYen(2610)).toBe('2,610 yen')
    expect(sayYen(-336)).toBe('336 yen')
    expect(sayYen(0)).toBe('0 yen')
  })
})

describe('askJarvis', () => {
  const ask = (q) => askJarvis(q, ctx)

  it('offers help when it has nothing to go on', () => {
    expect(askJarvis('', ctx).intent).toBe('help')
    expect(ask('what can you do').intent).toBe('help')
  })

  it('answers what is safe to spend', () => {
    const a = ask('what can I spend today')
    expect(a.intent).toBe('safeToSpend')
    expect(a.speech).toContain('3,200 yen')
  })

  it('says so plainly when the month is already overspent', () => {
    const a = askJarvis('what can i spend', { ...ctx, safe: { perDay: 0, available: -5000, daysLeft: 30 } })
    expect(a.speech).toContain('over budget')
  })

  it('adds up today, ignoring rupee spending', () => {
    const a = ask('how much did I spend today')
    expect(a.speech).toContain('1,650 yen') // 450 + 1200, not the 900 rupees
  })

  it('narrows to one category when asked', () => {
    const a = ask('how much did I spend on food this month')
    expect(a.speech).toContain('1,200 yen') // July's 5,000 is a different month
    expect(a.speech).toContain('food')
  })

  it('reads a named card balance', () => {
    const a = ask("what's my pasmo balance")
    expect(a.speech).toBe('Pasmo has 2,370 yen.')
    expect(a.to).toBe('/balances')
  })

  it('reads a named account balance', () => {
    expect(ask('how much is in MUFJ').speech).toBe('MUFJ has 665,533 yen.')
  })

  it('totals only yen accounts when no account is named', () => {
    const a = ask('what is my balance')
    expect(a.speech).toContain('665,533 yen') // the rupee account stays out
  })

  it('reports what the office owes', () => {
    const a = ask('what does the office owe me')
    expect(a.speech).toContain('2,610 yen')
    expect(a.to).toBe('/reimbursements')
  })

  it('gives both sides of profit and loss', () => {
    const a = ask('how much profit have I made')
    expect(a.speech).toContain('5,000 yen')
    expect(a.speech).toContain('336 yen')
    expect(a.lines).toHaveLength(3)
  })

  it('counts down to salary', () => {
    expect(ask('when is my salary').speech).toBe('Salary is 24 days away.')
  })

  it('lists recurring bills still to come', () => {
    const a = ask('what bills are due')
    expect(a.speech).toContain('3,126 yen')
    expect(a.lines[0]).toContain('NTT Docomo')
  })

  it('summarises the month', () => {
    const a = ask('how am I doing this month')
    expect(a.intent).toBe('month')
    expect(a.lines).toHaveLength(4)
  })

  it('falls through to logging an expense when a real amount is spoken', () => {
    const a = ask('coffee 450 at Starbucks')
    expect(a.intent).toBe('log')
    expect(a.payload.amount).toBe(450)
    expect(a.payload.category).toBe('Coffee')
  })

  // The trap this ordering exists to avoid: a question about coffee spending
  // must never be read as an instruction to log a coffee.
  it('treats a question about a category as a question, not a new expense', () => {
    expect(ask('how much did I spend on coffee').intent).toBe('spent')
  })

  it('admits when it does not understand', () => {
    const a = ask('book me a flight to Chennai')
    expect(a.intent).toBe('unknown')
    expect(a.lines.length).toBeGreaterThan(0)
  })

  it('never throws on an empty context', () => {
    for (const q of ['balance', 'spent today', 'office owe', 'profit', 'due', 'this month', 'salary']) {
      expect(() => askJarvis(q, {})).not.toThrow()
    }
  })
})

// ---- Asking vs telling ------------------------------------------------------
// A sentence naming a card used to be read as a balance query, so reporting a
// bus fare paid with Pasmo answered "Pasmo has 2,370 yen" instead of offering
// to log it.
describe('a stated amount is a report, not a question', () => {
  const ctx = { cardBalances: { Pasmo: 2370 }, balances: [] }
  const ask = (text) => askJarvis(text, ctx)

  it('logs the real sentence that used to return a balance', () => {
    const a = ask(
      'today i traveled in bus from aeon nogata to nogata train station which costed around 270yen i paid with pasmo'
    )
    expect(a.intent).toBe('log')
    expect(a.payload.amount).toBe(270)
    expect(a.payload.category).toBe('Transport')
    expect(a.payload.paymentMethod).toBe('Pasmo')
  })

  it('logs a short statement naming a card', () => {
    expect(ask('i paid 270 with pasmo').intent).toBe('log')
    expect(ask('bus 270 pasmo').intent).toBe('log')
    expect(ask('spent 270 on bus').intent).toBe('log')
  })

  // The other half of the rule: questions must stay questions.
  it('still answers a card balance when asked as a question', () => {
    expect(ask("what's my pasmo balance").intent).toBe('balance')
    expect(ask('pasmo').intent).toBe('balance')
    expect(ask('how much do i have on pasmo').intent).toBe('balance')
  })

  it('still answers a spend question that happens to contain a number', () => {
    expect(ask('can i spend 3000 today').intent).toBe('safeToSpend')
    expect(ask('did i spend 270 today?').intent).toBe('spent')
  })

  it('does not hijack the phrase intents that outrank it', () => {
    expect(ask('salary 300000').intent).toBe('salary')
    expect(ask('does the office owe me 4000').intent).toBe('reimbursements')
  })

  it('surfaces the payment method on the confirm lines', () => {
    expect(ask('coffee 450 pasmo').lines.some((l) => /Paid with Pasmo/.test(l))).toBe(true)
  })
})
