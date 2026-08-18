# MyVaravuSelavu — Project Analysis

Read-only audit. Every claim below cites files and line ranges. Where I could not
determine something from the code, it says **unknown** rather than guessing.

Audit date: 2026-08-15 · Branch: `hardening/currency-data-and-perf` · HEAD `b5eddef`

---

## 1. Executive summary

- **What it is.** A single-user personal finance PWA for an Indian expat in Japan:
  income/expense tracking across **two currencies that are never summed**, India
  remittances, commuter reimbursement, prepaid transit/meal cards, shared-household
  splits, payslip parsing, and a local-first assistant. React 19 + Vite (Rolldown) +
  Firebase Spark, no server. 168 source files / 33,998 lines (`find src`), 63 lib
  modules.
- **Genuine strength: the money core is unusually well pinned.** 1,081 passing tests
  across 64 files, and the ¥/₹ separation is enforced through *one* function
  (`countryOf`, `src/lib/money.js:28-32`) that overrules stored data using the payment
  method. Four independent audit suites (`mathAudit`, `ledgerAudit`, `tallyAudit`,
  `currencyAudit`) test invariants rather than examples.
- **Genuine strength: the comments explain causes, not mechanics.** Most non-obvious
  code carries the failure that motivated it (e.g. `src/lib/wallet.js:100-108` on why a
  cutoff is `>=`). This is rare and materially lowers the cost of changing this code.
- **Top risk — the Gemini API key is live, public, and unrestricted.** Verified: it
  ships in the live entry chunk, and the API accepts it with **no referrer** and with a
  **forged referrer**. See §7 and finding H-1.
- **Top risk — `commitOps`, the atomicity primitive the whole data model depends on,
  has zero test coverage.** No test file imports `src/lib/firestore.js`. See §8, H-2.
- **Two real half-write paths bypass it** (Trips delete, group-expense edit) — H-3, H-4.
- **Opportunity.** The AI privacy work (`minimalContext`) is built, tested, and
  currently **inert** — while the shipped AI path sends a wider surface without going
  through it. Aligning those is a small change with a real payoff (§11).
- **Caveat on scope.** The component layer has 5 test files against ~90 components;
  every defect that reached production recently was in that layer (§8).

---

## 2. Architecture map

**Entry points.** `src/main.jsx:1-5` mounts `App` inside `StrictMode` and calls
`reloadForNewBuild()` from `src/lib/lazyWithRetry.js` (stale-chunk recovery after a
deploy).

**Provider tree** — `src/App.jsx:53-118`, outermost first:

```
ErrorBoundary → ThemeProvider → ToastProvider → BrowserRouter → AuthProvider
  → Routes → RequireAuth → PinGate → Layout → <Page> per route
```

`Page` (`src/App.jsx:69-77`) wraps each route in **its own** `ErrorBoundary` keyed by
route name plus a `Suspense`. The key matters: React holds a boundary's error state
until the subtree remounts.

**Routing** — 20 routes, `src/App.jsx:80-110`. `/login` plus 19 authenticated routes:
`/`, `/charts`, `/transfers`, `/friends`, `/groups`, `/commute`, `/balances`, `/cash`,
`/reimbursements`, `/profit`, `/shopping`, `/notes`, `/trips`, `/review`, `/audit`,
`/reconcile`, `/history`, `/payslips`, `/settings`.
`Login` and `Dashboard` are eager imports (`src/App.jsx:11-12`); the other 19 use
`lazyWithRetry` (19 occurrences).

**Navigation model** — `src/components/layout/navigation.js`. One exported model
(`TABS`, `GROUPS`, `REACHABLE`) consumed by the phone tab bar, the More sheet and the
desktop sidebar. Pinned by `src/components/layout/navigation.test.js:17-33`, which reads
the routes out of `App.jsx` itself and fails if any route lacks a nav entry.

**State flow — three layers:**

1. **Contexts** (`src/context/`): `AuthContext` (Firebase user, login/logout, memoised
   value `AuthContext.jsx`), `ThemeContext` (theme + skin + HUD + boot state), and
   `ToastContext`, which is **split in two** — `ToastDispatchContext` (stable) and
   `ToastStateContext` (changes per toast), `src/context/ToastContext.jsx:4-18`. Only
   the renderer subscribes to the list.
2. **Shared subscription registry** (`src/lib/subscriptionRegistry.js`): one live
   Firestore listener per key, ref-counted, with a **60-second grace period** after the
   last consumer releases (`GRACE_MS`, line ~28) so navigating away and back costs
   nothing. `src/lib/liveData.js` registers every registry so `AuthContext` can close
   them all at sign-out.
3. **Hooks** (`src/hooks/`, 15 files): `useCollection` keys by `uid|collection` **only**
   (`src/hooks/useCollection.js`, `keyFor`), subscribes all-time, and applies date
   windows locally via `withinRange` (`src/lib/dateRanges.js`). `useSettings`,
   `useRecurring`, `useAccountBalances`, `useBatchOps`, `useCollectionWriters`.

**Build** — `vite.config.js`. Manual chunk groups for `firebase` and `react-vendor`;
`define` injects `__APP_VERSION__`, `__APP_COMMIT__`, `__APP_BUILT_AT__` (surfaced by
`src/components/dashboard/BuildStamp.jsx`). `VitePWA` with `registerType: 'autoUpdate'`,
`manifest: false`, and a broad `globPatterns` precache. Vitest runs `environment: 'node'`
with jsdom opted into per file by docblock.

**Hosting** — `firebase.json`: catch-all `**` → `no-cache` (so the SPA shell is never
stale), icons 1 day, `/assets/**` immutable for a year. Order matters and is commented.

---

## 3. Data model

All user data lives under `users/{uid}/…`. **23 collections** (verified against
`src/lib/backup.js:9`, which is the canonical manifest) plus one settings document at
`users/{uid}/profile/settings` (`src/lib/firestore.js:211`).

| Collection | Purpose | Key fields (inferred from writers) |
|---|---|---|
| `expenses` | Core spending | `amount, category, paymentMethod, country, store, note, date, tripId?, groupEntryId?, commuteTripId?, friend?` |
| `income` | Money in | `amount, source, account, country, date, gross?, net?` |
| `transfers` | India remittances + self-transfers | `amountSent, amountReceived, fee, rate, fromAccount?, toAccount?, recipient, date` |
| `recurring` | Templates | `kind, amount, label, dayOfMonth, active, autoPost, lastGeneratedMonth, paymentMethod, country` |
| `groups` / `groupExpenses` | Shared household ledger | group: `name, members[], country`; entry: `groupId, paidBy, amount, shares` |
| `commuteTrips` / `commuteClaims` / `commutePasses` | Reimbursable commuting | trip: `date, fare, expenseId`; pass: `paidFrom, cost, startDate, endDate` |
| `pasmoRecharges` | Prepaid card top-ups | `card, amount, setTo?, paidFrom, date, auto?` |
| `officeReimbursements` | Out-of-pocket work spend | `item, amount, claimAmount, paidWith, date, receipt?` |
| `onlineOrders` / `storePoints` | Temu/Shein/Amazon | `store, item, total, points, status, returnBy` |
| `friendPurchases` | Money fronted for friends | `friend, amount, recovered, country` |
| `windfalls` / `losses` | Profit & loss | `paid, recovered, kind, label, status, tripId?` |
| `withdrawals` | Bank → cash | `account, amount, country, date` |
| `accountEntries` | Hand-logged moves; both halves of a Move | `account, direction, amount, country, moveId?, moveFrom?, moveTo?` |
| `cashCounts` | Physical cash counts | `country, denoms{}, total, date` |
| `trips` | Journeys | `name, startDate, endDate, carrier?, note, date` |
| `monthAudits` / `reconciles` | Month-end sign-off | audit totals, reconcile anchors |
| `notes` | Lists/reminders | `text, done, pinned, date` |

**Universal invariant.** Every collection is read through
`subscribeToCollection` (`src/lib/firestore.js:34-41`), which orders by `date`.
Firestore omits documents missing the ordered field, so **a record without `date` is
invisible everywhere**. `addRecord`/`addRecords`/`commitOps` now stamp one when absent
(`withDate`, `src/lib/firestore.js`), and `findDatelessRecords` + `src/lib/invisible.js`
provide the recovery path for pre-existing ones.

**Atomic linked pairs via `commitOps`** (`src/lib/firestore.js:81-102`). `data` may be
`(ids) => ({…})` so two records can reference each other's generated id in one commit:

- Commute trip + its expense mirror — `src/pages/Commute.jsx:106-112`
- Group entry + its personal expense mirror — `src/pages/Groups.jsx:79-96`
- Windfall + its income record — `src/pages/Profit.jsx:143`
- Loss + its expense record — `src/pages/Profit.jsx:185`
- Trip + the expenses/losses of one story — `src/lib/storyIntake.js:313,344`
- Split entry + its parts — `src/components/entry/EntryFlow.jsx:372`, `:626-630`
- Move money: both halves — `src/lib/moveMoney.js`

`commitOps` **refuses** rather than silently splitting past Firestore's 500-op limit
(`src/lib/firestore.js:82-86`) — correct, and the error text is user-facing.

### Half-write risks (paths that bypass the guarantee)

- **`src/pages/Trips.jsx:446-447`** — deleting a trip untags its expenses in one
  chunked call, then deletes the trip in a *separate* call. If the second fails,
  expenses are untagged but the trip survives; if untagging spans >400 ops and the
  delete then succeeds, some expenses keep a `tripId` pointing at a deleted trip. The
  code comment claims this ordering prevents orphans; it reduces but does not remove
  the window.
- **`src/components/entry/EntryFlow.jsx:589-599`** — editing an expense that mirrors a
  group entry does `await update(...)` then `await updateGroupEntry(...)`. Not atomic:
  a failure between them leaves the personal expense and the group's split maths
  disagreeing about the amount.
- 18 call sites use `useCollectionWriters` (single-document writes). Most are genuinely
  standalone; the two above are the ones where a linked counterpart exists.

---

## 4. Feature inventory

| Route | What it does | Reads / writes |
|---|---|---|
| `/` Dashboard | Month totals, safe-to-spend, insights, glance strip, accounts card, build stamp, speed-dial entry | `expenses`, `income`, `transfers` (this + prev month + all-time), 7 profit collections, settings |
| `/history` | Three tabs: All activity (merged feed), Expenses, Income. Search, CSV import/export, edit/delete | `expenses`, `income` + 10 more for the All tab |
| `/charts` | Category/store/trend charts, savings rate, streaks | `expenses`, `income`, `transfers` over month/6-month/year windows |
| `/balances` (Wallet) | Bank balances, prepaid cards, cash, per-source history sheet, top-ups | settings accounts, `pasmoRecharges`, `expenses`, `officeReimbursements`, `commutePasses`, `withdrawals`, `accountEntries`, `transfers` |
| `/cash` | Denomination-by-denomination cash count, per currency | `cashCounts`, `expenses`, `withdrawals`, `income` |
| `/transfers` | India remittances (rate, fee, received) and self-transfers | `transfers` |
| `/friends` | Money fronted for friends and recovery | `friendPurchases` |
| `/groups` | Shared household ledger, members, splits, settle-up | `groups`, `groupExpenses` (+ mirrored `expenses`) |
| `/commute` | Daily bus trips, passes, claims, Pasmo/nimoca top-ups | `commuteTrips`, `commutePasses`, `commuteClaims`, `pasmoRecharges` |
| `/reimbursements` | Out-of-pocket work spend → reports → paid | `officeReimbursements` (+ `income` on payment) |
| `/profit` | Every gain and shortfall: friends, claims, orders, passes, windfalls, losses | `windfalls`, `losses`, `friendPurchases`, `commuteClaims`, `onlineOrders`, `commutePasses`, `commuteTrips`, `trips` |
| `/shopping` | Temu/Shein/Amazon orders, points, returns, refunds | `onlineOrders`, `storePoints` |
| `/trips` | Journeys: tag spending, per-currency totals, true cost incl. forgone pay | `trips`, `expenses`, `losses` |
| `/payslips` | PDF → text → stored figures, bilingual lines, deduction step detection | `income`, `transfers`, `expenses`, payslip records |
| `/review` | Month review, grade, top categories, budgets | month + prev month of `expenses`/`income`/`transfers`, 7 profit collections |
| `/audit` | Month-end close: bills, totals, sign-off | `monthAudits`, month collections |
| `/reconcile` | Compare app vs bank; fix untagged records; scan for dateless records | `reconciles`, all balance-bearing collections |
| `/notes` | Lists and reminders | `notes` |
| `/settings` | Accounts, budgets, salary, skin, PIN, backup/restore, AI switches | settings doc + full backup of all 23 collections |
| `/login` | Email/password sign-in | Firebase Auth |

---

## 5. Core logic & money

**The single currency rule** — `src/lib/money.js:28-32`:

```js
export const countryOf = (record) =>
  methodCountry(record?.paymentMethod) ||
  methodCountry(record?.paidWith) ||
  record?.country ||
  HOME_COUNTRY
```

The payment method **overrules the stored country**. `METHOD_COUNTRY`
(`src/lib/constants.js:52-57`) fixes Pasmo/nimoca/Edenred → JP and UPI → IN. Cash is
deliberately absent, because notes in a pocket really are either. Consequence: a record
saved with the wrong country still reads correctly everywhere — this was added after a
¥900 lunch on Edenred was stored as ₹900 and vanished from the card.

**Derived once, used everywhere.** `monthTotals` (`src/lib/money.js:111-…`) is the sole
derivation of income/expenses/transfers/saved/savingsRate, consumed by Dashboard,
Review, Charts and Audit. `savingsRate` is `null` (not 0) when income is zero.
Transfers are deliberately **not** country-filtered — `amountSent` is always the yen
figure leaving.

**Balances.** `src/lib/balances.js:36-83` computes an account from `openingBalance` plus
every collection that names it, gated by `countsToward` (a reconcile cutoff read as
midnight). `src/lib/wallet.js` does the same for prepaid cards, restarting from the most
recent `setTo` anchor (`cardAnchor`) and treating the cutoff as **inclusive** — the
comment at `wallet.js:100-108` explains that `parseDateInput` collapses past dates to
noon, so a strictly-greater cutoff silently dropped same-day records.

**Date edge cases are handled and tested.** `dueDay` clamps a day-31 recurring bill to
the last day of a short month (`src/lib/recurringDue.js:11-12`), tested directly against
the real Docomo fixture (`recurringDue.test.js:4-10`). Month windows use date-fns
`startOfMonth`/`endOfMonth` (`src/lib/dateRanges.js:12-20`), and `useToday()` makes
"this month" roll over at midnight in an app that is never closed.

### Fragile spots

- **Bank balances have no currency filter.** `accountBalance` matches purely by label
  (`src/lib/balances.js:52-80`); a yen-tagged expense filed against an Indian account
  subtracts rupees from it. `currencyMismatches` (`src/lib/currencyAudit.js`) detects
  this and surfaces it on the dashboard, but the arithmetic itself is unguarded. This is
  a deliberate, documented trade-off, not an oversight — but it is the sharpest edge in
  the money core.
- **`ignoredBeforeCutoff` must mirror `accountBalance` by hand.** Two lists of
  collections in the same file (`balances.js:105-124`) that must agree; they drifted once
  already (transfers-in and passes were missing).
- **Trip `perDay` divides by trip length, not days with spend** — correct by design
  (`src/lib/trips.js`), but worth knowing before reading the number.
- **Float arithmetic throughout.** Yen amounts are integers in practice; rupee amounts
  carry 2 decimals (`amountInput.js:MAX_DECIMALS`). No cent-integer representation. Tests
  confirm no observable drift at realistic scale, but this is a structural choice.

---

## 6. Theming / HUD

**Model.** `src/lib/skins.js:32-136` defines `SKINS`; each entry optionally carries a
`hud: { core, core2, alt, bg }` token block. `isHud(key)` (`skins.js:145`) is true only
for skins with that block — currently three: JARVIS (`#3fd0ff`, line 86), FRIDAY
(`#ff3b3b`, line 106), EDITH (`#2f8bff`, line 124). `DEFAULT_SKIN = 'classic'`.

**Resolution.** `ThemeContext` (`src/context/ThemeContext.jsx`) holds `theme`
(light/dark) and `skin` independently and exposes `hud: isHud(skin)`. The matrix is
therefore *skin × appearance*, not a single enum. `Layout` renders either `HudMount`
(lazy) or `AuroraBackground` — never both, because "the HUD brings its own grid and
bloom, and running the aurora underneath turns both to mush"
(`src/components/layout/Layout.jsx:61-68`).

**Motion.** `reducedMotion()` (`ThemeContext.jsx:9-11`) gates both the HUD chassis and
the boot animation (`:17`, `:51`), and `src/index.css:71` carries a
`prefers-reduced-motion` block. This is properly done.

**Cost.** The HUD layer is 10 components (`src/components/hud/`) including `ArcReactor`,
`ReactorRings`, `PowerOn`, `HudGreeting`, `HudRouteTransition`. Framer Motion is used by
5 of them and lands in a **117.7 kB lazy chunk** (`use-reduced-motion-*.js`) that is
**not** on the entry path — correctly deferred behind `HudMount`. A flat-skin user never
downloads it.

**Notable call.** `HudGreeting` runs a `setInterval` (`HudGreeting.jsx:31-36`) with
cleanup on both branches — checked, no leak.

---

## 7. AI layer — current state

**Transport.** `src/lib/ai.js` — `ask(prompt, { json, image, model, feature })` POSTs to
`generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with the key
in an `x-goog-api-key` **header** (not a query string, so it stays out of URL logs).
Model: `gemini-flash-latest`. Now sets `generationConfig.temperature = 0` and
`responseMimeType: 'application/json'` when JSON is wanted, and retries 503/429 twice
with backoff — but never retries a 403.

**Feature flags** — 5, not 4 (`src/lib/ai.js:53-67`):

| key | ready | wired? |
|---|---|---|
| `assistant` | false | inert |
| `receipts` | false | inert |
| `insights` | false | inert |
| `entry` | **true** | **wired** — `JarvisSheet.run` → `storyIntake` → `StoryDraft` |
| `payslips` | **true**, `sensitive: true` | **wired** — Payslips page |

`aiEnabled` now defaults **on** for `ready: true` features and hard-refuses anything
`ready: false` regardless of the stored switch.

**Rate guard** — `RPM_LIMIT = 15`, `RPD_LIMIT = 1500` (`ai.js:100-101`) plus a debounce;
counted *before* the request, so a failure loop is also guarded.

**`minimalContext` is inert.** Grep across `src/**/*.jsx` returns nothing — it is
imported by no component. It is a tested, well-designed allow-list that nothing calls.
Meanwhile the *shipped* AI path (`src/lib/storyIntake.js:52-59`, `vocabulary()`) sends a
**different and wider** surface: the user's raw sentence plus **their account labels**.
That is a deliberate design decision (the model needs the names to place "paid from
MUFJ") and it is disclosed in the UI — but it does not pass through `minimalContext`.

### Key posture — verified, not assumed

| Check | Method | Result |
|---|---|---|
| Firebase key in bundle | byte-match `.env` value against every `dist/assets/*.js` | `useCollection-BHEAMnsZ.js` **[live]** — normal for Firebase web |
| Gemini key in bundle | same | **`index-DqFl3y75.js` [live]** — the entry chunk, downloaded before login |
| Gemini key format | length/prefix from `.env` | 53 chars, `AQ.A…` (**not** `AIza…`, which is why a naive `AIza` grep misses it) |
| HTTP-referrer restriction | live POST with **no** `Referer` | **HTTP 200 — ACCEPTED** |
| HTTP-referrer restriction | live POST with `Referer: https://not-your-domain.example/` | **HTTP 200 — ACCEPTED** |
| App Check | grep `src/`, `package.json` | **none** |

`.env.example:9-20` documents the intended protections (referrer restriction, API
restriction, billing disabled). **The referrer restriction is demonstrably not in
effect.** Whether the API restriction and the billing cap are applied is **unknown** —
neither is observable from the code or the bundle.

---

## 8. Tests

**Real, just run:** `npx vitest run` → **1,081 passed / 1,081, 64 files, 0 failed**,
11.59s. 9,861 lines of test code against 33,998 lines of source.

**What is genuinely pinned — this part is strong:**

- **Currency separation** as a property, not examples: `money.test.js` asserts every
  record lands in exactly one currency and that a card overrules a stored country.
- **Invariant suites**: `mathAudit.test.js`, `ledgerAudit.test.js`, `tallyAudit.test.js`,
  `currencyAudit.test.js` — conservation laws (moving your own money changes total
  holdings by exactly zero), sheet-total-equals-balance, cutoff behaviour.
- **A real model reply pinned verbatim** — `storyIntakeReal.test.js` holds an actual
  `gemini-flash-latest` response to a real sentence, misspellings and all, so the
  validator is tested against the messy shape rather than a tidy fixture.
- **The routing bug that shipped** — `JarvisRouting.dom.test.jsx` asserts the local
  parser really does return `amount: 12` for a trip description, and that the router
  refuses it.
- **Reachability** — `navigation.test.js` reads routes out of `App.jsx` and fails if one
  has no navigation entry.
- **Date edges** — day-31 recurring in February, inclusive cutoffs, month rollover.

### Critical gaps

- **`src/lib/firestore.js` has ZERO coverage.** No test file imports it. This includes
  **`commitOps`** — the all-or-nothing primitive every linked pair depends on — plus
  `withDate`, the 500-op refusal, `addRecords` chunking, and `findDatelessRecords`. The
  single most consequential untested module in the repo.
- **12 lib modules have no test file**: `appLock` (PIN hashing/lockout), `balances`
  (covered *indirectly* by 4 audit suites — acceptable), `celebrate`, `constants`,
  `exchangeRate`, `firebase`, `firestore`, `friendLedger`, `imageCompress`,
  `payslipTerms`, `pdfText`, `reportImage`.
- **Component layer: 5 test files** (`EmptyState`, `StoryDraft`, `JarvisRouting`,
  `AiSettings`, `navigation`) against roughly 90 components. Every recent production
  defect was in this layer. No page component is rendered by any test.
- **No test drives a full user flow** — nothing renders `EntryFlow`, `Groups` or
  `Commute` and exercises save → linked write → balance change.
- **`ask()` transport is tested with a stubbed `fetch`**; no test exercises the real
  network path (correct for CI, but it means the referrer/key posture was never
  test-visible — it took a manual probe to find H-1).

---

## 9. Security & privacy

**Firestore rules** (`firestore.rules`) — assessed as **correct**:

```
match /users/{uid}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
match /{document=**} { allow read, write: if false; }
```

Owner-only, with an explicit deny-all fallback. No field validation or shape
enforcement, so a compromised *client session* can write any shape into its own
namespace — acceptable for a single-user app, and no cross-tenant path exists. Verified
deployed: `firebase deploy --only firestore:rules` reported *"already up to date"*.

**Auth** — Firebase email/password (`src/context/AuthContext.jsx`). `logout()` calls
`closeAllLiveData()` **before** `signOut` so warm listeners (which now outlive their
consumers by 60s) cannot keep reading with revoked permissions.

**PIN gate** — `src/lib/appLock.js`. SHA-256 of the PIN, **unsalted, no KDF**, stored in
`localStorage`; unlock state in `sessionStorage`; 5 attempts then a 30s lockout
(`MAX_ATTEMPTS`, `LOCKOUT_MS`, lines 6-7). A 4-digit unsalted SHA-256 is exhaustible in
microseconds, and clearing `localStorage` removes the gate entirely. It is a
convenience screen-lock over an already-authenticated session, not a security boundary —
which is a defensible design, but should be understood as such.

**Data-leak surface — what can leave the device:**

1. **Payslip images** (`payslips`, `sensitive: true`, on by default) — the *whole image*,
   including employer name and employee number, is sent to Google. The flag is honestly
   labelled (`ai.js:60-65`).
2. **Story text + account labels** (`entry`, on by default) — the raw sentence typed, plus
   `accounts[].label`, `CATEGORIES`, trip names and loss-kind keys
   (`storyIntake.js:52-59`). Free-text notes of *existing* records are not sent; the new
   sentence obviously is.
3. **`minimalContext`** — the strict allow-list — is **not on either path**.
4. **The Gemini key itself**, to anyone who reads the bundle (§7, H-1).

No analytics, no third-party scripts, no error reporting service found.

---

## 10. Performance & quality

**Bundle** (live chunks referenced by `dist/index.html`):

| Chunk | Size | On entry path? |
|---|---|---|
| `firebase-BEQwwDE6.js` | **626.9 kB** | **yes** |
| `index-DqFl3y75.js` | 231.3 kB | yes |
| `react-vendor-Dro7sGu-.js` | 227.1 kB | yes |
| `index-CV9VMNdj.css` | 117.4 kB | yes |
| `Charts-DyLmN4Z1.js` | 407.8 kB | no (lazy) |
| `use-reduced-motion-*.js` (framer-motion) | 117.7 kB | no (lazy, HUD only) |

Entry path ≈ **1.2 MB raw**. The Firebase SDK dominates and *is* genuinely needed at
first paint, because `Dashboard` is eager and pulls `useCollection`. `dist/assets` holds
50 JS files totalling ~2.39 MB, but many are **stale artefacts from earlier builds** —
only 12 are referenced by the current `index.html`. Firebase Hosting serves them
harmlessly; the PWA precache glob may include them.

**Data-fetch design is good.** One listener per collection (`keyFor` ignores date
ranges), sliced locally — `expenses` went from 23 subscriptions to 1. Listeners survive
navigation for 60s. Changing month is a memo, not a query.

**Render risks:**

- `Dashboard` holds 16 `useCollection` calls; `History` 12; `Charts` 14. The registry
  dedupes the *listeners*, but each is still a subscribing component.
- **Only one list is capped**: `SourceHistorySheet.jsx:89` slices to 150. `History`,
  `Groups`, `Commute` and `Profit` render every row with no virtualisation. With years
  of data this is the most likely future performance cliff. **Not currently a problem at
  observed data volumes** (unknown exact counts).
- `LedgerRow` is `memo()`d with stable callbacks; most other list rows are not.

**Quality:**

- **0 TODO/FIXME/HACK markers** in `src/` — genuinely clean.
- **10 `eslint-disable`** comments, all `react-hooks/exhaustive-deps` on deliberately
  narrowed dependency arrays, each with a comment.
- `no-undef` is enabled (`.oxlintrc.json`) with browser + Node envs and the injected
  build constants declared. `npm run verify` (lint && test && build) gates
  `npm run deploy`.
- **Dead code**: `minimalContext` (inert, §7); three `ready: false` AI features whose
  UI does not exist; `CATEGORY_ICONS.Coffee` retained **deliberately** so historical
  records still render (`constants.js:32-33`) — correct, not debt.
- **Accessibility**: 92 `aria-label`s against 323 `<button>` elements. Icon-only buttons
  are generally labelled; text buttons rely on their content (fine). No skip-link, no
  focus-trap audit performed, and **no automated a11y test** — state is **unknown**
  beyond the label ratio.
- **Responsiveness**: mobile-first with `lg:` desktop breakpoints throughout; safe-area
  insets used for the installed PWA. The desktop sidebar previously exposed only 9 of 19
  routes — now fixed and guarded by a test.

---

## 11. AI-readiness

**Clean hook points that already exist:**

| Planned feature | Hook point | Data it would consume |
|---|---|---|
| **Conversational entry** | *already built* — `JarvisSheet.run` → `buildPrompt` → `validateDraft` → `StoryDraft` | vocabulary (accounts, categories, trips, loss kinds) + the sentence |
| **Receipts** | `ask(prompt, { image })` + `dataUrlToInline` (`ai.js`) already exist; `imageCompress.js` exists | a photo → the same `validateRecord` path as entry |
| **Insights** | `monthTotals` + `buildInsights` (`src/lib/insights.js`) + `src/lib/planning.js` | `minimalContext(scope)` — figures only |
| **Predictions** | `src/lib/planning.js:computeSafeToSpend`, `recurringDue`, `payslipAnalysis` | month totals, upcoming recurring, signals |
| **Assistant answers** | `askJarvis` (`src/lib/jarvis.js`) already answers locally; the model would be the fallback | `minimalContext` + the question |

The architectural win is that **all five would reuse one validation gate**:
`validateRecord`/`validateDraft` (`src/lib/storyIntake.js`) already derives currency from
the payment method, rejects unknown categories and methods, and converts gaps into
questions. Any new AI writer should be routed through it rather than writing directly.

**The privacy strip-list `minimalContext()` must keep enforcing.** It is built by
**allow-list** (`ai.js:174-220`) — a new field elsewhere in the app cannot start
travelling by accident. Permitted: `currency, month, income, expenses, transfers,
netSavings, savingsRate, daysToSalary, safePerDay, daysLeft, projectedSpend`;
`byCategory` (keys truncated to 24 chars, zeroes dropped); `signals[]` reduced to
`{kind, category, amount, day}`.

Everything else must continue to be stripped — pinned by `ai.test.js:173-186`:

- free-text `note` on any record
- `friend` names, `groupName`, group member names
- hand-typed `store` names
- `pin` / PIN hash, `accountNumber`
- **account labels** (`MUFJ`, `ICICI NRO`) — *note: currently sent by the separate
  `storyIntake` path, which does not use `minimalContext`*
- payslip employer name and employee number (sent wholesale by the `payslips` feature)
- raw records of any kind, individual transaction dates, `recipient` on transfers
- `fromPlace`/`toPlace` route names, `carrier`, trip `note`

---

## 12. Findings — prioritized

| Sev | Finding | Evidence | Suggested direction |
|---|---|---|---|
| **High** | **Gemini API key ships publicly and is unrestricted.** It is in the live entry chunk, and the API accepted it with no referrer *and* with a forged referrer. Anyone who views source can spend the project's quota. | Byte-match of `.env` value → `dist/assets/index-DqFl3y75.js` [live]; live probes returned **200/ACCEPTED** for both `no referer` and `Referer: not-your-domain.example`; `.env.example:9-20` documents restrictions that are not in effect | Apply the HTTP-referrer + API restrictions in the Google Cloud console as `.env.example` describes, then re-run the two probes to confirm they now 403. Confirm billing is disabled. Longer term, a tiny proxy is the only way to actually hide a key — but restriction + no billing is a reasonable posture for this app. |
| **High** | **`commitOps` — the atomicity primitive — has no tests.** Every linked pair (group mirror, commute mirror, windfall→income, move-money halves) depends on it, as does the 500-op refusal and `withDate`. | No test file imports `src/lib/firestore.js`; primitive at `firestore.js:81-102` | Test it against a fake `writeBatch`: id generation, `data(ids)` resolution order, the >500 refusal, `withDate` stamping, and that one failing op commits nothing. |
| **High** | **Trip deletion is not atomic** — untag-then-delete in two commits can orphan `tripId` on expenses. | `src/pages/Trips.jsx:446-447` | Build one op list (untags + the trip delete) and commit it; chunk only if >500, accepting that a chunked delete needs a different story. |
| **High** | **Group-expense edit is not atomic** — expense and its group mirror update in two separate awaits. | `src/components/entry/EntryFlow.jsx:589-599` | Move both into a single `batchOps` call, as the *create* path already does (`:626-630`). |
| **Med** | **Bank balances have no currency filter**; a mis-tagged record subtracts the wrong currency. Detected and surfaced, but not prevented in the arithmetic. | `src/lib/balances.js:52-80`; detector `src/lib/currencyAudit.js` | Either filter by `countryOf` in `accountBalance` (changes historical numbers — needs a decision) or keep detection and document the choice in the module header. |
| **Med** | **`accountBalance` and `ignoredBeforeCutoff` duplicate the collection list by hand** and have already drifted once. | `src/lib/balances.js:52-80` vs `:105-124` | Drive both from one table of `{collection, field, sign, amount}` so they cannot disagree. |
| **Med** | **No page component is rendered by any test**; the component layer holds 5 test files against ~90 components, and is where every recent production defect occurred. | `find src/components src/pages -name '*.test.*'` → 5 files | Add a render smoke test per route behind mocked providers — the single highest-value test to add next. |
| **Med** | **`minimalContext` is inert while a wider surface ships.** The strict allow-list is unused; the live AI path sends raw text plus account labels. | Grep: no `.jsx` imports `minimalContext`; `storyIntake.js:52-59` | Decide deliberately: either route the assistant's context through it, or delete it so nobody assumes protection that isn't applied. |
| **Med** | **PIN is unsalted SHA-256 in `localStorage`** with no KDF; clearing storage removes the gate. | `src/lib/appLock.js:9-35` | Fine as a convenience lock — but label it as such in Settings, or move to a salted PBKDF2/scrypt derivation if it is meant to resist a borrowed phone. |
| **Med** | **No App Check.** Firebase credentials in the bundle are usable by any client; only the rules constrain them. | Grep `src/`, `package.json` → none | Enable App Check with reCAPTCHA v3 on Firestore. Meaningful defence-in-depth given the rules are the only control. |
| **Low** | **No list virtualisation** outside one 150-row cap; `History`/`Groups`/`Commute`/`Profit` render everything. | `SourceHistorySheet.jsx:89` is the only cap | Not urgent at current volumes. Revisit when any collection passes a few thousand rows. |
| **Low** | **Firebase SDK (627 kB) is on the entry path** and unavoidable while `Dashboard` is eager. | `dist/assets/firebase-BEQwwDE6.js`, `App.jsx:12` | Leave it. Splitting only helps the login screen, seen once per device; the PWA precache makes it a one-time cost. |
| **Low** | **Stale build artefacts in `dist/assets`** — 50 files, only 12 referenced. | Directory listing vs `dist/index.html` | Clean `dist` before build, so the precache manifest can't pick up orphans. |
| **Low** | **Three `ready: false` AI features** advertise capability that does not exist. | `ai.js:53-58` | Harmless (the gate refuses them), but they should be deleted or built rather than left as intent. |
| **Low** | **Accessibility is unmeasured.** 92 labels / 323 buttons, no automated a11y check, no skip-link. | Grep counts | Add `vitest-axe` to the new jsdom setup and assert on a few key screens. |

---

## 13. Open questions for the human

1. **Is billing disabled on the Google Cloud project, and is the API restriction (Generative Language only) actually applied?** Neither is observable from the code. Combined with the unrestricted key (H-1), the billing cap is currently the only backstop I cannot verify.
2. **Should `accountBalance` filter by currency?** Doing so would change historical account numbers for any existing mis-tagged record. That is a data decision, not a code one.
3. **How many documents are in the largest collections today?** All 23 now load in full each session. I can see the design but not the volume, so I can't say how close the no-virtualisation lists are to a problem.
4. **Is the PIN meant to resist someone holding the unlocked phone**, or is it a privacy screen? That determines whether the unsalted hash matters.
5. **`minimalContext` — keep or delete?** It is well-built and unused. Keeping it implies a plan to route the assistant through it; deleting it removes a false sense of protection.
6. **Are the three `ready: false` AI features still planned?** If not, they are dead weight in a user-facing settings list.
7. **Payslip images go to Google in full, including employer and employee number.** The flag says so plainly — I want to confirm that is an accepted trade rather than something never noticed.
8. **Is `hardening/currency-data-and-perf` intended to merge to `main`?** `main` is 15 commits behind and the deployed app matches the branch, not `main`.
