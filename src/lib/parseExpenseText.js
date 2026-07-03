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

// Parses short shorthand like "coffee 450" or "lunch at Saizeriya 1200 debit card"
// entirely client-side — no network call, no secret key involved.
export function parseExpenseText(text) {
  const lower = text.toLowerCase()

  const amountMatch = text.match(/\d+(\.\d+)?/)
  const amount = amountMatch ? parseFloat(amountMatch[0]) : null

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

  const note = text
    .replace(amountMatch ? amountMatch[0] : '', '')
    .split(/\s+/)
    .filter((word) => word && !NOISE_WORDS.includes(word.toLowerCase()))
    .join(' ')
    .trim()

  return { amount, category, paymentMethod, note }
}
