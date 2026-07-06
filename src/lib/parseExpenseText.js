import { CATEGORIES } from './constants'

const CATEGORY_KEYWORDS = {
  Coffee: ['coffee', 'cafe', 'latte', 'starbucks', 'espresso'],
  Food: ['food', 'lunch', 'dinner', 'breakfast', 'meal', 'groceries', 'grocery', 'restaurant', 'snack', 'eat'],
  Transport: ['transport', 'taxi', 'cab', 'train', 'bus', 'metro', 'uber', 'gas', 'fuel', 'parking', 'toll'],
  Shopping: ['shopping', 'clothes', 'amazon', 'mall', 'shoes', 'electronics'],
  Bills: ['bill', 'bills', 'rent', 'electricity', 'water', 'internet', 'phone', 'subscription', 'insurance'],
  Health: ['health', 'doctor', 'medicine', 'pharmacy', 'hospital', 'clinic', 'gym'],
  Fun: ['movie', 'cinema', 'game', 'fun', 'party', 'bar', 'drinks', 'concert'],
}

const PAYMENT_KEYWORDS = {
  cash: 'Cash',
  upi: 'UPI',
  edenred: 'Edenred',
}

const NOISE_WORDS = ['yen', 'jpy', '¥', 'cash', 'upi', 'edenred', 'debit', 'credit', 'card']

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

  const note = cleaned
    .replace(matched ?? '', '')
    .split(/\s+/)
    .filter((word) => word && !NOISE_WORDS.includes(word.toLowerCase()))
    .join(' ')
    .trim()

  return { amount, category, paymentMethod, note }
}
