import { CATEGORIES } from './constants'
import { isRouteCategory, parseRoute, parseDestination } from './route'

const CATEGORY_KEYWORDS = {
  Coffee: ['coffee', 'cafe', 'latte', 'starbucks', 'espresso'],
  Food: ['food', 'lunch', 'dinner', 'breakfast', 'meal', 'groceries', 'grocery', 'restaurant', 'snack', 'eat'],
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
]

// "lunch at Saizeriya 1200" / "milk from Lawson" → the shop name. Everything
// between the preposition and the amount (or the end) is the store, minus any
// trailing payment noise like "cash".
const STORE_RE = /\b(?:at|from)\s+(.+?)(?=\s*\d|$)/i

function extractStore(cleaned) {
  const match = cleaned.match(STORE_RE)
  if (!match) return { store: '', matched: null }
  const store = match[1]
    .split(/\s+/)
    .filter((word) => word && !NOISE_WORDS.includes(word.toLowerCase()))
    .join(' ')
    .replace(/[.,;:]+$/, '')
    .trim()
  return store ? { store, matched: match[0] } : { store: '', matched: null }
}

// Picks the amount out of the text: strips digit-group commas ("1,200" → 1200),
// and prefers numbers that stand alone over ones glued to words ("7-eleven").
function extractAmount(text) {
  const cleaned = text.replace(/(\d),(?=\d)/g, '$1')
  const candidates = [...cleaned.matchAll(/\d+(?:\.\d+)?/g)]
  if (candidates.length === 0) return { amount: null, cleaned, matched: null }

  const isWordChar = (ch) => ch !== undefined && /[A-Za-z-]/.test(ch)
  const standalone = candidates.find(
    (m) => !isWordChar(cleaned[m.index - 1]) && !isWordChar(cleaned[m.index + m[0].length])
  )
  const match = standalone || candidates[0]
  return { amount: parseFloat(match[0]), cleaned, matched: match[0] }
}

// Parses short shorthand like "coffee 450" or "lunch at Saizeriya 1,200 debit card"
// entirely client-side — no network call, no secret key involved.
export function parseExpenseText(text) {
  const lower = text.toLowerCase()

  const { amount, cleaned, matched } = extractAmount(text)

  let category = 'Other'
  for (const cat of CATEGORIES) {
    const keywords = CATEGORY_KEYWORDS[cat]
    if (keywords?.some((kw) => lower.includes(kw))) {
      category = cat
      break
    }
  }

  let paymentMethod = null
  for (const [keyword, label] of Object.entries(PAYMENT_KEYWORDS)) {
    if (lower.includes(keyword)) {
      paymentMethod = label
      break
    }
  }

  // Transport is a journey, not a purchase: the two places are the record, and
  // letting the store regex have the sentence is what produced a "shop" called
  // "aeon nogata to nogata train station which costed around".
  let fromPlace = ''
  let toPlace = ''
  if (isRouteCategory(category)) {
    const route = parseRoute(cleaned)
    fromPlace = route.from
    toPlace = route.to
    // One-way mention with no origin — "bus to Kokura".
    if (!toPlace) toPlace = parseDestination(cleaned)
  }

  // A journey keeps its places instead of a shop name; everything else keeps
  // the shop. Both fields exist on the record either way, so nothing that reads
  // an expense has to care which kind it is.
  const { store, matched: storePhrase } = toPlace ? { store: '', matched: null } : extractStore(cleaned)

  const note = cleaned
    .replace(matched ?? '', '')
    // The shop lives in its own field now, so "at Lawson" leaves the note.
    .replace(storePhrase ?? '', '')
    .split(/\s+/)
    .filter((word) => word && !NOISE_WORDS.includes(word.toLowerCase()))
    .join(' ')
    .trim()

  return { amount, category, paymentMethod, store, fromPlace, toPlace, note }
}
