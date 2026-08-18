import { describe, it, expect } from 'vitest'
import { parseExpenseText } from './parseExpenseText'
import { currencyMismatches } from './currencyAudit'

describe('parseExpenseText', () => {
  it('parses a simple "category amount" phrase', () => {
    const result = parseExpenseText('coffee 450')
    expect(result.amount).toBe(450)
    expect(result.category).toBe('Snacks')
    expect(result.note).toBe('coffee')
  })

  it('parses amounts with digit-group commas', () => {
    const result = parseExpenseText('lunch 1,200')
    expect(result.amount).toBe(1200)
    expect(result.category).toBe('Food')
  })

  it('parses decimal amounts', () => {
    expect(parseExpenseText('taxi 12.50').amount).toBe(12.5)
  })

  it('prefers standalone numbers over digits glued to words', () => {
    const result = parseExpenseText('7-eleven snack 450')
    expect(result.amount).toBe(450)
    // 'snack' used to be a Food keyword; it has its own category now.
    expect(result.category).toBe('Snacks')
  })

  it('falls back to the first number when none stand alone', () => {
    expect(parseExpenseText('450yen coffee').amount).toBe(450)
  })

  it('returns null amount when there is no number', () => {
    expect(parseExpenseText('coffee with friends').amount).toBeNull()
  })

  it('detects payment methods', () => {
    expect(parseExpenseText('groceries 3000 upi').paymentMethod).toBe('UPI')
    expect(parseExpenseText('lunch 900 cash').paymentMethod).toBe('Cash')
    expect(parseExpenseText('dinner 1500 edenred').paymentMethod).toBe('Edenred')
    expect(parseExpenseText('dinner 1500').paymentMethod).toBeNull()
  })

  it('defaults to Other for unknown categories', () => {
    expect(parseExpenseText('mystery thing 800').category).toBe('Other')
  })

  it('strips the amount and noise words from the note', () => {
    const result = parseExpenseText('lunch at Saizeriya 1200 debit card')
    expect(result.amount).toBe(1200)
    expect(result.note).toBe('lunch')
  })

  it('pulls the store out of "at <shop>"', () => {
    const result = parseExpenseText('lunch at Saizeriya 1200 debit card')
    expect(result.store).toBe('Saizeriya')
  })

  it('pulls the store out of "from <shop>" and after the amount', () => {
    expect(parseExpenseText('milk 250 from Family Mart').store).toBe('Family Mart')
  })

  it('drops payment words trailing the store name', () => {
    const result = parseExpenseText('coffee at Starbucks cash 450')
    expect(result.store).toBe('Starbucks')
    expect(result.paymentMethod).toBe('Cash')
    expect(result.note).toBe('coffee')
  })

  it('leaves the store empty when no shop is named', () => {
    expect(parseExpenseText('coffee 450').store).toBe('')
  })
})

// ---- Journeys ---------------------------------------------------------------
// Transport is a route, not a purchase. Before this the store regex swallowed
// the whole sentence and produced a "shop" called
// "aeon nogata to nogata train station which costed around".
describe('transport routes', () => {
  it('splits the real sentence into two places and no shop', () => {
    const r = parseExpenseText(
      'today i traveled in bus from aeon nogata to nogata train station which costed around 270yen i paid with pasmo'
    )
    expect(r.category).toBe('Transport')
    expect(r.amount).toBe(270)
    expect(r.fromPlace).toBe('Aeon Nogata')
    expect(r.toPlace).toBe('Nogata Train Station')
    expect(r.paymentMethod).toBe('Pasmo')
    expect(r.store).toBe('')
  })

  it('reads the short forms', () => {
    expect(parseExpenseText('bus 270 from nogata to kokura')).toMatchObject({
      fromPlace: 'Nogata',
      toPlace: 'Kokura',
    })
    expect(parseExpenseText('train 500 nogata → hakata')).toMatchObject({
      fromPlace: 'Nogata',
      toPlace: 'Hakata',
    })
  })

  it('takes a destination alone when no origin was said', () => {
    const r = parseExpenseText('bus 270 to kokura')
    expect(r.fromPlace).toBe('')
    expect(r.toPlace).toBe('Kokura')
  })

  // The other categories must be completely unaffected.
  it('leaves a shop purchase as a shop purchase', () => {
    const r = parseExpenseText('lunch at saizeriya 1200')
    expect(r.store).toBe('saizeriya')
    expect(r.fromPlace).toBe('')
    expect(r.toPlace).toBe('')
  })

  it('does not invent a route from a non-transport sentence containing "to"', () => {
    const r = parseExpenseText('gave 3000 to kenji')
    expect(r.fromPlace).toBe('')
    expect(r.toPlace).toBe('')
  })
})

// ---- Terse shorthand --------------------------------------------------------
// How this is actually typed: an amount, a shop, maybe a card. No prepositions,
// no punctuation, often no category word at all — "499 cosmos cash".
describe('terse shorthand', () => {
  const ACCOUNTS = [
    { label: 'MUFJ', country: 'JP' },
    { label: 'ICICI Bank', country: 'IN' },
  ]
  const parse = (text, extra) => parseExpenseText(text, { accounts: ACCOUNTS, ...extra })

  it('reads an amount, a shop and a card out of three words', () => {
    expect(parse('499 cosmos cash')).toMatchObject({
      amount: 499,
      store: 'Cosmos',
      paymentMethod: 'Cash',
      note: '',
    })
  })

  it('keeps a two-word shop name together', () => {
    expect(parse('1200 sukesan udon edenred')).toMatchObject({
      amount: 1200,
      store: 'Sukesan Udon',
      paymentMethod: 'Edenred',
      category: 'Food', // from the dish in the name
    })
  })

  it('reads the shop when the amount comes second', () => {
    expect(parse('lawson 938')).toMatchObject({ amount: 938, store: 'Lawson', category: 'Food' })
  })

  it('takes an account label as the payment method', () => {
    expect(parse('3400 aeon groceries mufj')).toMatchObject({
      paymentMethod: 'MUFJ',
      category: 'Food', // said outright, not inferred
      store: 'Aeon',
    })
  })

  it('matches an account whose label carries a suffix', () => {
    expect(parse('1500 amazon icici').paymentMethod).toBe('ICICI Bank')
  })

  // An account called "SBI Card" must not be selected by the word "card".
  it('does not resolve a generic word to an account', () => {
    expect(parse('4990 uniqlo card').paymentMethod).toBe(null)
    expect(parse('4990 uniqlo card').store).toBe('Uniqlo')
  })

  it('never turns a category word into a shop', () => {
    expect(parse('450 coffee').store).toBe('')
    expect(parse('280 bus').store).toBe('')
    expect(parse('3000 rent').store).toBe('')
  })

  // THE GUARD. Everything unclaimed has to be one run of words, because that is
  // what "the shop is the only thing left" looks like. A sentence leaves several
  // scraps, and it used to come back with a shop called "Really Good Long".
  it('refuses to invent a shop out of prose', () => {
    const r = parse('i went out with friends yesterday and had a really good long dinner 3400')
    expect(r.amount).toBe(3400)
    expect(r.store).toBe('')
    expect(r.category).toBe('Food')
  })

  it('stops an explicit shop name at the card that follows it', () => {
    expect(parse('paid 1200 at cosmos with icici')).toMatchObject({
      store: 'cosmos',
      paymentMethod: 'ICICI Bank',
    })
  })

  it('leaves a shop typed with capitals alone', () => {
    expect(parse('890 Family Mart pasmo').store).toBe('Family Mart')
  })

  it('still parses when nothing is passed at all', () => {
    expect(parseExpenseText('499 cosmos cash')).toMatchObject({ amount: 499, store: 'Cosmos' })
  })
})

// ---- What this device has learned ------------------------------------------
// storeMemory() feeds these: the shops already saved on this phone, with the
// category and card each usually gets. Nothing here reaches the network.
describe('shops this device remembers', () => {
  const known = [{ name: 'Cosmos', count: 9, category: 'Health', paymentMethod: 'nimoca' }]
  const parse = (text) => parseExpenseText(text, { known })

  it('spells the shop the way it is already saved', () => {
    expect(parse('499 COSMOS').store).toBe('Cosmos')
    expect(parse('499 cosmos').store).toBe('Cosmos')
  })

  it('fills in the category and the card it usually gets', () => {
    expect(parse('499 cosmos')).toMatchObject({ category: 'Health', paymentMethod: 'nimoca' })
  })

  // A word in THIS sentence is what you meant this time; the habit is only a
  // fallback for what you left out.
  it('lets what was typed outrank the habit', () => {
    expect(parse('dinner 900 cosmos upi')).toMatchObject({
      category: 'Food',
      paymentMethod: 'UPI',
      store: 'Cosmos',
    })
  })

  it('canonicalises a shop said with a preposition too', () => {
    expect(parse('lunch at cosmos 900').store).toBe('Cosmos')
  })

  it('ignores a remembered shop that was not mentioned', () => {
    expect(parse('450 coffee')).toMatchObject({ store: '', category: 'Snacks', paymentMethod: null })
  })
})

// ---- The currency ----------------------------------------------------------
// The rule the whole app rests on: the payment METHOD decides the currency,
// nothing else. A parsed draft lands on the confirm step, so a card filled in
// without its currency is a yen figure one tap from being saved as rupees.
describe('the currency follows the method', () => {
  const ACCOUNTS = [
    { label: 'MUFJ', country: 'JP' },
    { label: 'ICICI Bank', country: 'IN' },
  ]
  const parse = (text, extra) => parseExpenseText(text, { accounts: ACCOUNTS, ...extra })

  it('reads an Indian account as rupees', () => {
    expect(parse('1500 amazon icici')).toMatchObject({ paymentMethod: 'ICICI Bank', country: 'IN' })
  })

  it('reads a Japanese account as yen', () => {
    expect(parse('3400 aeon mufj')).toMatchObject({ paymentMethod: 'MUFJ', country: 'JP' })
  })

  it('takes a fixed-currency card from its name, with no accounts at all', () => {
    expect(parseExpenseText('270 bus pasmo').country).toBe('JP')
    expect(parseExpenseText('300 chai upi').country).toBe('IN')
  })

  // Cash is the one method that genuinely holds both, so it must not answer.
  it('says nothing for cash, or for no method at all', () => {
    expect(parse('499 cosmos cash').country).toBe(null)
    expect(parse('450 coffee').country).toBe(null)
  })

  // A remembered card is still a card: prefilling the method without its
  // currency is exactly how a rupee expense gets stored as yen.
  it('carries the currency of a remembered account too', () => {
    const known = [{ name: 'Reliance', count: 3, category: 'Food', paymentMethod: 'ICICI Bank' }]
    expect(parse('1450 reliance', { known })).toMatchObject({
      paymentMethod: 'ICICI Bank',
      country: 'IN',
    })
  })

  it('never takes the currency from the shop', () => {
    const known = [{ name: 'Reliance', count: 3, category: 'Food', paymentMethod: null }]
    expect(parse('1450 reliance', { known }).country).toBe(null)
  })
})

// The end of the chain: what the parser produces, checked by the audit that
// looks for records whose currency does not match the card that paid for them.
describe('a parsed draft survives the currency audit', () => {
  const ACCOUNTS = [
    { id: '1', label: 'MUFJ', country: 'JP' },
    { id: '2', label: 'ICICI Bank', country: 'IN' },
  ]

  it('agrees with the auditor about every method it can resolve', () => {
    const drafts = ['1500 amazon icici', '3400 aeon mufj', '270 bus pasmo', '300 chai upi'].map(
      (text, i) => ({ ...parseExpenseText(text, { accounts: ACCOUNTS }), id: String(i) })
    )
    expect(drafts.map((d) => d.country)).toEqual(['IN', 'JP', 'JP', 'IN'])
    expect(currencyMismatches({ expenses: drafts }, ACCOUNTS)).toEqual([])
  })
})

// ---- When it happened -------------------------------------------------------
// Logging yesterday's coffee this morning is the common case, and the app used
// to file it as today. Worse: "12 sep dinner 3000" was read as a ¥12 dinner,
// because the first number in the line won.
describe('the day it happened', () => {
  // A Tuesday.
  const NOW = new Date(2026, 7, 18, 9, 30)
  const parse = (text) => parseExpenseText(text, { now: NOW })
  const ymd = (d) => (d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : null)

  it('reads yesterday, and last night', () => {
    expect(ymd(parse('yesterday 450 coffee').date)).toBe('2026-8-17')
    expect(ymd(parse('last night 3400 izakaya cash').date)).toBe('2026-8-17')
  })

  it('reads today as today', () => {
    expect(ymd(parse('today 450 coffee').date)).toBe('2026-8-18')
  })

  it('reads a weekday as the most recent one that has been', () => {
    expect(ymd(parse('friday 890 lawson').date)).toBe('2026-8-14')
    expect(ymd(parse('sat 2000 cinema').date)).toBe('2026-8-15')
    // Said on a Tuesday, "tuesday" is today — not a week ago.
    expect(ymd(parse('tuesday 280 bus').date)).toBe('2026-8-18')
  })

  it('reads a day and a month, either way round', () => {
    expect(ymd(parse('12 aug dinner 3000').date)).toBe('2026-8-12')
    expect(ymd(parse('aug 3 1500 amazon').date)).toBe('2026-8-3')
  })

  // An expense has already happened, so a date still ahead is last year's.
  it('never dates an expense in the future', () => {
    expect(ymd(parse('12 sep dinner 3000').date)).toBe('2025-9-12')
  })

  it('refuses a day that month does not have', () => {
    expect(parse('31 feb 900 lunch').date).toBe(null)
  })

  // THE BUG THIS FIXES. The day was taken as the amount.
  it('does not mistake the date for the amount', () => {
    expect(parse('12 sep dinner 3000').amount).toBe(3000)
    expect(parse('aug 3 1500 amazon').amount).toBe(1500)
    // And the month is not a shop either.
    expect(parse('12 sep dinner 3000').store).toBe('')
  })

  it('says nothing about the day when the line did not', () => {
    expect(parse('499 cosmos cash').date).toBe(null)
  })
})

// "3k" is how a thousand gets typed when the whole point is not to type.
describe('amounts written short', () => {
  it('reads k as a thousand', () => {
    expect(parseExpenseText('3k rent').amount).toBe(3000)
    expect(parseExpenseText('1.2k uniqlo').amount).toBe(1200)
    expect(parseExpenseText('12K deposit').amount).toBe(12000)
  })

  it('leaves a word that merely contains a k alone', () => {
    expect(parseExpenseText('450 kfc').amount).toBe(450)
    expect(parseExpenseText('890 kokura station').amount).toBe(890)
  })
})

// A shop you use every week, typed in a hurry.
describe('one typo away from a shop it knows', () => {
  const known = [
    { name: 'Lawson', count: 9, category: 'Food', paymentMethod: 'Edenred' },
    { name: 'Sukesan Udon', count: 4, category: 'Food', paymentMethod: 'Cash' },
  ]
  const parse = (text) => parseExpenseText(text, { known })

  it('recognises a missing letter, an extra one, or a wrong one', () => {
    expect(parse('938 lawsn').store).toBe('Lawson')
    expect(parse('938 lawsson').store).toBe('Lawson')
    expect(parse('938 lawsen').store).toBe('Lawson')
  })

  it('brings the category and card with it, as an exact match would', () => {
    expect(parse('938 lawsn')).toMatchObject({ category: 'Food', paymentMethod: 'Edenred' })
  })

  it('will not stretch to two edits', () => {
    expect(parse('938 lwsn').store).toBe('Lwsn')
  })

  // Short words collide constantly — "cash" is one edit from "cast", "cast"
  // from "cost". Nothing under five characters is corrected.
  it('leaves short words alone', () => {
    expect(parseExpenseText('450 mart', { known: [{ name: 'Mars', count: 2 }] }).store).toBe('Mart')
  })

  it('refuses when two known shops are equally close', () => {
    const twins = [{ name: 'Cosmos', count: 3 }, { name: 'Cosmox', count: 3 }]
    expect(parseExpenseText('499 cosmoz', { known: twins }).store).toBe('Cosmoz')
  })

  it('never overrules an exact match', () => {
    const both = [{ name: 'Lawson', count: 9, category: 'Food' }, { name: 'Lawsan', count: 99, category: 'Fun' }]
    expect(parseExpenseText('938 lawson', { known: both })).toMatchObject({
      store: 'Lawson',
      category: 'Food',
    })
  })
})
