// Payslips: what was earned, what was taken, and how that moves month to month.
//
// Japanese payslips (給与明細) have a fixed shape — payments on one side,
// deductions on the other, net at the bottom — and the interesting things are
// all in the CHANGES:
//
//   · 住民税 resident tax steps up every June, charged on last year's income.
//     It is the classic take-home shock and it is entirely predictable once
//     you have seen one year of slips.
//   · 健康保険 / 厚生年金 re-grade every September from the April–June average
//     (標準報酬月額), so they step too.
//   · 通勤手当 commuting allowance is money for something this app already
//     measures exactly. The gap between the allowance and what commuting
//     actually cost is real, recurring profit.
//
// NO AI IN THIS FILE. A model may read the image; every number below is
// computed here, offline and tested, so an extraction can be checked rather
// than trusted.

// The lines a slip is broken into. Kept as flat maps rather than free-form so
// two months are always comparable — a slip that calls something else "other"
// still lands in `other` and still adds up.
export const ALLOWANCE_KEYS = ['base', 'overtime', 'commute', 'housing', 'other']
export const DEDUCTION_KEYS = ['health', 'pension', 'employment', 'incomeTax', 'residentTax', 'other']

// Japanese labels, for the extraction prompt and for showing the original term
// next to the English one — the slip in your hand says 厚生年金, not "pension".
export const LINE_LABELS = {
  base: { en: 'Base pay', ja: '基本給' },
  overtime: { en: 'Overtime', ja: '残業手当' },
  commute: { en: 'Commuting allowance', ja: '通勤手当' },
  housing: { en: 'Housing allowance', ja: '住宅手当' },
  health: { en: 'Health insurance', ja: '健康保険' },
  pension: { en: 'Pension', ja: '厚生年金' },
  employment: { en: 'Employment insurance', ja: '雇用保険' },
  incomeTax: { en: 'Income tax', ja: '所得税' },
  residentTax: { en: 'Resident tax', ja: '住民税' },
  other: { en: 'Other', ja: 'その他' },
}

const num = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  // Models hand back "¥16,000" or "16,000円" often enough to be worth handling.
  const cleaned = String(v ?? '').replace(/[^\d.-]/g, '')
  const parsed = parseFloat(cleaned)
  return Number.isFinite(parsed) ? Math.round(parsed) : 0
}

const pickMap = (source, keys) =>
  Object.fromEntries(keys.map((k) => [k, num(source?.[k])]))

// "2026-07" from whatever the model produced.
export function normalizePeriod(value) {
  const text = String(value ?? '').trim()
  const m = text.match(/(\d{4})\D{0,3}(\d{1,2})/)
  if (!m) return ''
  const year = Number(m[1])
  const month = Number(m[2])
  if (month < 1 || month > 12) return ''
  return `${year}-${String(month).padStart(2, '0')}`
}

// Everything downstream assumes this shape, so nothing else has to defend
// against a missing field or a string where a number belongs.
export function normalizePayslip(input) {
  // A default parameter does not catch an explicit null, and the extraction
  // path can hand one over on a failed parse.
  const raw = input || {}
  const allowances = pickMap(raw.allowances, ALLOWANCE_KEYS)
  const deductions = pickMap(raw.deductions, DEDUCTION_KEYS)

  const allowanceTotal = sumMap(allowances)
  const deductionTotal = sumMap(deductions)

  // Gross and net are both printed on a slip, but either can be misread. Fall
  // back to the sum of the lines rather than leaving a zero that would poison
  // every comparison built on top.
  const gross = num(raw.gross) || allowanceTotal
  const net = num(raw.net) || gross - deductionTotal

  return {
    period: normalizePeriod(raw.period),
    gross,
    net,
    allowances,
    deductions,
    workDays: num(raw.workDays),
    overtimeHours: Number.isFinite(Number(raw.overtimeHours)) ? Number(raw.overtimeHours) : 0,
  }
}

const sumMap = (map = {}) => Object.values(map).reduce((s, v) => s + (num(v) || 0), 0)

export const totalAllowances = (p) => sumMap(p?.allowances)
export const totalDeductions = (p) => sumMap(p?.deductions)

// What fraction of the gross you actually keep.
export function takeHomeRate(p) {
  const gross = num(p?.gross)
  if (gross <= 0) return NaN
  return num(p?.net) / gross
}

// The guard that stops a bad read being saved.
//
// A payslip is internally consistent by construction: gross − deductions = net.
// If the extracted numbers do not satisfy that, ONE of them was misread, and
// saving it would corrupt every trend afterwards. ¥1 of slack absorbs rounding.
export function checkConsistency(p, { tolerance = 1 } = {}) {
  const gross = num(p?.gross)
  const net = num(p?.net)
  const deductions = totalDeductions(p)
  const allowances = totalAllowances(p)

  const problems = []
  if (gross <= 0) problems.push('No gross pay found.')
  if (net <= 0) problems.push('No net pay found.')

  const expectedNet = gross - deductions
  if (gross > 0 && Math.abs(expectedNet - net) > tolerance) {
    problems.push(
      `Gross minus deductions is ${expectedNet.toLocaleString()}, but net reads ${net.toLocaleString()}.`
    )
  }
  if (allowances > 0 && Math.abs(allowances - gross) > tolerance) {
    problems.push(
      `Payment lines add to ${allowances.toLocaleString()}, but gross reads ${gross.toLocaleString()}.`
    )
  }
  if (!p?.period) problems.push('No pay period found.')

  return { ok: problems.length === 0, problems }
}

// ---- Uploads ---------------------------------------------------------------

// Gemini accepts a PDF as inline data, and a payroll-portal PDF is text rather
// than pixels — no glare, no skew, no OCR guessing whether that is a 1 or a 7.
// So a PDF is passed through untouched and only photographs are compressed.
const PDF_MIME = 'application/pdf'

// Inline data is base64, which inflates by about a third, and the request has
// to stay well inside Gemini's limit. Payslip PDFs are tens of kilobytes; a
// 12MB one is a scan, and should be sent as a compressed image instead.
export const MAX_PDF_BYTES = 12 * 1024 * 1024

export function payslipFileKind(file) {
  const type = String(file?.type || '').toLowerCase()
  const name = String(file?.name || '').toLowerCase()
  if (type === PDF_MIME || name.endsWith('.pdf')) {
    return file?.size > MAX_PDF_BYTES ? 'pdf-too-big' : 'pdf'
  }
  if (type.startsWith('image/')) return 'image'
  return 'unsupported'
}

// ---- Comparison ------------------------------------------------------------

const byPeriod = (list = []) =>
  [...list].filter((p) => p?.period).sort((a, b) => a.period.localeCompare(b.period))

// Month-on-month movement for every line, plus the headline figures.
export function comparePayslips(list = []) {
  const slips = byPeriod(list)
  return slips.map((slip, i) => {
    const prev = slips[i - 1] || null
    const delta = (now, before) => (prev ? now - before : 0)
    return {
      period: slip.period,
      gross: slip.gross,
      net: slip.net,
      takeHome: takeHomeRate(slip),
      grossDelta: delta(slip.gross, prev?.gross ?? 0),
      netDelta: delta(slip.net, prev?.net ?? 0),
      deductionsTotal: totalDeductions(slip),
      deductionsDelta: delta(totalDeductions(slip), prev ? totalDeductions(prev) : 0),
      lines: Object.fromEntries(
        DEDUCTION_KEYS.map((k) => [
          k,
          { value: slip.deductions[k], delta: delta(slip.deductions[k], prev?.deductions?.[k] ?? 0) },
        ])
      ),
    }
  })
}

// A deduction that jumps and STAYS jumped — a new rate, not a one-off.
//
// This is what catches the June resident-tax rise and the September insurance
// re-grade without knowing anything about the Japanese tax calendar: a step is
// simply a big change that the following months keep.
export function detectSteps(list = [], { minRatio = 0.2, minYen = 1000 } = {}) {
  const slips = byPeriod(list)
  const steps = []

  for (const key of DEDUCTION_KEYS) {
    for (let i = 1; i < slips.length; i++) {
      const before = slips[i - 1].deductions[key] || 0
      const after = slips[i].deductions[key] || 0
      const change = after - before
      if (Math.abs(change) < minYen) continue
      if (before > 0 && Math.abs(change) / before < minRatio) continue

      // A return to where the line sat before the previous change is a spike
      // ending, not a new rate. Without this, a one-off 30,000 in May gets
      // reported twice: once going up, once coming back down.
      // A line reading 0 two months back counts as a real prior value —
      // normalizePayslip() fills every key, so 0 means "nothing was deducted",
      // not "we don't know".
      const twoBack = i >= 2 ? slips[i - 2].deductions?.[key] ?? 0 : null
      if (twoBack !== null && Math.abs(after - twoBack) <= minYen) continue

      // It only counts as a step if it holds. With no later month to check,
      // report it as provisional rather than silently dropping it.
      const following = slips.slice(i + 1)
      const held =
        following.length === 0 ||
        following.every((s) => Math.abs((s.deductions[key] || 0) - after) <= Math.abs(change) / 2)
      if (!held) continue

      steps.push({
        key,
        period: slips[i].period,
        from: before,
        to: after,
        change,
        // What it costs across a year at the new rate.
        annualImpact: change * 12,
        provisional: following.length === 0,
      })
    }
  }

  return steps.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
}

// Per-line movement across the whole history — first seen, last seen, change.
export function deductionTrends(list = []) {
  const slips = byPeriod(list)
  if (slips.length === 0) return []
  const first = slips[0]
  const last = slips[slips.length - 1]

  return DEDUCTION_KEYS.map((key) => {
    const from = first.deductions[key] || 0
    const to = last.deductions[key] || 0
    return {
      key,
      label: LINE_LABELS[key],
      from,
      to,
      change: to - from,
      // Share of the LAST slip's total deductions, so the list can be ordered
      // by what is actually costing you now.
      share: totalDeductions(last) > 0 ? to / totalDeductions(last) : 0,
    }
  })
    .filter((row) => row.from > 0 || row.to > 0)
    .sort((a, b) => b.to - a.to)
}

// The one nobody else can compute: the commuting allowance against what
// commuting actually cost, which this app already knows to the yen.
//
// `actualCost` comes from the commute log — fares, passes, top-ups. Positive
// gap = the allowance more than covers it, which is recurring profit.
export function commuteGap(payslip, actualCost = 0) {
  const allowance = num(payslip?.allowances?.commute)
  const actual = num(actualCost)
  if (allowance <= 0) return null
  return {
    allowance,
    actual,
    gap: allowance - actual,
    coversIt: allowance >= actual,
  }
}

// Averages over the last `months` slips — the baseline a single month is read
// against. Excludes the month being judged, so it never averages with itself.
export function baseline(list = [], { months = 3, excludePeriod = null } = {}) {
  const slips = byPeriod(list).filter((s) => s.period !== excludePeriod)
  const recent = slips.slice(-months)
  if (recent.length === 0) return null
  const mean = (pick) => Math.round(recent.reduce((s, p) => s + pick(p), 0) / recent.length)
  return {
    months: recent.length,
    gross: mean((p) => p.gross),
    net: mean((p) => p.net),
    deductions: mean((p) => totalDeductions(p)),
    takeHome: recent.reduce((s, p) => s + takeHomeRate(p), 0) / recent.length,
  }
}
