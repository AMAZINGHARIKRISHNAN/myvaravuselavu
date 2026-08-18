import { CATEGORIES } from './constants'
import { sourceCountry } from './currencyAudit'
import { isRouteCategory, parseRoute, parseDestination } from './route'
import { categoryForMerchant, normalizeStore, storeKey } from './stores'

// Order matters: the first category whose keyword appears wins, so the narrow
// ones are listed before the broad ones. 'snack' used to sit inside Food, which
// meant a snack could never be parsed as anything else.
const CATEGORY_KEYWORDS = {
  Snacks: ['snack', 'snacks', 'coffee', 'cafe', 'latte', 'starbucks', 'espresso', 'chocolate', 'biscuit', 'chips', 'ice cream'],
  Gifts: ['gift', 'gifts', 'present', 'birthday', 'wedding', 'souvenir', 'omiyage'],
  Food: ['food', 'lunch', 'dinner', 'breakfast', 'meal', 'groceries', 'grocery', 'restaurant', 'eat'],
  Transport: ['transport', 'taxi', 'cab', 'train', 'bus', 'metro', 'uber', 'gas', 'fuel', 'parking', 'toll'],
  Shopping: ['shopping', 'clothes', 'amazon', 'mall', 'shoes', 'electronics'],
  Bills: ['bill', 'bills', 'rent', 'electricity', 'water', 'internet', 'phone', 'subscription', 'insurance'],
  Health: ['health', 'doctor', 'medicine', 'pharmacy', 'hospital', 'clinic', 'gym'],
  Fun: ['movie', 'cinema', 'game', 'fun', 'party', 'bar', 'drinks', 'concert'],
}

// Every non-account method the app knows — see NON_ACCOUNT_PAYMENT_METHODS in
// constants.js. Pasmo and nimoca were missing here, so "paid with pasmo" parsed
// to a null method and the draft came back with no card selected.
const PAYMENT_KEYWORDS = {
  cash: 'Cash',
  upi: 'UPI',
  edenred: 'Edenred',
  pasmo: 'Pasmo',
  nimoca: 'nimoca',
}

const NOISE_WORDS = [
  'yen', 'jpy', '¥', 'cash', 'upi', 'edenred', 'pasmo', 'nimoca', 'debit', 'credit', 'card',
  'rs', 'inr', 'rupee', 'rupees', '₹',
]

// A word that named the CATEGORY is not also the name of a shop. This is the
// rule that keeps "coffee 450" from inventing a shop called "coffee" while
// still letting "499 cosmos" find one called Cosmos.
const CATEGORY_WORDS = new Set(
  Object.values(CATEGORY_KEYWORDS)
    .flat()
    .flatMap((keyword) => keyword.split(' '))
)

// Grammar rather than content. None of these can be part of a shop name, so
// dropping them is what turns "i paid 499 at cosmos" into "Cosmos" instead of
// "i paid at cosmos".
const STOPWORDS = new Set([
  'i', 'me', 'my', 'we', 'a', 'an', 'the', 'at', 'from', 'to', 'for', 'on', 'in', 'of', 'and',
  'with', 'by', 'it', 'this', 'that', 'there', 'then', 'also', 'via', 'using', 'just', 'some',
  'paid', 'pay', 'spent', 'spend', 'bought', 'buy', 'got', 'get', 'gave', 'give', 'sent', 'send',
  'used', 'use', 'cost', 'costs', 'costed', 'around', 'about', 'approx', 'total', 'was', 'were',
  'is', 'today', 'yesterday', 'morning', 'afternoon', 'evening', 'night',
])

// Words that appear in half the account labels ever written and therefore
// identify none of them — "card" must not resolve to "SBI Card".
const GENERIC_ACCOUNT_WORDS = new Set([
  'bank', 'card', 'account', 'savings', 'saving', 'current', 'credit', 'debit', 'wallet', 'the',
])

// Beyond this many consecutive unrecognised words it is prose, not a shop name.
// The guard exists because a sentence typed at the assistant used to come back
// with a "shop" called "aeon nogata to nogata train station which costed around".
const MAX_STORE_WORDS = 4

const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu

// "lunch at Saizeriya 1200" / "milk from Lawson" → the shop name. Everything
// between the preposition and the amount (or the end) is the store, minus any
// trailing payment noise like "cash".
const STORE_RE = /\b(?:at|from)\s+(.+?)(?=\s*\d|$)/i

function extractStore(cleaned, claimed) {
  const match = cleaned.match(STORE_RE)
  if (!match) return { store: '', matched: null }
  const words = []
  // Stops at the first word that cannot be part of a name, rather than reading
  // to the end of the sentence: "at cosmos with icici" is a shop and a card,
  // and taking the lot produced a shop called "cosmos with icici".
  for (const word of match[1].split(/\s+/)) {
    const key = word.toLowerCase().replace(EDGE_PUNCTUATION, '')
    if (!key) continue
    if (NOISE_WORDS.includes(key) || STOPWORDS.has(key) || claimed?.has(key)) break
    words.push(word)
  }
  const store = words
    .join(' ')
    .replace(/[.,;:]+$/, '')
    .trim()
  return store
    ? { store, matched: match[0], start: match.index, end: match.index + match[0].length }
    : { store: '', matched: null }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// Written out rather than built from the arrays above: a regex assembled from
// a template literal needs its backslashes doubled, and one that quietly loses
// them still compiles — it simply never matches anything again.
const DAY_MONTH = /\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i
const MONTH_DAY = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/i
const WEEKDAY =
  /\b(?:last\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|mon|tues?|weds?|thur?s?|fri|sat|sun)\b/i
const RELATIVE_DAY = /\b(today|tonight|yesterday|last night)\b/i

const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12)
const shiftDays = (from, days) => dayStart(new Date(from.getTime() + days * 86400000))

// When it happened, if the line said so.
//
// Not a nicety. "12 sep dinner 3000" was read as a 12-yen dinner, because the
// first number in the line won and nothing recognised "12 sep" as a date — so
// the date is found FIRST and its words struck out before anything looks for
// an amount at all.
//
// Only ever backwards. An expense has already happened, so a weekday names the
// most recent one and a day/month still ahead belongs to last year.
function extractDate(text, now) {
  const today = dayStart(now)

  const relative = text.match(RELATIVE_DAY)
  if (relative) {
    const word = relative[1].toLowerCase()
    const isToday = word === 'today' || word === 'tonight'
    return { date: isToday ? today : shiftDays(today, -1), match: relative }
  }

  const dayMonth = text.match(DAY_MONTH)
  const monthDay = dayMonth ? null : text.match(MONTH_DAY)
  const named = dayMonth || monthDay
  if (named) {
    const day = Number(dayMonth ? named[1] : named[2])
    const month = MONTHS.indexOf((dayMonth ? named[2] : named[1]).slice(0, 3).toLowerCase())
    if (day >= 1 && day <= 31 && month >= 0) {
      let date = new Date(today.getFullYear(), month, day, 12)
      if (date > today) date = new Date(today.getFullYear() - 1, month, day, 12)
      // Rejects the 31st of a 30-day month rather than rolling into the next.
      if (date.getDate() === day) return { date, match: named }
    }
  }

  const weekday = text.match(WEEKDAY)
  if (weekday) {
    const said = weekday[1].toLowerCase().slice(0, 3)
    const index = WEEKDAYS.findIndex((d) => d.startsWith(said))
    if (index >= 0) {
      // The most recent one that has actually been: "friday" said on a Friday
      // means today, not a week ago.
      const back = (today.getDay() - index + 7) % 7
      return { date: shiftDays(today, -back), match: weekday }
    }
  }

  return { date: null, match: null }
}

// Picks the amount out of the text: strips digit-group commas ("1,200" -> 1200),
// and prefers numbers that stand alone over ones glued to words ("7-eleven").
function extractAmount(text) {
  const cleaned = text.replace(/(\d),(?=\d)/g, '$1')

  // "3k", "1.2k" — how a thousand gets typed when the whole point is not to.
  const thousands = cleaned.match(/\b(\d+(?:\.\d+)?)k\b/i)
  if (thousands) {
    return {
      amount: Math.round(parseFloat(thousands[1]) * 1000),
      cleaned,
      matched: thousands[0],
      start: thousands.index,
      end: thousands.index + thousands[0].length,
    }
  }

  const candidates = [...cleaned.matchAll(/\d+(?:\.\d+)?/g)]
  if (candidates.length === 0) return { amount: null, cleaned, matched: null, start: -1, end: -1 }

  const isWordChar = (ch) => ch !== undefined && /[A-Za-z-]/.test(ch)
  const standalone = candidates.find(
    (m) => !isWordChar(cleaned[m.index - 1]) && !isWordChar(cleaned[m.index + m[0].length])
  )
  const match = standalone || candidates[0]
  return {
    amount: parseFloat(match[0]),
    cleaned,
    matched: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }
}

// The sentence as words, each knowing where it sat, so a word can be claimed by
// the amount, the payment method or the shop exactly once.
function tokenize(text) {
  return [...text.matchAll(/\S+/g)].map((m) => {
    const clean = m[0].replace(EDGE_PUNCTUATION, '')
    return {
      clean,
      word: clean.toLowerCase(),
      start: m.index,
      end: m.index + m[0].length,
      drop: false, // not part of the note
      store: false, // claimed by the shop name
    }
  })
}

const overlaps = (token, start, end) => start >= 0 && token.start < end && token.end > start

// Which payment method the sentence names, and which words said so.
//
// The five keywords are fixed; the accounts are yours, so "3400 aeon mufj"
// resolves to whatever you called that bank. Generic words are excluded because
// an account labelled "SBI Card" must not be selected by the word "card".
function extractPayment(tokens, accounts) {
  const words = new Set(tokens.map((t) => t.word).filter(Boolean))
  let paymentMethod = null

  for (const [keyword, label] of Object.entries(PAYMENT_KEYWORDS)) {
    if (words.has(keyword)) {
      paymentMethod = label
      break
    }
  }

  const claimed = new Set()
  for (const account of accounts || []) {
    const label = String(account?.label || '').trim()
    if (!label) continue
    const parts = (label.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(
      (part) => part.length >= 3 && !GENERIC_ACCOUNT_WORDS.has(part)
    )
    const hits = parts.filter((part) => words.has(part))
    if (hits.length === 0) continue
    for (const hit of hits) claimed.add(hit)
    if (!paymentMethod) paymentMethod = label
  }

  return { paymentMethod, claimed }
}



// A shop this device has seen before, found anywhere in the sentence.
//
// Matched on the same normalised key the frequency list uses, so "family mart",
// "Family Mart" and "familymart" all land on the one entry — and the CANONICAL
// spelling comes back, not whatever was typed this time. The longest name wins,
// so "7-Eleven Kokura" beats "7-Eleven" when both are known.
function matchKnown(tokens, known) {
  if (!known?.length) return null
  const keys = tokens.map((t) => storeKey(t.clean))
  let best = null

  for (const entry of known) {
    const parts = String(entry?.name || '')
      .split(/\s+/)
      .map(storeKey)
      .filter(Boolean)
    // A one-letter shop would match the article "a" in every sentence typed.
    if (parts.length === 0 || parts.join('').length < 2) continue

    for (let i = 0; i + parts.length <= keys.length; i++) {
      if (!parts.every((part, j) => keys[i + j] === part)) continue
      const span = parts.length
      const bestSpan = best ? best.to - best.from : 0
      if (span > bestSpan || (span === bestSpan && (entry.count || 0) > (best.entry.count || 0))) {
        best = { entry, from: i, to: i + span }
      }
      break
    }
  }
  return best || nearlyKnown(tokens, keys, known)
}

// One typo away from a shop you use. "lawsn 938" is a Lawson expense, and
// failing to see that costs two questions and a retype.
//
// Deliberately narrow. Five characters or more, so short words cannot collide;
// one edit only; and it must be the ONLY near match there is — two candidates
// mean it does not know, and a shop guessed wrong is worse than a shop left
// blank for you to type.
const MIN_FUZZY = 5

function nearlyKnown(tokens, keys, known) {
  const candidates = []

  for (const entry of known) {
    const key = storeKey(entry?.name)
    if (key.length < MIN_FUZZY) continue
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].length < MIN_FUZZY || !oneEditApart(keys[i], key)) continue
      candidates.push({ entry, from: i, to: i + 1 })
      break
    }
  }

  if (candidates.length !== 1) return null
  return candidates[0]
}

// True when two strings are one insertion, deletion or substitution apart.
// Cheaper and clearer than a full edit-distance matrix for a question that only
// ever asks about one.
function oneEditApart(a, b) {
  if (a === b) return false
  if (Math.abs(a.length - b.length) > 1) return false

  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  let i = 0
  let j = 0
  let edits = 0
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i += 1
      j += 1
      continue
    }
    if (++edits > 1) return false
    // Same length means a substitution; otherwise the longer one has the extra.
    if (short.length === long.length) i += 1
    j += 1
  }
  return edits + (long.length - j) <= 1
}

const capitalise = (word) => word.charAt(0).toUpperCase() + word.slice(1)

// The words nothing else claimed — but only when they are ONE unbroken run.
//
// That is the whole test for "is this shorthand?". In "3400 aeon groceries
// mufj" everything is accounted for except "aeon", so "aeon" is the shop. In
// "i went out with friends and had a really good long dinner 3400" there are
// four separate scraps left over, which is prose, and prose does not name a
// shop — it used to come back with one called "Really Good Long".
function unclaimedRun(tokens) {
  const runs = []
  let current = []
  for (const token of tokens) {
    if (token.candidate) {
      current.push(token)
    } else if (current.length > 0) {
      runs.push(current)
      current = []
    }
  }
  if (current.length > 0) runs.push(current)

  if (runs.length !== 1) return []
  return runs[0].length <= MAX_STORE_WORDS ? runs[0] : []
}

// Parses shorthand — "coffee 450", "499 cosmos cash", "1200 sukesan udon
// edenred" — entirely client-side. No network call, no key, no model.
//
// Options:
//   accounts — your accounts, so their labels count as payment methods
//   known    — storeMemory(), so a shop you have logged before comes back with
//              its usual spelling, category and card
//
// Nothing here writes. Both callers hand the result to a screen that a person
// confirms, which is what makes a learned guess safe: it is a filled-in form,
// never a saved record.
export function parseExpenseText(text, { accounts = [], known = [], now = new Date() } = {}) {
  const input = String(text ?? '')
  const lower = input.toLowerCase()

  // The date first, and struck out before anything looks for a number: the day
  // in "12 sep" is not the amount, and used to be taken as one.
  const { date, match: dateMatch } = extractDate(input, now)
  const withoutDate = dateMatch
    ? input.slice(0, dateMatch.index) + ' '.repeat(dateMatch[0].length) + input.slice(dateMatch.index + dateMatch[0].length)
    : input

  const { amount, cleaned, start: amountStart, end: amountEnd } = extractAmount(withoutDate)

  let keywordCategory = null
  for (const cat of CATEGORIES) {
    const keywords = CATEGORY_KEYWORDS[cat]
    if (keywords?.some((kw) => lower.includes(kw))) {
      keywordCategory = cat
      break
    }
  }

  // Transport is a journey, not a purchase: the two places are the record, and
  // letting the store regex have the sentence is what produced a "shop" called
  // "aeon nogata to nogata train station which costed around".
  let fromPlace = ''
  let toPlace = ''
  if (isRouteCategory(keywordCategory || 'Other')) {
    const route = parseRoute(cleaned)
    fromPlace = route.from
    toPlace = route.to
    // One-way mention with no origin — "bus to Kokura".
    if (!toPlace) toPlace = parseDestination(cleaned)
  }

  const tokens = tokenize(cleaned)
  const { paymentMethod: statedPayment, claimed } = extractPayment(tokens, accounts)

  for (const token of tokens) {
    token.drop =
      overlaps(token, amountStart, amountEnd) ||
      !token.word ||
      token.word.length < 2 ||
      /^\d+(?:\.\d+)?$/.test(token.word) || // a stray figure — a date, a quantity
      NOISE_WORDS.includes(token.word) ||
      STOPWORDS.has(token.word) ||
      claimed.has(token.word)
  }

  // A journey keeps its places instead of a shop name; everything else keeps
  // the shop. Both fields exist on the record either way, so nothing that reads
  // an expense has to care which kind it is.
  let store = ''
  let learned = null
  if (!toPlace) {
    // Said outright — "at Saizeriya" — is always believed over anything
    // inferred, and the whole phrase leaves the note.
    const explicit = extractStore(cleaned, claimed)
    if (explicit.store) {
      store = explicit.store
      for (const token of tokens) {
        if (overlaps(token, explicit.start, explicit.end)) token.store = true
      }
    }

    // Remembered. Runs over the whole sentence, including any explicit phrase,
    // so a known shop comes back spelled the way it is already saved.
    const hit = matchKnown(tokens, known)
    if (hit && (!store || storeKey(hit.entry.name) === storeKey(store))) {
      learned = hit.entry
      store = hit.entry.name
      for (let i = hit.from; i < hit.to; i++) tokens[i].store = true
    }

    // Unrecognised, but nothing else claimed these words either — the terse
    // case, where the shop is simply named with no preposition in front of it.
    if (!store) {
      for (const token of tokens) {
        token.candidate = !token.drop && !token.store && !CATEGORY_WORDS.has(token.word)
      }
      const run = unclaimedRun(tokens)
      if (run.length > 0) {
        // Shorthand is typed in lower case and a shop chip reading "cosmos"
        // looks like a mistake. Only what was typed flat is lifted, so "MUFJ"
        // or "7-eleven" keep the shape they were given.
        store = run.map((t) => (t.clean === t.word ? capitalise(t.clean) : t.clean)).join(' ')
        for (const token of run) token.store = true
      }
    }
  }

  const note = tokens
    .filter((token) => !token.drop && !token.store)
    .map((token) => token.clean)
    .join(' ')
    .trim()

  const paymentMethod = statedPayment || learned?.paymentMethod || null
  // Said > remembered > recognised as a chain > ask. A word in this sentence
  // outranks a habit, because it is what you meant this time.
  const category = keywordCategory || learned?.category || categoryForMerchant(store)

  return {
    amount,
    // Null when the line said nothing about when — the entry sheet fills in
    // today, exactly as it does for a record typed by hand.
    date,
    category: category || 'Other',
    // Whether anything actually decided that, or it simply fell to the app's
    // word for "no idea". A caller that means to ASK needs to tell the two
    // apart: 'Other' chosen deliberately is an answer, 'Other' by default is
    // a question nobody put.
    categoryKnown: Boolean(category),
    paymentMethod,
    // THE CURRENCY RULE, read from the one function in the app that answers it.
    // The method decides: an account label carries its account's currency, a
    // named card carries its own. A draft that filled in the card but not the
    // currency used to reach the confirm step reading yen.
    //
    // sourceCountry returns null for Cash, which genuinely holds both. Only
    // then does the shop's own history get a say — and only ever as the last
    // word, never over a method that already settled it.
    country: sourceCountry(paymentMethod, accounts) || learned?.country || null,
    store: normalizeStore(store),
    fromPlace,
    toPlace,
    note,
  }
}
