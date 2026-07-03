# MyVaravuSelavu 💰

A personal income/expense tracker for a single user living and working in Japan
(salary in JPY) who sends money home to family in India. Tracks income, expenses
(both Japan and India side), and international transfers, with charts, budgets,
recurring transactions, and a fast natural-language "quick add".

Single-user app — no public signup, just email/password sign-in for the owner.
Runs entirely on Firebase's free **Spark** plan: no Cloud Functions, no paid APIs.

## Features

### Entry & capture
- **Quick add** — type shorthand like `coffee 450` or `lunch at Saizeriya 1200 debit card`
  and it's parsed into amount, category, and payment method entirely **client-side**
  (keyword matching, no network call, no API key). Falls back to the manual form when
  it can't confidently parse an amount.
- **Voice input** — quick add also accepts speech via the Web Speech API on supported
  browsers (🎤 button).
- **Manual entry flow** — keypad → category grid → payment method grid → save, for
  fast thumb-only entry on mobile.
- **CSV import** — bulk-import expenses, income, or transfers from a CSV file.
- **CSV export** — export any filtered view (expenses, income, transfers) to CSV.

### Dashboard
- Month-over-month summary cards (income, expenses, sent to family, savings rate)
  with trend badges vs. the previous month.
- Net savings hero card with **share-as-image** (renders a summary card to a canvas
  and shares/downloads it as PNG).
- Auto-generated insights ("Coffee is your top spend", "Transport is up 20% vs last
  month", savings-rate trend).
- Month-end spend forecast, projected from the current day-of-month run rate.
- Budget progress bars per category, with automatic "near budget" / "over budget"
  toast alerts.
- Emergency fund tracker (all-time net savings vs. a configurable goal).
- Onboarding checklist for first-time setup (salary, join date, PIN).
- "Due this month" recurring-transaction reminders with one-tap add/skip.

### Charts
- Year-in-review summary (income, expenses, sent, saved).
- Spend by category and by payment method (pie charts), with a JP/India toggle
  when both currencies are in play.
- Income vs. expenses vs. transfers, last 6 months (bar chart).
- Savings-rate trend (line chart).
- Full dark-mode-aware theming (Recharts colors adapt to the active theme).

### Transfers (Japan → India)
- "Your journey" card: total salary earned, total sent home, and total saved since
  a configurable join date.
- Live JPY→INR exchange rate (fetched from a free, keyless API, cached for 1 hour)
  compared against your historical average, with a "good time to send" indicator.
- Per-transfer log with recipient, method, fee, and exchange rate (auto-calculated
  if left blank).
- Insights: totals this year, average exchange rate, total fees, best-performing
  transfer method, and breakdown by recipient.
- Optional family savings goal tracker (e.g. "New house — ₹10,00,000").

### History
- Filterable list of income and expenses (date range, category, country, payment
  method, free-text search over notes).
- Edit and delete with **undo** (soft-delete with a toast to undo before it's final).

### Recurring transactions
- Define recurring income, expenses, or transfers (e.g. rent, salary, monthly
  remittance) with a day-of-month trigger.
- Optional auto-post (silently logged on the due date) or manual confirm via the
  "Due this month" card.

### Settings
- Salary amount and pay date.
- Manage payment accounts (label, country) used across entry forms.
- Per-category monthly budget caps.
- Emergency fund goal and family savings goal.
- Light/dark theme toggle.
- **App lock** — optional device PIN (SHA-256 hashed, stored locally) with a
  brute-force lockout after 5 failed attempts.

### Platform
- Installable **PWA** (manifest + service worker via `vite-plugin-pwa`), works
  offline for the app shell.
- Fully responsive, mobile-first UI with light/dark mode.
- Auth-gated routing, error boundary, loading skeletons, toast notifications.

## Tech stack

| Layer       | Choice |
|-------------|--------|
| Frontend    | React 19 + Vite |
| Styling     | Tailwind CSS 4 |
| Routing     | React Router 7 |
| Charts      | Recharts |
| Backend     | Firebase (Firestore + Firebase Auth + Hosting) — Spark (free) plan |
| Parsing     | Client-side keyword parser (`src/lib/parseExpenseText.js`) — no server, no AI API key |
| Exchange rate | [open.er-api.com](https://open.er-api.com) (free, keyless, cached client-side) |
| PWA         | `vite-plugin-pwa` |
| Lint        | Oxlint |

No Cloud Functions and no third-party AI API are used — everything runs client-side
against Firestore, which keeps the whole app on Firebase's free tier.

## Data model (Firestore)

All data lives under `users/{uid}/...` so security rules scope everything to the
signed-in owner:

```
users/{uid}/profile/settings   — salary, accounts, budgets, goals, join date
users/{uid}/income/{id}        — amount, date, source, gross, net, note
users/{uid}/expenses/{id}      — amount, date, category, country, paymentMethod, note
users/{uid}/transfers/{id}     — date, amountSent, amountReceived, exchangeRate, fee, recipient, method, note
users/{uid}/recurring/{id}     — kind (income|expense|transfer), amount, label, dayOfMonth, autoPost, active
```

Firestore rules (`firestore.rules`) restrict all reads/writes to
`request.auth.uid == uid`; everything else is denied by default.

## Project structure

```
src/
  components/
    entry/      Manual/quick-add entry flow (EntryFlow, Keypad, CategoryGrid,
                 PaymentMethodGrid, QuickAdd, IncomeForm, TransferForm, RecurringForm)
    dashboard/   Dashboard-only widgets (BudgetProgress, OnboardingChecklist,
                 RecurringDue, ShareSummaryButton)
    layout/      App shell & auth gating (Layout, RequireAuth, PinGate,
                 ErrorBoundary, ThemeToggle, ToastContainer)
    ui/          Generic, reusable pieces (CollapsibleSection, EmptyState,
                 FloatingActionButton, Skeleton, CsvImportButton)
  context/      React context providers (auth, theme, toasts)
  hooks/        Data hooks (Firestore collections, settings, recurring, live rate, undo-delete, speech)
  lib/          Framework-free helpers (Firestore data layer, CSV, dates, formatting, expense parsing, app lock)
  pages/        Route-level views (Dashboard, Charts, Transfers, History, Settings, Login)
```

## Getting started

```bash
npm install
npm run dev       # start the Vite dev server
npm run build      # production build to dist/
npm run preview    # preview the production build locally
npm run lint        # run Oxlint
```

### Firebase setup

1. Create a Firebase project and enable **Firestore** and **Authentication**
   (email/password provider).
2. Copy `.env.example` to `.env` and fill in your project's web app config
   (Firebase console → Project settings → General → Your apps):

```bash
cp .env.example .env
```

3. Create the single owner account once via the Firebase console (no in-app signup).
4. Deploy Firestore rules/indexes and hosting:

```bash
firebase deploy --only firestore:rules,firestore:indexes,hosting
```

## Security notes

- **No secrets in the repo.** Firebase web config lives in `.env` (gitignored);
  `.env.example` has the placeholder keys. Firestore access is enforced by
  `firestore.rules` (owner-only, deny-by-default), not by keeping the config
  secret — Firebase's web API key is not a bearer credential.
- **No public signup.** `AuthContext` only exposes `signInWithEmailAndPassword`;
  the owner account is created once via the Firebase console.
- **No AI/API keys.** Quick-add parsing is a client-side keyword parser
  ([`src/lib/parseExpenseText.js`](src/lib/parseExpenseText.js)) — there's no
  Groq/OpenAI key or Cloud Function to leak.
- Recommended hardening if you fork this: in the Google Cloud console, restrict
  the Firebase API key to your app's HTTP referrers, and double-check
  `firestore.rules` before deploying to a new project.

## License

Personal project — not currently licensed for reuse.
