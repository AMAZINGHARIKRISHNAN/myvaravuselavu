import { useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import Keypad from './Keypad'
import CategoryGrid from './CategoryGrid'
import PaymentMethodGrid from './PaymentMethodGrid'
import BottomSheet from '../ui/BottomSheet'
import { useSettings } from '../../hooks/useSettings'
import { useCollection } from '../../hooks/useCollection'
import { useCollectionWriters } from '../../hooks/useCollectionWriters'
import { useBatchOps } from '../../hooks/useBatchOps'
import { useToast } from '../../context/ToastContext'
import { formatByCountry, formatJPY, toDate, toDateInputValue, parseDateInput } from '../../lib/format'
import { celebrate } from '../../lib/celebrate'
import { PREPAID_CARDS } from '../../lib/wallet'
import { recordAmount, topAmounts } from '../../lib/quickAmounts'
import { normalizeStore, recordStore, topStores } from '../../lib/stores'
import { isRouteCategory, normalizePlace, recentPlaces, recordPlaces, swapRoute } from '../../lib/route'
import { fundingSources, countryOf } from '../../lib/money'
import { CATEGORIES, CATEGORY_ICONS, methodCountry } from '../../lib/constants'
import { activeTrip } from '../../lib/trips'
import { groupOwner } from '../../lib/sharedGroups'

const STEPS = ['amount', 'category', 'payment', 'confirm']
const STEP_LABELS = { amount: 'Amount', category: 'Category', payment: 'Payment', confirm: 'Confirm' }
const LAST_PAYMENT_KEY = 'vs_last_payment'

// One-tap reasons for a hand-logged credit/debit, so "why" is rarely typed.
const MOVE_REASONS = {
  credit: ['Interest', 'Refund', 'Cashback', 'Gift received', 'Cash deposited', 'Correction'],
  debit: ['Bank fee', 'ATM fee', 'Auto-debit', 'Bill paid', 'EMI', 'Correction'],
}

function loadLastPayment() {
  try {
    return JSON.parse(localStorage.getItem(LAST_PAYMENT_KEY) || 'null')
  } catch {
    return null
  }
}

export default function EntryFlow({ initial, initialDate, onMoveMoney, onClose, onSaved }) {
  const { settings } = useSettings()
  const { add, update } = useCollectionWriters('expenses')
  // Card top-ups are NOT expenses — they move money bank → prepaid card. The
  // spending happens later, when the card pays for something.
  const { add: addRecharge } = useCollectionWriters('pasmoRecharges')
  // Plain money in/out of an account — interest, a bank fee, a UPI credit.
  // Not spending, not salary: it only moves that account's balance.
  const { add: addAccountEntry } = useCollectionWriters('accountEntries')
  // Cash pulled out of a bank account: the account drops, the notes in your
  // pocket rise. Same record the Cash page writes.
  const { add: addWithdrawal } = useCollectionWriters('withdrawals')
  // Shared-group link: an expense can also be dropped into a group ledger,
  // where it splits equally between the members (Groups tab).
  const { data: groups } = useCollection('groups')
  const { update: updateGroupEntry } = useCollectionWriters('groupExpenses')
  const batchOps = useBatchOps()
  const { toast } = useToast()

  // The trip currently running, so a new expense can tag itself to it.
  const trips = useCollection('trips')
  const onTrip = activeTrip(trips.data)

  // For new entries, preselect the last-used payment method so step 3 is a confirm-tap.
  const lastPayment = initial?.id ? null : loadLastPayment()

  const [stepIndex, setStepIndex] = useState(initial ? STEPS.length - 1 : 0)
  const [amount, setAmount] = useState(initial?.amount ? String(initial.amount) : '0')
  const [category, setCategory] = useState(initial?.category || null)
  const [paymentMethod, setPaymentMethod] = useState(
    initial?.paymentMethod || lastPayment?.paymentMethod || null
  )
  // A remembered method that can only hold one currency decides the country
  // itself. Remembering the pair as-saved is what let a stale 'IN' ride along
  // with a yen-only card: the method was preselected, the country came from the
  // same memory, and a confirm-tap never corrected it.
  const [country, setCountry] = useState(
    // countryOf first, so EDITING a record shows the currency it is actually
    // read as — an Edenred expense stored as 'IN' opens as the yen it is,
    // and saving puts the right value back rather than writing the old one out
    // again.
    (initial && countryOf(initial)) ||
      (lastPayment?.paymentMethod && methodCountry(lastPayment.paymentMethod)) ||
      lastPayment?.country ||
      null
  )
  const [note, setNote] = useState(initial?.note || '')
  // Where the money was spent. Free text (shops change, no fixed list), but
  // backed by chips + a datalist of your own past shops so it stays one tap
  // for regulars and spellings stay consistent enough to rank later.
  const [store, setStore] = useState(initial?.store || '')
  const [storeSuggestions] = useState(() => topStores())
  // A journey's two ends. Only surfaced for Transport, but held here for every
  // category so switching category back and forth never loses what was typed.
  const [fromPlace, setFromPlace] = useState(initial?.fromPlace || '')
  const [toPlace, setToPlace] = useState(initial?.toPlace || '')
  const [placeSuggestions] = useState(() => recentPlaces())
  // A fresh entry can be pre-dated (e.g. logging trip expenses days later) via
  // initialDate, while still walking the full amount → category → pay flow.
  const [dateStr, setDateStr] = useState(
    initial?.date
      ? toDateInputValue(toDate(initial.date))
      : initialDate
        ? toDateInputValue(toDate(initialDate))
        : toDateInputValue(new Date())
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Top-up mode: chosen instead of a category on step 2. The entry stops being
  // an expense and becomes a card load — the "payment method" step turns into
  // "paid from", and that account is what loses the money.
  const [topUpCard, setTopUpCard] = useState(null)
  const isTopUp = !!topUpCard
  const topUpMeta = PREPAID_CARDS.find((c) => c.name === topUpCard)
  // Company cards (Edenred) are loaded by the employer — nothing of the user's
  // own money moves, so there's no source account to pick.
  const isCompanyCard = !!topUpMeta?.company
  // Only cards you fund yourself can be topped up from this flow.
  const selfFundedCards = PREPAID_CARDS.filter((c) => !c.company)

  // Money-move mode: 'credit' (money came into an account) or 'debit' (money
  // left it) for anything that isn't spending or salary — bank interest, a
  // fee, a UPI credit. Chosen instead of a category, like a top-up: step 3
  // becomes "which account", step 4 asks why.
  const [moveDirection, setMoveDirection] = useState(null)
  const isMove = !!moveDirection
  const isCredit = moveDirection === 'credit'

  // Two more ways this sheet is used:
  //   'withdraw' — cash taken out of a bank account (bank down, pocket up)
  //   'split'    — one lump sum (a day's ¥10,000, say) broken into the things
  //                it actually went on, each logged as its own expense
  //   'bonus'    — a work bonus: real income AND pure profit, so it books both
  const [special, setSpecial] = useState(null)
  const isWithdraw = special === 'withdraw'
  const isSplit = special === 'split'
  const isBonus = special === 'bonus'
  const isExpense = !isTopUp && !isMove && !isWithdraw && !isSplit && !isBonus
  const [splitRows, setSplitRows] = useState([{ what: '', category: 'Food', amount: '' }])

  // Who is this purchase for? Four choices:
  //   'mine'   — fully my own spend (default, no ledger entry)
  //   'split'  — shared between me and one or more friends
  //   'friend' — the whole amount is on one or more friends' behalf
  //   'group'  — shared household buy: also logged in a Groups-tab ledger,
  //              where it splits equally between the group's members
  // All but 'mine' create linked records alongside the expense. Only offered
  // for new expenses so edits can't duplicate ledger rows.
  const [whoFor, setWhoFor] = useState('mine')
  const forFriend = whoFor === 'split' || whoFor === 'friend'
  const [groupId, setGroupId] = useState(null)
  const selectedGroup = groups.find((g) => g.id === (groupId ?? groups[0]?.id))

  // How the amount is divided among the friends:
  //   'equal'   — same slice for everyone (me included when splitting)
  //   'percent' — each friend takes a % of the total
  //   'custom'  — type exactly what each person's part is (what they got),
  //               plus an optional different "pays you" amount for markup
  const [splitMode, setSplitMode] = useState('equal')
  // One row per friend. pct is used in percent mode; part/pays in custom mode.
  const [friends, setFriends] = useState([{ name: '', pct: '', part: '', pays: '' }])

  const amountNum = parseFloat(amount) || 0

  // Split math: what each line costs, what's still unaccounted for. Money left
  // over isn't lost — it's simply still in your pocket, so it stays unlogged.
  const splitCalcs = splitRows.map((r) => ({ ...r, value: parseFloat(r.amount) || 0 }))
  const splitTotal = splitCalcs.reduce((s, r) => s + r.value, 0)
  const splitLeft = Math.round((amountNum - splitTotal) * 100) / 100
  const setSplitField = (i, field, value) =>
    setSplitRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))

  // Per-friend money math for the chosen mode. Returns share (their slice of
  // the actual cost) and due (what they give back — same as share unless a
  // custom "pays" was typed).
  const friendCalcs = friends.map((f) => {
    let share = 0
    if (splitMode === 'equal') {
      // Equal parts: when splitting, I count as one head too.
      const heads = friends.length + (whoFor === 'split' ? 1 : 0)
      share = heads > 0 ? amountNum / heads : 0
    } else if (splitMode === 'percent') {
      share = ((parseFloat(f.pct) || 0) / 100) * amountNum
    } else {
      share = parseFloat(f.part) || 0
    }
    share = Math.round(share * 100) / 100 // keep cents sane
    const due = splitMode === 'custom' && f.pays !== '' ? parseFloat(f.pays) || 0 : share
    return { ...f, share, due }
  })

  // In equal mode rounding can leave a stray cent — push it onto the last
  // friend so the shares always add up to the exact total.
  if (splitMode === 'equal' && whoFor === 'friend' && friendCalcs.length > 0) {
    const sumOthers = friendCalcs.slice(0, -1).reduce((s, f) => s + f.share, 0)
    const last = friendCalcs[friendCalcs.length - 1]
    last.share = Math.round((amountNum - sumOthers) * 100) / 100
    if (splitMode === 'equal') last.due = last.share
  }

  const sharesTotal = friendCalcs.reduce((s, f) => s + f.share, 0)
  const duesTotal = friendCalcs.reduce((s, f) => s + f.due, 0)
  const myPart = Math.round((amountNum - sharesTotal) * 100) / 100 // what's left is mine

  // Row helpers for the friend list UI
  const setFriendField = (i, field, value) =>
    setFriends((rows) => rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  const addFriendRow = () => setFriends((rows) => [...rows, { name: '', pct: '', part: '', pays: '' }])
  const removeFriendRow = (i) => setFriends((rows) => rows.filter((_, idx) => idx !== i))

  const step = STEPS[stepIndex]
  const accounts = settings?.accounts || []

  const goNext = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
  const goBack = () => {
    if (stepIndex === 0) {
      onClose()
    } else if (isTopUp && isCompanyCard && STEPS[stepIndex] === 'confirm') {
      // Company cards skip "paid from" on the way in — skip it going back too.
      setStepIndex(STEPS.indexOf('category'))
    } else {
      setStepIndex((i) => i - 1)
    }
  }

  const handleSelectPayment = (opt) => {
    setPaymentMethod(opt.label)
    if (opt.country) {
      setCountry(opt.country)
      goNext()
    } else if (country) {
      // country already chosen for this non-account method — advance
      goNext()
    }
  }

  // Credited / Debited on step 2: the entry stops being an expense and becomes
  // a plain balance move on whichever account is picked next.
  // Cash withdrawal or a split of this amount — both replace the category.
  const handleSelectSpecial = (kind) => {
    if (navigator.vibrate) navigator.vibrate(8)
    setSpecial(kind)
    setTopUpCard(null)
    setMoveDirection(null)
    setCategory(null)
    setError('')
    if (kind === 'withdraw') {
      // Only a real bank account can be withdrawn from.
      if (!accounts.some((a) => a.label === paymentMethod)) setPaymentMethod(null)
    }
    if (kind === 'bonus') {
      // A bonus is paid INTO somewhere — a spending method carried over from a
      // previous entry (Pasmo, UPI) would be nonsense here.
      const targets = ['Cash', ...accounts.map((a) => a.label)]
      if (!targets.includes(paymentMethod)) setPaymentMethod(null)
      setNote('')
    }
    goNext()
  }

  const handleSelectMove = (direction) => {
    if (navigator.vibrate) navigator.vibrate(8)
    setMoveDirection(direction)
    setSpecial(null)
    setTopUpCard(null)
    setCategory(null)
    setPaymentMethod(null)
    setCountry(null)
    setNote('')
    setError('')
    goNext()
  }

  // Picking a card on step 2 switches the whole entry into top-up mode.
  const handleSelectTopUp = (card) => {
    if (navigator.vibrate) navigator.vibrate(8)
    setTopUpCard(card.name)
    setMoveDirection(null)
    setSpecial(null)
    setCategory(null)
    setCountry('JP') // prepaid cards are yen-only
    setError('')
    if (card.company) {
      setPaymentMethod(null) // company money — nothing of yours is deducted
      setStepIndex(STEPS.indexOf('confirm'))
    } else {
      // A prefilled expense method (Pasmo, UPI…) isn't a valid funding source —
      // only cash or a real YEN account can pay for a top-up. An Indian account
      // here took rupees off it while the card gained yen.
      const sources = fundingSources(accounts, 'JP')
      if (!sources.includes(paymentMethod)) setPaymentMethod(null)
      goNext()
    }
  }

  const handleSelectCategory = (c) => {
    setTopUpCard(null) // a category means it's a normal expense again
    setMoveDirection(null)
    setSpecial(null)
    setCategory(c)
    goNext()
  }

  const handleSaveWithdraw = async () => {
    if (amountNum <= 0) {
      setError('Enter how much you took out.')
      return
    }
    if (!paymentMethod) {
      setError('Pick the account it came out of.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await addWithdrawal({
        account: paymentMethod,
        amount: amountNum,
        country: country || 'JP',
        date: parseDateInput(dateStr),
        note: note.trim(),
      })
      celebrate()
      recordAmount(amountNum, country || 'JP')
      toast(`🏧 ${formatByCountry(amountNum, country || 'JP')} withdrawn from ${paymentMethod} → cash`)
      onSaved?.()
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  // A bonus is two true things at once: money that landed (income, so the
  // balance moves) and pure gain (profit, because none of it replaces a cost).
  // Both records are written in one commit and linked, so the Profit page and
  // your balances can never disagree about it — and deleting one from the
  // Profit page takes the income with it.
  const handleSaveBonus = async () => {
    if (amountNum <= 0) {
      setError('Enter how much the bonus was.')
      return
    }
    if (!paymentMethod) {
      setError('Pick where it landed.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const label = note.trim() || 'Bonus'
      const date = parseDateInput(dateStr)
      await batchOps([
        {
          op: 'set',
          name: 'income',
          data: {
            amount: amountNum,
            source: 'Work bonus',
            gross: null,
            net: null,
            note: `🎉 ${label}`,
            account: paymentMethod,
            country: country || 'JP',
            date,
          },
        },
        {
          op: 'set',
          name: 'windfalls',
          data: (ids) => ({
            label,
            kind: 'bonus',
            received: amountNum,
            cost: 0, // none of it was ever your money
            date,
            account: paymentMethod,
            status: 'received',
            note: '',
            incomeId: ids[0],
          }),
        },
      ])
      celebrate()
      // Deliberately no recordAmount(): the keypad chips learn amounts you
      // repeat, and a bonus is a once-or-twice-a-year figure.
      toast(`🎉 ${formatByCountry(amountNum, country || 'JP')} bonus into ${paymentMethod} · counted as profit`)
      onSaved?.()
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  // One lump sum → one expense per line, written in a single commit so a
  // dropped connection can't log half your day.
  const handleSaveSplit = async () => {
    const rows = splitCalcs.filter((r) => r.value > 0)
    if (rows.length === 0) {
      setError('Add at least one thing you spent it on.')
      return
    }
    if (!paymentMethod) {
      setError('Pick how you paid.')
      return
    }
    if (splitLeft < -0.01) {
      setError(
        `The lines add up to ${formatByCountry(splitTotal, country || 'JP')} — more than the ${formatByCountry(amountNum, country || 'JP')} you started with.`
      )
      return
    }
    setSaving(true)
    setError('')
    try {
      const date = parseDateInput(dateStr)
      await batchOps(
        rows.map((r) => ({
          op: 'set',
          name: 'expenses',
          data: {
            amount: r.value,
            category: r.category || 'Other',
            country: country || 'JP',
            paymentMethod,
            store: normalizeStore(r.what),
            note: r.what.trim(),
            date,
          },
        }))
      )
      celebrate()
      recordAmount(splitTotal, country || 'JP')
      localStorage.setItem(
        LAST_PAYMENT_KEY,
        JSON.stringify({ paymentMethod, country: country || 'JP' })
      )
      toast(
        `✓ ${formatByCountry(splitTotal, country || 'JP')} logged as ${rows.length} spend${
          rows.length === 1 ? '' : 's'
        }${splitLeft > 0.01 ? ` · ${formatByCountry(splitLeft, country || 'JP')} still in hand` : ''}`
      )
      onSaved?.()
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  const handleSaveMove = async () => {
    if (amountNum <= 0) {
      setError('Enter the amount.')
      return
    }
    if (!paymentMethod) {
      setError('Pick the account it moved through.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await addAccountEntry({
        direction: moveDirection,
        account: paymentMethod,
        amount: amountNum,
        country: country || 'JP',
        reason: note.trim(),
        date: parseDateInput(dateStr),
      })
      celebrate()
      recordAmount(amountNum, country || 'JP')
      toast(
        `${isCredit ? '➕' : '➖'} ${formatByCountry(amountNum, country || 'JP')} ${
          isCredit ? 'credited to' : 'debited from'
        } ${paymentMethod}${note.trim() ? ` · ${note.trim()}` : ''}`
      )
      onSaved?.()
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  const handleSaveTopUp = async () => {
    if (amountNum <= 0) {
      setError('Enter the top-up amount.')
      return
    }
    setSaving(true)
    setError('')
    try {
      // paidFrom is what makes the money leave. An account balance drops;
      // 'Cash' drops the counted cash on hand. Company cards spend none of
      // your money, so nothing is deducted at all.
      const paidFrom = isCompanyCard || !paymentMethod ? null : paymentMethod
      await addRecharge({
        card: topUpCard,
        amount: amountNum,
        setTo: null, // this is a load, not a reconcile point
        paidFrom,
        date: parseDateInput(dateStr),
        note: note.trim(),
      })
      celebrate()
      recordAmount(amountNum, country || 'JP')
      toast(
        `${topUpMeta?.emoji || '💳'} ${formatJPY(amountNum)} loaded onto ${topUpCard}${
          paidFrom ? ` · out of ${paidFrom}` : ''
        }`
      )
      onSaved?.()
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  const handleSave = async () => {
    if (isTopUp) return handleSaveTopUp()
    if (isMove) return handleSaveMove()
    if (isWithdraw) return handleSaveWithdraw()
    if (isSplit) return handleSaveSplit()
    if (isBonus) return handleSaveBonus()
    // Friend/split entries need every row named and the math to add up.
    if (forFriend && !initial?.id) {
      if (friendCalcs.some((f) => !f.name.trim())) {
        setError('Every friend row needs a name (or remove the empty row).')
        return
      }
      if (friendCalcs.some((f) => f.share <= 0)) {
        setError(
          splitMode === 'percent'
            ? 'Every friend needs a percentage above 0.'
            : splitMode === 'custom'
              ? 'Every friend needs their part above 0.'
              : 'Shares came out to 0 — check the amount.'
        )
        return
      }
      // Shares can't take more than the whole bill.
      if (sharesTotal > amountNum + 0.01) {
        setError(
          `Friend parts add up to ${formatByCountry(sharesTotal, country || 'JP')} — more than the total.`
        )
        return
      }
      // "Fully for friends" means nothing is left as mine.
      if (whoFor === 'friend' && Math.abs(myPart) > 0.01) {
        setError(
          splitMode === 'percent'
            ? 'Percentages must add up to 100% when it’s fully for friends.'
            : `Friend parts must add up to the full ${formatByCountry(amountNum, country || 'JP')} when it’s fully for friends.`
        )
        return
      }
    }
    setSaving(true)
    setError('')
    try {
      const isJourney = isRouteCategory(category)
      const payload = {
        amount: parseFloat(amount),
        category,
        country: country || 'JP',
        paymentMethod,
        store: normalizeStore(store),
        // Optional, additive, and only meaningful for a journey. Written as ''
        // rather than omitted so editing a record can clear them.
        fromPlace: isJourney ? normalizePlace(fromPlace) : '',
        toPlace: isJourney ? normalizePlace(toPlace) : '',
        note,
        date: parseDateInput(dateStr),
        // On a trip, almost everything you spend IS trip spending. Asking every
        // time would be noise, and relying on you to remember would make the
        // total wrong in the direction that matters — a forgotten tag silently
        // under-reports what the journey cost. So a running trip claims it, and
        // it can be untagged on the Trips page if it does not belong.
        //
        // Editing keeps whatever the record already says: a correction to an
        // old expense must not sweep it into today's holiday.
        ...(initial?.id ? {} : onTrip ? { tripId: onTrip.id } : {}),
      }
      if (initial?.id) {
        await update(initial.id, payload)
        // Expense already linked to a group entry → keep the ledger copy in
        // step so the group's split math follows this edit.
        if (initial.groupEntryId) {
          await updateGroupEntry(initial.groupEntryId, {
            amount: payload.amount,
            item: note.trim() || payload.store || category || 'Expense',
            store: payload.store,
            date: payload.date,
          })
        }
      } else {
        if (forFriend) payload.friend = friendCalcs.map((f) => f.name.trim()).join(', ')
        // One Friend-ledger row per friend, so each person's debt and
        // profit/loss is tracked separately in the Friends tab.
        // cost = their slice of this expense; paid = same (that money already
        // left your pocket as this expense).
        const friendRow = (f, expenseId) => ({
          item: note.trim() || payload.store || category || 'Expense',
          store: payload.store,
          friend: f.name.trim(),
          country: payload.country,
          cost: f.share,
          paid: f.share, // already paid — it went out as this expense
          due: f.due, // what they promised to give back
          received: 0, // nothing collected yet
          date: payload.date,
          note: payload.store
            ? `From expense · ${category} · ${payload.store}`
            : `From expense · ${category}`,
          expenseId, // link back to the expense record
        })
        if (whoFor === 'group' && selectedGroup) {
          // Mirror into the group ledger: you fronted the full amount, the
          // group splits it equally. ONE atomic commit creates both sides
          // pre-linked — a dropped connection can't leave a half-pair.
          await batchOps([
            { op: 'set', name: 'expenses', data: (ids) => ({ ...payload, groupEntryId: ids[1] }) },
            {
              op: 'set',
              name: 'groupExpenses',
              data: (ids) => ({
                groupId: selectedGroup.id,
                type: 'expense',
                item: note.trim() || payload.store || category || 'Expense',
                amount: payload.amount,
                paidBy: groupOwner(selectedGroup) || '',
                category,
                store: payload.store,
                paymentMethod, // kept on the group copy so edits there don't lose it
                date: payload.date,
                note: '',
                items: [],
                billImage: null,
                expenseId: ids[0],
              }),
            },
          ])
        } else if (forFriend) {
          // ONE atomic commit for the expense and every friend row it creates.
          // Writing the expense first and then looping meant a failure partway
          // through left some friends recorded and not others — and reported
          // "Could not save" for an expense that was already saved, so tapping
          // the button again logged it a second time.
          await batchOps([
            { op: 'set', name: 'expenses', data: payload },
            ...friendCalcs.map((f) => ({
              op: 'set',
              name: 'friendPurchases',
              data: (created) => friendRow(f, created[0]),
            })),
          ])
        } else {
          await add(payload)
        }
        celebrate()
        recordAmount(payload.amount, payload.country)
      }
      localStorage.setItem(
        LAST_PAYMENT_KEY,
        JSON.stringify({ paymentMethod, country: payload.country })
      )
      // Learn the shop on edits too — that's often where a typo gets fixed.
      recordStore(payload.store)
      // Learn the stops, so the usual ones become one-tap chips next time.
      recordPlaces(payload.fromPlace, payload.toPlace)
      toast(
        forFriend && !initial?.id
          ? `✓ Saved · ${friendCalcs.length === 1 ? friendCalcs[0].name.trim() : `${friendCalcs.length} friends`} added to Friend ledger`
          : whoFor === 'group' && !initial?.id && selectedGroup
            ? `✓ ${formatByCountry(payload.amount, payload.country)} saved · added to 🏠 ${selectedGroup.name}`
            : `✓ ${formatByCountry(payload.amount, payload.country)} · ${category}${payload.store ? ` · 🏪 ${payload.store}` : ''} saved`
      )
      onSaved?.()
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={goBack}
          className="flex items-center gap-1 text-sm font-medium text-gray-500 transition-transform active:scale-90 dark:text-gray-400"
        >
          {stepIndex === 0 ? 'Cancel' : '← Back'}
        </button>

        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
          {step === 'payment' && isTopUp
            ? 'Paid from'
            : step === 'payment' && isMove
              ? 'Which account'
              : step === 'payment' && isWithdraw
                ? 'From account'
                : step === 'payment' && isBonus
                  ? 'Landed in'
                : step === 'category' && isSplit
                  ? 'Split'
                  : STEP_LABELS[step]}
          <span className="text-gray-300 dark:text-neutral-600"> · {stepIndex + 1}/{STEPS.length}</span>
        </span>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex tap-target h-8 w-8 items-center justify-center rounded-full border border-gray-300/60 bg-gray-100 text-gray-500 transition-transform active:scale-90 dark:border-transparent dark:bg-neutral-800 dark:text-gray-400"
        >
          ✕
        </button>
      </div>

      <div className="flex gap-1.5">
        {STEPS.map((s, i) => (
          <span
            key={s}
            className={`h-1 flex-1 rounded-full transition-colors duration-200 ${
              i <= stepIndex
                ? 'bg-indigo-500'
                : 'bg-gray-200 dark:bg-neutral-700'
            }`}
          />
        ))}
      </div>

      {/* The currency is not settled until the payment step, but the last
          entry's country is a good guess — so a run of rupee expenses shows ₹
          and an un-dimmed decimal point from the very first keystroke. */}
      {step === 'amount' && (
        <Keypad
          value={amount}
          onChange={setAmount}
          onNext={goNext}
          quickAmounts={topAmounts(3, country || 'JP')}
          country={country || 'JP'}
        />
      )}

      {step === 'category' && (
        <>
          <h2 className="text-center text-sm font-medium text-gray-500 dark:text-gray-400">Category</h2>
          <CategoryGrid value={category} onSelect={handleSelectCategory} />

          {/* Not spending — loading a prepaid card. Picking one here turns the
              rest of the flow into a top-up: money leaves the account you pick
              next and lands on the card's balance. */}
          {/* Only cards you actually fund yourself. Company cards (Edenred)
              are loaded by the employer, so there's nothing to top up here. */}
          {!initial?.id && selfFundedCards.length > 0 && (
            <div className="w-full max-w-xs mx-auto space-y-2">
              <p className="text-center text-[11px] text-gray-400 dark:text-gray-500">
                or load a card (not an expense)
              </p>
              <div className={`grid gap-2.5 ${selfFundedCards.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {selfFundedCards.map((card) => (
                  <button
                    key={card.name}
                    type="button"
                    onClick={() => handleSelectTopUp(card)}
                    className={`flex items-center justify-center gap-1.5 rounded-2xl border py-3 text-sm font-medium transition-transform duration-75 active:scale-90 touch-manipulation ${
                      topUpCard === card.name
                        ? 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500'
                        : 'border-gray-300/60 bg-gray-100 text-gray-800 dark:border-transparent dark:bg-neutral-800 dark:text-gray-100'
                    }`}
                  >
                    <span className="text-lg">{card.emoji}</span> Top up {card.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Neither spending nor salary: money that just landed in (or left)
              an account — interest, a fee, a UPI credit. Only the balance of
              the account picked next moves. */}
          {!initial?.id && accounts.length > 0 && (
            <div className="w-full max-w-xs mx-auto space-y-2">
              <p className="text-center text-[11px] text-gray-400 dark:text-gray-500">
                or money in / out of an account
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { key: 'credit', label: '➕ Credited', active: 'border-emerald-600 bg-emerald-600 dark:border-emerald-500 dark:bg-emerald-500' },
                  { key: 'debit', label: '➖ Debited', active: 'border-red-500 bg-red-500' },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => handleSelectMove(opt.key)}
                    className={`rounded-2xl border py-3 text-sm font-medium transition-transform duration-75 active:scale-90 touch-manipulation ${
                      moveDirection === opt.key
                        ? `${opt.active} text-white`
                        : 'border-gray-300/60 bg-gray-100 text-gray-800 dark:border-transparent dark:bg-neutral-800 dark:text-gray-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Cash out of the bank, and a lump sum broken into its parts. */}
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => handleSelectSpecial('withdraw')}
                  className={`rounded-2xl border py-3 text-sm font-medium transition-transform duration-75 active:scale-90 touch-manipulation ${
                    isWithdraw
                      ? 'border-amber-500 bg-amber-500 text-white'
                      : 'border-gray-300/60 bg-gray-100 text-gray-800 dark:border-transparent dark:bg-neutral-800 dark:text-gray-100'
                  }`}
                >
                  🏧 Withdrew cash
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectSpecial('split')}
                  className={`rounded-2xl border py-3 text-sm font-medium transition-transform duration-75 active:scale-90 touch-manipulation ${
                    isSplit
                      ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500'
                      : 'border-gray-300/60 bg-gray-100 text-gray-800 dark:border-transparent dark:bg-neutral-800 dark:text-gray-100'
                  }`}
                >
                  🧾 Split it up
                </button>
              </div>

              {/* Money on top of everything else. Books income like salary AND
                  counts as profit, because none of it replaces a cost. */}
              <button
                type="button"
                onClick={() => handleSelectSpecial('bonus')}
                className={`w-full rounded-2xl border py-3 text-sm font-medium transition-transform duration-75 active:scale-90 touch-manipulation ${
                  isBonus
                    ? 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500'
                    : 'border-gray-300/60 bg-gray-100 text-gray-800 dark:border-transparent dark:bg-neutral-800 dark:text-gray-100'
                }`}
              >
                🎉 Bonus received
              </button>

              {/* Your own money changing place. It belongs beside "Withdrew
                  cash" and the card top-ups because it is the same idea —
                  and it is the only one of them that can go in any direction. */}
              {onMoveMoney && (
              <button
                type="button"
                onClick={() => {
                  if (navigator.vibrate) navigator.vibrate(8)
                  // The amount was typed on step 1 — carry it across rather
                  // than making it be typed a second time.
                  onMoveMoney({ amount: amountNum, dateStr })
                }}
                className="w-full rounded-2xl border border-gray-300/60 bg-gray-100 py-3 text-sm font-medium text-gray-800 transition-transform duration-75 active:scale-90 touch-manipulation dark:border-transparent dark:bg-neutral-800 dark:text-gray-100"
              >
                ↔ Move money between my accounts
              </button>
              )}
            </div>
          )}
        </>
      )}

      {step === 'payment' && isBonus && (
        <>
          <h2 className="text-center text-sm font-medium text-gray-500 dark:text-gray-400">
            Where did it land?
          </h2>
          <div className="w-full max-w-xs mx-auto space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              {[...accounts.map((a) => ({ key: a.id, label: a.label, country: a.country || 'JP' })),
                { key: 'cash', label: 'Cash', country: 'JP' }].map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => {
                    if (navigator.vibrate) navigator.vibrate(8)
                    setPaymentMethod(a.label)
                    setCountry(a.country)
                    goNext()
                  }}
                  className={`rounded-2xl border py-3 px-2 text-sm font-medium transition-transform duration-75 active:scale-90 touch-manipulation ${
                    paymentMethod === a.label
                      ? 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500'
                      : 'border-gray-300/60 bg-gray-100 text-gray-800 dark:border-transparent dark:bg-neutral-800 dark:text-gray-100'
                  }`}
                >
                  {a.label === 'Cash' ? '💵' : a.country === 'IN' ? '🇮🇳' : '🇯🇵'} {a.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              Enter what actually reached you, after tax — that's the number the account moved by.
            </p>
          </div>
        </>
      )}

      {step === 'payment' && isWithdraw && (
        <>
          <h2 className="text-center text-sm font-medium text-gray-500 dark:text-gray-400">
            Out of which account?
          </h2>
          <div className="w-full max-w-xs mx-auto space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              {accounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    if (navigator.vibrate) navigator.vibrate(8)
                    setPaymentMethod(a.label)
                    setCountry(a.country || 'JP')
                    goNext()
                  }}
                  className={`rounded-2xl border py-3 px-2 text-sm font-medium transition-transform duration-75 active:scale-90 touch-manipulation ${
                    paymentMethod === a.label
                      ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500'
                      : 'border-gray-300/60 bg-gray-100 text-gray-800 dark:border-transparent dark:bg-neutral-800 dark:text-gray-100'
                  }`}
                >
                  {a.country === 'IN' ? '🇮🇳' : '🇯🇵'} {a.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              The account goes down and your cash on hand goes up by the same — never spending,
              just money changing form.
            </p>
          </div>
        </>
      )}

      {step === 'payment' && isMove && (
        <>
          <h2 className="text-center text-sm font-medium text-gray-500 dark:text-gray-400">
            {isCredit ? 'Credited to which account?' : 'Debited from which account?'}
          </h2>
          <div className="w-full max-w-xs mx-auto space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              {accounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    if (navigator.vibrate) navigator.vibrate(8)
                    setPaymentMethod(a.label)
                    setCountry(a.country || 'JP')
                    goNext()
                  }}
                  className={`rounded-2xl border py-3 px-2 text-sm font-medium transition-transform duration-75 active:scale-90 touch-manipulation ${
                    paymentMethod === a.label
                      ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500'
                      : 'border-gray-300/60 bg-gray-100 text-gray-800 dark:border-transparent dark:bg-neutral-800 dark:text-gray-100'
                  }`}
                >
                  {a.country === 'IN' ? '🇮🇳' : '🇯🇵'} {a.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              Indian accounts count in ₹, Japanese ones in ¥. For notes in your pocket use the Cash
              page instead — it's counted, not tracked here.
            </p>
          </div>
        </>
      )}

      {step === 'payment' && isTopUp && (
        <>
          <h2 className="text-center text-sm font-medium text-gray-500 dark:text-gray-400">
            Paid from
          </h2>
          <div className="w-full max-w-xs mx-auto space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              {fundingSources(accounts, 'JP').map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    if (navigator.vibrate) navigator.vibrate(8)
                    setPaymentMethod(label)
                    goNext()
                  }}
                  className={`rounded-2xl border py-3 px-2 text-sm font-medium transition-transform duration-75 active:scale-90 touch-manipulation ${
                    paymentMethod === label
                      ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500'
                      : 'border-gray-300/60 bg-gray-100 text-gray-800 dark:border-transparent dark:bg-neutral-800 dark:text-gray-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              That account's balance goes down by {formatJPY(amountNum)} and {topUpCard} goes up by
              the same. Cash isn't balance-tracked, so picking it only credits the card.
            </p>
          </div>
        </>
      )}

      {step === 'payment' && (isExpense || isSplit) && (
        <>
          <h2 className="text-center text-sm font-medium text-gray-500 dark:text-gray-400">
            Payment method
          </h2>
          <PaymentMethodGrid
            accounts={accounts}
            value={paymentMethod}
            country={country}
            onSelect={handleSelectPayment}
          />
        </>
      )}

      {step === 'confirm' && isTopUp && (
        <div className="space-y-4 w-full max-w-xs mx-auto">
          <h2 className="text-center text-sm font-medium text-gray-500 dark:text-gray-400">
            Confirm top-up
          </h2>
          <div className="max-w-full break-all text-center text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-100 sm:text-4xl">
            {formatJPY(amountNum)}
          </div>

          {/* The whole point, spelled out: where it leaves, where it lands. */}
          <div className="rounded-xl border border-gray-200 bg-gray-100/80 p-3 text-sm dark:border-transparent dark:bg-neutral-800/50">
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-500 dark:text-gray-400">
                {isCompanyCard ? 'Loaded by' : 'Out of'}
              </span>
              <span className="font-semibold text-red-500 dark:text-red-400">
                {isCompanyCard ? 'Company' : paymentMethod || 'Select'}
                {!isCompanyCard && paymentMethod && paymentMethod !== 'Cash'
                  ? ` −${formatJPY(amountNum)}`
                  : ''}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-gray-500 dark:text-gray-400">Onto</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {topUpMeta?.emoji} {topUpCard} +{formatJPY(amountNum)}
              </span>
            </div>
          </div>

          {!isCompanyCard && (
            <button
              type="button"
              onClick={() => setStepIndex(STEPS.indexOf('payment'))}
              className="w-full rounded-xl border border-gray-300/60 bg-gray-100 px-3 py-2 text-left text-sm dark:border-transparent dark:bg-neutral-800"
            >
              <span className="block text-xs text-gray-500 dark:text-gray-400">Paid from</span>
              <span className="dark:text-gray-100">{paymentMethod || 'Select'}</span>
            </button>
          )}

          <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
            Date
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="input"
            />
          </label>

          <input
            type="text"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="input"
          />

          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            {isCompanyCard
              ? `${topUpCard} is loaded by your company — nothing is taken from your own money.`
              : `This isn't spending. It becomes an expense later, when you actually pay with ${topUpCard} — so it never double-counts.`}
          </p>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="button"
            disabled={saving || amountNum <= 0 || (!isCompanyCard && !paymentMethod) || !dateStr}
            onClick={handleSave}
            className="btn-primary w-full py-3 text-sm"
          >
            {saving ? 'Saving…' : `Load ${formatJPY(amountNum)} onto ${topUpCard}`}
          </button>
        </div>
      )}

      {step === 'confirm' && isWithdraw && (
        <div className="space-y-4 w-full max-w-xs mx-auto">
          <h2 className="text-center text-sm font-medium text-gray-500 dark:text-gray-400">
            Confirm withdrawal
          </h2>
          <div className="max-w-full break-all text-center text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-100 sm:text-4xl">
            {formatByCountry(amountNum, country || 'JP')}
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-100/80 p-3 text-sm dark:border-transparent dark:bg-neutral-800/50">
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-500 dark:text-gray-400">Out of</span>
              <span className="font-semibold text-red-500 dark:text-red-400">
                {paymentMethod || 'Select'} −{formatByCountry(amountNum, country || 'JP')}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-gray-500 dark:text-gray-400">Into</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                💵 Cash +{formatByCountry(amountNum, country || 'JP')}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setStepIndex(STEPS.indexOf('payment'))}
            className="w-full rounded-xl border border-gray-300/60 bg-gray-100 px-3 py-2 text-left text-sm dark:border-transparent dark:bg-neutral-800"
          >
            <span className="block text-xs text-gray-500 dark:text-gray-400">From account</span>
            <span className="dark:text-gray-100">{paymentMethod || 'Select'}</span>
          </button>

          <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
            Date
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="input"
            />
          </label>

          <input
            type="text"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="input"
          />

          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            Count it on the Cash page whenever you want the notes and coins to match exactly. To
            log what you then spend it on, start a new entry and pick 🧾 Split it up.
          </p>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="button"
            disabled={saving || amountNum <= 0 || !paymentMethod || !dateStr}
            onClick={handleSave}
            className="btn-primary w-full py-3 text-sm"
          >
            {saving ? 'Saving…' : `Log withdrawal · ${formatByCountry(amountNum, country || 'JP')}`}
          </button>
        </div>
      )}

      {step === 'confirm' && isSplit && (
        <div className="space-y-4 w-full max-w-xs mx-auto">
          <h2 className="text-center text-sm font-medium text-gray-500 dark:text-gray-400">
            What did it go on?
          </h2>
          <div className="max-w-full break-all text-center text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-100 sm:text-4xl">
            {formatByCountry(amountNum, country || 'JP')}
          </div>

          {/* Running tally: what's accounted for, what's still in your pocket. */}
          <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-100/80 px-3 py-2 text-xs dark:border-transparent dark:bg-neutral-800/50">
            <span className="text-gray-500 dark:text-gray-400">
              {formatByCountry(splitTotal, country || 'JP')} logged
            </span>
            <span
              className={`font-semibold ${
                splitLeft < -0.01
                  ? 'text-red-500 dark:text-red-400'
                  : splitLeft > 0.01
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {splitLeft < -0.01
                ? `${formatByCountry(Math.abs(splitLeft), country || 'JP')} over`
                : splitLeft > 0.01
                  ? `${formatByCountry(splitLeft, country || 'JP')} left`
                  : 'All accounted for ✓'}
            </span>
          </div>

          <div className="space-y-2">
            {splitCalcs.map((r, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <input
                  type="text"
                  placeholder={`What ${i + 1}? e.g. lunch`}
                  value={r.what}
                  onChange={(e) => setSplitField(i, 'what', e.target.value)}
                  className="input min-w-0 flex-1"
                />
                <select
                  value={r.category}
                  onChange={(e) => setSplitField(i, 'category', e.target.value)}
                  className="input w-24 shrink-0"
                  aria-label={`Category for line ${i + 1}`}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_ICONS[c]} {c}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  placeholder="0"
                  value={r.amount}
                  onChange={(e) => setSplitField(i, 'amount', e.target.value)}
                  className="input w-20 shrink-0"
                />
                {splitRows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setSplitRows((rows) => rows.filter((_, idx) => idx !== i))}
                    aria-label={`Remove line ${i + 1}`}
                    className="mt-1.5 flex h-7 w-6 shrink-0 items-center justify-center rounded-full text-gray-400 hover:text-red-500 active:scale-90 dark:text-gray-500"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() =>
                setSplitRows((rows) => [...rows, { what: '', category: 'Food', amount: '' }])
              }
              className="rounded-lg border border-dashed border-gray-300 py-2 text-xs font-medium text-gray-500 hover:border-indigo-400 hover:text-indigo-600 active:scale-[0.98] dark:border-neutral-700 dark:text-gray-400 dark:hover:text-indigo-400"
            >
              ＋ Add line
            </button>
            {/* Drops whatever is unaccounted for into the last line. */}
            <button
              type="button"
              disabled={splitLeft <= 0.01}
              onClick={() =>
                setSplitRows((rows) =>
                  rows.map((r, idx) =>
                    idx === rows.length - 1
                      ? { ...r, amount: String((parseFloat(r.amount) || 0) + splitLeft) }
                      : r
                  )
                )
              }
              className="rounded-lg border border-dashed border-gray-300 py-2 text-xs font-medium text-gray-500 disabled:opacity-40 hover:border-indigo-400 hover:text-indigo-600 active:scale-[0.98] dark:border-neutral-700 dark:text-gray-400 dark:hover:text-indigo-400"
            >
              Use the rest
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <button
              type="button"
              onClick={() => setStepIndex(STEPS.indexOf('payment'))}
              className="rounded-xl border border-gray-300/60 bg-gray-100 px-3 py-2 text-left dark:border-transparent dark:bg-neutral-800"
            >
              <span className="block text-xs text-gray-500 dark:text-gray-400">Paid with</span>
              <span className="dark:text-gray-100">{paymentMethod || 'Select'}</span>
            </button>
            <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
              Date
              <input
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="input"
              />
            </label>
          </div>

          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            Each line is saved as its own expense, so categories and charts stay accurate. Anything
            left over is simply still in your hand — it isn't logged as spending.
          </p>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="button"
            disabled={saving || splitTotal <= 0 || !paymentMethod || !dateStr}
            onClick={handleSave}
            className="btn-primary w-full py-3 text-sm"
          >
            {saving
              ? 'Saving…'
              : `Log ${splitCalcs.filter((r) => r.value > 0).length} spend${
                  splitCalcs.filter((r) => r.value > 0).length === 1 ? '' : 's'
                }`}
          </button>
        </div>
      )}

      {step === 'confirm' && isBonus && (
        <div className="space-y-4 w-full max-w-xs mx-auto">
          <h2 className="text-center text-sm font-medium text-gray-500 dark:text-gray-400">
            Confirm bonus
          </h2>
          <div className="max-w-full break-all text-center text-3xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400 sm:text-4xl">
            +{formatByCountry(amountNum, country || 'JP')}
          </div>

          <button
            type="button"
            onClick={() => setStepIndex(STEPS.indexOf('payment'))}
            className="w-full rounded-xl border border-gray-300/60 bg-gray-100 px-3 py-2 text-left text-sm dark:border-transparent dark:bg-neutral-800"
          >
            <span className="block text-xs text-gray-500 dark:text-gray-400">Landed in</span>
            <span className="dark:text-gray-100">{paymentMethod || 'Select'}</span>
          </button>

          <div className="space-y-1.5">
            <input
              type="text"
              placeholder="What for? e.g. Summer bonus"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="input"
            />
            <div className="flex flex-wrap gap-1.5">
              {['Summer bonus', 'Winter bonus', 'Performance', 'Incentive', 'Allowance'].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setNote(note === r ? '' : r)}
                  className={`rounded-full px-3 py-1 text-[11px] font-medium transition-all active:scale-95 touch-manipulation ${
                    note === r
                      ? 'bg-emerald-600 text-white dark:bg-emerald-500'
                      : 'border border-gray-300/60 bg-white text-gray-600 dark:border-transparent dark:bg-neutral-800 dark:text-gray-300'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
            Date
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="input"
            />
          </label>

          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            Books {formatByCountry(amountNum, country || 'JP')} of income into{' '}
            {paymentMethod || 'that account'} and counts the whole thing as profit — a bonus doesn't
            replace anything you spent. Log it here only; adding it as income too would count it
            twice.
          </p>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="button"
            disabled={saving || amountNum <= 0 || !paymentMethod || !dateStr}
            onClick={handleSave}
            className="btn-primary w-full py-3 text-sm"
          >
            {saving ? 'Saving…' : `Log ${formatByCountry(amountNum, country || 'JP')} bonus`}
          </button>
        </div>
      )}

      {step === 'confirm' && isMove && (
        <div className="space-y-4 w-full max-w-xs mx-auto">
          <h2 className="text-center text-sm font-medium text-gray-500 dark:text-gray-400">
            Confirm {isCredit ? 'credit' : 'debit'}
          </h2>
          <div
            className={`max-w-full break-all text-center text-3xl font-bold tabular-nums sm:text-4xl ${
              isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
            }`}
          >
            {isCredit ? '+' : '−'}
            {formatByCountry(amountNum, country || 'JP')}
          </div>

          <button
            type="button"
            onClick={() => setStepIndex(STEPS.indexOf('payment'))}
            className="w-full rounded-xl border border-gray-300/60 bg-gray-100 px-3 py-2 text-left text-sm dark:border-transparent dark:bg-neutral-800"
          >
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              {isCredit ? 'Credited to' : 'Debited from'}
            </span>
            <span className="dark:text-gray-100">{paymentMethod || 'Select'}</span>
          </button>

          {/* Why it moved — one tap for the usual reasons, or type your own. */}
          <div className="space-y-1.5">
            <input
              type="text"
              placeholder="Why? e.g. bank interest"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="input"
            />
            <div className="flex flex-wrap gap-1.5">
              {MOVE_REASONS[moveDirection].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setNote(note === r ? '' : r)}
                  className={`rounded-full px-3 py-1 text-[11px] font-medium transition-all active:scale-95 touch-manipulation ${
                    note === r
                      ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                      : 'border border-gray-300/60 bg-white text-gray-600 dark:border-transparent dark:bg-neutral-800 dark:text-gray-300'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
            Date
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="input"
            />
          </label>

          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            Only {paymentMethod || 'that account'}'s balance moves — this is never counted as
            spending or income, so your month totals stay honest.
          </p>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="button"
            disabled={saving || amountNum <= 0 || !paymentMethod || !dateStr}
            onClick={handleSave}
            className="btn-primary w-full py-3 text-sm"
          >
            {saving
              ? 'Saving…'
              : `${isCredit ? 'Credit' : 'Debit'} ${formatByCountry(amountNum, country || 'JP')}`}
          </button>
        </div>
      )}

      {step === 'confirm' && isExpense && (
        <div className="space-y-4 w-full max-w-xs mx-auto">
          <h2 className="text-center text-sm font-medium text-gray-500 dark:text-gray-400">Confirm</h2>
          <div className="max-w-full break-all text-center text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-100 sm:text-4xl">
            {formatByCountry(parseFloat(amount) || 0, country)}
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <button
              type="button"
              onClick={() => setStepIndex(1)}
              className="rounded-xl border border-gray-300/60 bg-gray-100 px-3 py-2 text-left dark:border-transparent dark:bg-neutral-800"
            >
              <span className="block text-xs text-gray-500 dark:text-gray-400">Category</span>
              <span className="dark:text-gray-100">{category || 'Select'}</span>
            </button>
            <button
              type="button"
              onClick={() => setStepIndex(2)}
              className="rounded-xl border border-gray-300/60 bg-gray-100 px-3 py-2 text-left dark:border-transparent dark:bg-neutral-800"
            >
              <span className="block text-xs text-gray-500 dark:text-gray-400">Payment</span>
              <span className="dark:text-gray-100">{paymentMethod || 'Select'}</span>
            </button>
          </div>
          <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
            Date
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="input"
            />
          </label>
          {/* A journey is two places, not a shop. Transport swaps the store
              field for a route; every other category is untouched. */}
          {isRouteCategory(category) && (
            <div className="space-y-1.5">
              <div className="flex items-end gap-1.5">
                <label className="min-w-0 flex-1 text-[11px] text-gray-500 dark:text-gray-400">
                  From
                  <input
                    type="text"
                    list="place-suggestions"
                    placeholder="Aeon Nogata"
                    value={fromPlace}
                    onChange={(e) => setFromPlace(e.target.value)}
                    className="input mt-0.5"
                    autoComplete="off"
                  />
                </label>
                {/* The return leg is most of a commute log — one tap, not a
                    retype of both ends in the other order. */}
                <button
                  type="button"
                  aria-label="Swap from and to"
                  onClick={() => {
                    const swapped = swapRoute({ fromPlace, toPlace })
                    setFromPlace(swapped.fromPlace)
                    setToPlace(swapped.toPlace)
                  }}
                  className="mb-1 flex tap-target h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-300/60 text-gray-500 transition-transform active:scale-90 touch-manipulation dark:border-transparent dark:bg-neutral-800 dark:text-gray-300"
                >
                  <ArrowLeftRight size={15} aria-hidden="true" />
                </button>
                <label className="min-w-0 flex-1 text-[11px] text-gray-500 dark:text-gray-400">
                  To
                  <input
                    type="text"
                    list="place-suggestions"
                    placeholder="Nogata Station"
                    value={toPlace}
                    onChange={(e) => setToPlace(e.target.value)}
                    className="input mt-0.5"
                    autoComplete="off"
                  />
                </label>
              </div>
              <datalist id="place-suggestions">
                {placeSuggestions.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
              {placeSuggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {placeSuggestions.slice(0, 4).map((p) => (
                    <button
                      key={p}
                      type="button"
                      // Fills whichever end is still empty; From first.
                      onClick={() => (fromPlace ? setToPlace(p) : setFromPlace(p))}
                      className="max-w-full truncate rounded-full border border-gray-300/60 bg-white px-3 py-1 text-[11px] font-medium text-gray-600 transition-all active:scale-95 touch-manipulation dark:border-transparent dark:bg-neutral-800 dark:text-gray-300"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className={`space-y-1.5 ${isRouteCategory(category) ? 'hidden' : ''}`}>
            <input
              type="text"
              list="store-suggestions"
              placeholder="🏪 Store / shop (optional)"
              value={store}
              onChange={(e) => setStore(e.target.value)}
              className="input"
              autoComplete="off"
              enterKeyHint="done"
            />
            <datalist id="store-suggestions">
              {storeSuggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            {/* One-tap chips for your usual shops; tapping the active one clears it. */}
            {storeSuggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {storeSuggestions.slice(0, 4).map((s) => {
                  const active = normalizeStore(store).toLowerCase() === s.toLowerCase()
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStore(active ? '' : s)}
                      className={`max-w-full truncate rounded-full px-3 py-1 text-[11px] font-medium transition-all active:scale-95 touch-manipulation ${
                        active
                          ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                          : 'border border-gray-300/60 bg-white text-gray-600 dark:border-transparent dark:bg-neutral-800 dark:text-gray-300'
                      }`}
                    >
                      {s}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <input
            type="text"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="input"
          />

          {!initial?.id && (
            <div className="rounded-xl border border-gray-200 bg-gray-100/80 p-3 space-y-2.5 dark:border-transparent dark:bg-neutral-800/50">
              {/* Who is this expense for? Mine = normal spend; Split = part of it
                  is a friend's; For friend = the whole thing is on their behalf. */}
              <p className="text-xs font-medium text-gray-600 dark:text-gray-300">Who's this for?</p>
              <div className={`grid gap-2 ${groups.length > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}>
                {[
                  { key: 'mine', label: '💰 Mine' },
                  { key: 'split', label: '➗ Split' },
                  { key: 'friend', label: '🤝 Friend' },
                  // Only offered once at least one shared group exists
                  ...(groups.length > 0 ? [{ key: 'group', label: '🏠 Group' }] : []),
                ].map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setWhoFor(opt.key)}
                    className={`rounded-xl border py-2 text-xs font-medium transition-transform active:scale-95 touch-manipulation ${
                      whoFor === opt.key
                        ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500'
                        : 'border-gray-300/60 bg-white text-gray-600 dark:border-transparent dark:bg-neutral-800 dark:text-gray-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {whoFor === 'group' && (
                <div className="space-y-2">
                  {groups.length > 1 && (
                    <div className="flex flex-wrap gap-2">
                      {groups.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => setGroupId(g.id)}
                          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
                            selectedGroup?.id === g.id
                              ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                              : 'border border-gray-300/60 bg-white text-gray-600 dark:border-transparent dark:bg-neutral-800 dark:text-gray-300'
                          }`}
                        >
                          🏠 {g.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedGroup && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      Goes to <span className="font-semibold">🏠 {selectedGroup.name}</span> — splits
                      equally between {(selectedGroup.members || []).join(' & ')}. Your share is{' '}
                      {formatByCountry(
                        amountNum / Math.max(1, selectedGroup.members?.length || 1),
                        country || 'JP'
                      )}
                      ; the rest becomes pending from the others in the group.
                    </p>
                  )}
                </div>
              )}

              {forFriend && (
                <>
                  {/* How to divide the money among the people involved */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { key: 'equal', label: '⚖️ Equal' },
                      { key: 'percent', label: '％ Percent' },
                      { key: 'custom', label: '✏️ Custom' },
                    ].map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => setSplitMode(m.key)}
                        className={`rounded-lg border py-1.5 text-[11px] font-medium transition-transform active:scale-95 touch-manipulation ${
                          splitMode === m.key
                            ? 'border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500'
                            : 'border-gray-300/60 bg-white text-gray-600 dark:border-transparent dark:bg-neutral-800 dark:text-gray-300'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  {/* One row per friend: name + the input the chosen math needs.
                      Equal mode needs no input — the share is computed live. */}
                  {friendCalcs.map((f, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <input
                        type="text"
                        placeholder={`Friend ${i + 1}`}
                        value={f.name}
                        onChange={(e) => setFriendField(i, 'name', e.target.value)}
                        className="input min-w-0 flex-1"
                      />
                      {splitMode === 'percent' && (
                        <input
                          type="number"
                          step="any"
                          placeholder="%"
                          value={f.pct}
                          onChange={(e) => setFriendField(i, 'pct', e.target.value)}
                          className="input w-20"
                        />
                      )}
                      {splitMode === 'custom' && (
                        <>
                          <input
                            type="number"
                            step="any"
                            placeholder="Part"
                            value={f.part}
                            onChange={(e) => setFriendField(i, 'part', e.target.value)}
                            className="input w-20"
                            title="Their part of the cost (what they got)"
                          />
                          <input
                            type="number"
                            step="any"
                            placeholder="Pays"
                            value={f.pays}
                            onChange={(e) => setFriendField(i, 'pays', e.target.value)}
                            className="input w-20"
                            title="What they'll give you back (blank = part)"
                          />
                        </>
                      )}
                      {splitMode === 'equal' && (
                        <span className="input w-24 text-center text-gray-500 dark:text-gray-400 pointer-events-none">
                          {f.share > 0 ? formatByCountry(f.share, country || 'JP') : '—'}
                        </span>
                      )}
                      {/* Can't remove the last remaining row */}
                      {friends.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeFriendRow(i)}
                          aria-label={`Remove friend ${i + 1}`}
                          className="mt-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 hover:text-red-500 active:scale-90 dark:text-gray-500"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={addFriendRow}
                    className="w-full rounded-lg border border-dashed border-gray-300 py-1.5 text-xs font-medium text-gray-500 hover:border-indigo-400 hover:text-indigo-600 active:scale-[0.98] dark:border-neutral-700 dark:text-gray-400 dark:hover:text-indigo-400"
                  >
                    ＋ Add another friend
                  </button>

                  {/* Column hint for custom mode's two number boxes */}
                  {splitMode === 'custom' && (
                    <p className="text-[10px] text-gray-400 dark:text-gray-500">
                      Part = their share of the cost (what they got) · Pays = what they'll give you
                      back (blank = same as part).
                    </p>
                  )}

                  {/* Live breakdown so there's no math surprise on save */}
                  {sharesTotal > 0 && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {whoFor === 'split' && (
                        <>
                          Your part:{' '}
                          <span className="font-semibold text-gray-700 dark:text-gray-200">
                            {formatByCountry(Math.max(0, myPart), country || 'JP')}
                          </span>{' '}
                          ·{' '}
                        </>
                      )}
                      Friends give you back{' '}
                      <span className="font-semibold text-amber-600 dark:text-amber-400">
                        {formatByCountry(duesTotal, country || 'JP')}
                      </span>
                      {duesTotal !== sharesTotal && (
                        <span
                          className={
                            duesTotal > sharesTotal
                              ? ' text-emerald-600 dark:text-emerald-400'
                              : ' text-red-500 dark:text-red-400'
                          }
                        >
                          {' '}
                          ({duesTotal > sharesTotal ? '+' : '−'}
                          {formatByCountry(Math.abs(duesTotal - sharesTotal), country || 'JP')}{' '}
                          {duesTotal > sharesTotal ? 'profit' : 'loss'} when settled)
                        </span>
                      )}{' '}
                      — each person tracked separately in the Friends tab.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="button"
            disabled={saving || !category || !paymentMethod || !parseFloat(amount) || !dateStr}
            onClick={handleSave}
            className="btn-primary w-full py-3 text-sm"
          >
            {saving ? 'Saving…' : 'Save expense'}
          </button>
        </div>
      )}
    </BottomSheet>
  )
}
