// Reading a payslip photograph.
//
// The ONLY place the model touches a payslip. It returns numbers; everything
// that decides whether those numbers are believable lives in payslip.js and
// runs locally, so an extraction is checked rather than trusted.
//
// Sensitivity note, stated plainly because it is not the same as a receipt:
// a payslip carries your employer, your employee number and often your address.
// The whole image is sent. On the free tier prompts may be used to improve
// Google's models. That is why this sits behind its own flag, off by default,
// and why the image is never stored — only the extracted figures are kept.
import { ask, MODEL_FLASH } from './ai'
import { normalizePayslip, checkConsistency, ALLOWANCE_KEYS, DEDUCTION_KEYS, LINE_LABELS } from './payslip'

// Built from the same key lists the rest of the app uses, so a new line can
// never be added to the model's schema and forgotten in the maths.
const lineHint = (keys) =>
  keys.map((k) => `"${k}" (${LINE_LABELS[k].ja} / ${LINE_LABELS[k].en})`).join(', ')

export const PAYSLIP_PROMPT = [
  'You are reading a Japanese payslip (給与明細). Return ONLY JSON, no prose, no code fence.',
  '',
  'Shape:',
  '{',
  '  "period": "YYYY-MM",',
  '  "gross": <総支給額, the total of all payment lines>,',
  '  "net": <差引支給額, the amount actually paid>,',
  `  "allowances": { ${ALLOWANCE_KEYS.map((k) => `"${k}": <number>`).join(', ')} },`,
  `  "deductions": { ${DEDUCTION_KEYS.map((k) => `"${k}": <number>`).join(', ')} },`,
  '  "workDays": <出勤日数>,',
  '  "overtimeHours": <残業時間>',
  '}',
  '',
  `Payment lines map to: ${lineHint(ALLOWANCE_KEYS)}.`,
  `Deduction lines map to: ${lineHint(DEDUCTION_KEYS)}.`,
  '',
  'Rules:',
  '- Every value is a plain integer in yen. No commas, no ¥, no strings.',
  '- Anything you cannot find is 0. Never guess a figure that is not printed.',
  '- Any payment or deduction line that does not match a listed key goes into "other" for that side.',
  '- "period" is the pay MONTH (支給年月). If only a payment date is printed, use its year and month.',
  '- Do not compute or correct anything. Report exactly what is printed, even if the lines do not add up.',
].join('\n')

// Extract, normalise, and check. Returns the slip plus whether it hangs
// together — the caller shows the problems and makes the user resolve them
// rather than saving a slip whose numbers contradict each other.
export async function extractPayslip(imageDataUrl, { model = MODEL_FLASH } = {}) {
  const raw = await ask(PAYSLIP_PROMPT, {
    json: true,
    image: imageDataUrl,
    model,
    feature: 'payslips',
  })

  const payslip = normalizePayslip(raw)
  const consistency = checkConsistency(payslip)

  return { payslip, ...consistency }
}
