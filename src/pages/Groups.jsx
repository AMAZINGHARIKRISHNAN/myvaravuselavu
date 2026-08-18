import { useEffect, useMemo, useRef, useState, memo, useCallback } from 'react'
import Portal from '../components/ui/Portal'
import { ArrowLeft, Camera, HandCoins, Pencil, Plus, ShoppingCart, Trash2, X } from 'lucide-react'
import { useCollection } from '../hooks/useCollection'
import { useCollectionWriters } from '../hooks/useCollectionWriters'
import { useBatchOps } from '../hooks/useBatchOps'
import { useUndoableDelete } from '../hooks/useUndoableDelete'
import { CATEGORIES } from '../lib/constants'
import { useToast } from '../context/ToastContext'
import { formatByCountry, toDate, toDateInputValue, parseDateInput } from '../lib/format'
import { downloadCsv, formatDateForCsv } from '../lib/csv'
import { computeGroupReport, settleSuggestions, balanceLog, groupOwner } from '../lib/sharedGroups'
import { paymentMethodsFor } from '../lib/money'
import { useSettings } from '../hooks/useSettings'
import { compressImage } from '../lib/imageCompress'
import { celebrate } from '../lib/celebrate'
import BottomSheet from '../components/ui/BottomSheet'
import EmptyState from '../components/ui/EmptyState'
import FloatingActionButton from '../components/ui/FloatingActionButton'
import Skeleton from '../components/ui/Skeleton'
import SwipeableRow from '../components/ui/SwipeableRow'

// Stable identity for the `group.members || NO_MEMBERS` fallback: a fresh `[]`
// literal is a new reference every render, which silently defeats any useMemo
// that lists members as a dependency.
const NO_MEMBERS = []

// Shared household groups (Splitwise-style): everyone in a group logs what
// they bought for the house, every expense splits equally between members,
// and the report says exactly who has to give whom how much to square up.
export default function Groups() {
  // No `remove` here: deleting a group is never a single-document write — it
  // has to take the group's entries and their mirrors with it, which
  // deleteGroup() does as one batched commit.
  const { data: groups, loading: groupsLoading, add: addGroup, update: updateGroup } =
    useCollection('groups')
  const { data: allEntries, loading: entriesLoading, update: updateEntry } =
    useCollection('groupExpenses')
  // Mirror writers: group entries you paid also land in the main Dashboard
  // books (expenses / income), linked by ids so the two stay in sync.
  const expenseWriters = useCollectionWriters('expenses')
  const batchOps = useBatchOps()
  const { toast } = useToast()

  const [selectedId, setSelectedId] = useState(null)
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [editingGroup, setEditingGroup] = useState(null)

  const loading = groupsLoading || entriesLoading
  const selected = groups.find((g) => g.id === selectedId)

  // ---- Dashboard sync -----------------------------------------------------
  // "My money is my money": anything YOU pay in a group is real cash out of
  // your pocket, so it mirrors into the main expense books at full amount.
  // Settlements mirror too: roommate pays you → income; you pay them → expense.

  const mirrorExpensePayload = (group, entry) => ({
    amount: entry.amount,
    category: entry.category || 'Other',
    country: group.country || 'JP',
    paymentMethod: entry.paymentMethod || 'Cash',
    // A group entry's "place" IS a store — mirroring it into the expense's
    // store field puts household buys into the app-wide store ranking.
    store: entry.place?.trim() || '',
    note: `🏠 ${group.name} · ${entry.type === 'settlement' ? `settle to ${entry.to}` : entry.item}${entry.place ? ` @ ${entry.place}` : ''}`,
    date: entry.date,
  })

  // Atomic: the group entry and its Dashboard mirror (expense or income)
  // are one commit — a dropped connection can't leave a half-pair.
  const addEntrySynced = async (group, payload) => {
    const owner = groupOwner(group)
    const paysOut = payload.paidBy === owner // your money went out
    const paysIn = payload.type === 'settlement' && payload.to === owner // cash came back to you
    const ops = [
      {
        op: 'set',
        name: 'groupExpenses',
        data: (ids) => ({
          ...payload,
          expenseId: paysOut ? ids[1] : null,
          incomeId: !paysOut && paysIn ? ids[1] : null,
        }),
      },
    ]
    if (paysOut) {
      ops.push({
        op: 'set',
        name: 'expenses',
        data: (ids) => ({ ...mirrorExpensePayload(group, payload), groupEntryId: ids[0] }),
      })
    } else if (paysIn) {
      ops.push({
        op: 'set',
        name: 'income',
        data: (ids) => ({
          amount: payload.amount,
          source: 'Group settle',
          gross: null,
          net: null,
          note: `🏠 ${group.name} · from ${payload.paidBy}`,
          // Where the money landed, so the balance actually moves. The settle
          // sheet asks in both directions: which account it left, or which one
          // it arrived in ('Cash' credits the counted cash on hand).
          account: payload.paymentMethod || null,
          // An Indian group settles in rupees — without this the yen income
          // total would swallow them.
          country: group.country || 'JP',
          date: payload.date,
          groupEntryId: ids[0],
        }),
      })
    }
    const ids = await batchOps(ops)
    return { id: ids[0] }
  }

  const updateEntrySynced = async (group, id, payload) => {
    const prev = allEntries.find((e) => e.id === id)
    await updateEntry(id, payload)
    if (!prev || payload.type !== 'expense') return
    const isMine = payload.paidBy === groupOwner(group)
    if (prev.expenseId && isMine) {
      try {
        // Partial update on purpose: the linked expense may have been created
        // through the main entry flow with its own payment method and note —
        // only the figures this edit actually changes get carried over.
        await expenseWriters.update(prev.expenseId, {
          amount: payload.amount,
          category: payload.category || 'Other',
          date: payload.date,
          ...(payload.paymentMethod ? { paymentMethod: payload.paymentMethod } : {}),
          ...(payload.place?.trim() ? { store: payload.place.trim() } : {}),
        })
      } catch {
        // Mirror was deleted elsewhere — self-heal by recreating it.
        const expRef = await expenseWriters.add({ ...mirrorExpensePayload(group, payload), groupEntryId: id })
        await updateEntry(id, { expenseId: expRef.id })
      }
    } else if (prev.expenseId && !isMine) {
      // Payer changed away from you — this is no longer your spending.
      await expenseWriters.remove(prev.expenseId)
      await updateEntry(id, { expenseId: null })
    } else if (!prev.expenseId && isMine) {
      const expRef = await expenseWriters.add({ ...mirrorExpensePayload(group, payload), groupEntryId: id })
      await updateEntry(id, { expenseId: expRef.id })
    }
  }

  // Deleting a group entry takes its Dashboard mirror with it.
  const removeEntrySynced = async (id) => {
    const entry = allEntries.find((e) => e.id === id)
    const ops = [{ op: 'delete', name: 'groupExpenses', id }]
    if (entry?.expenseId) ops.push({ op: 'delete', name: 'expenses', id: entry.expenseId })
    if (entry?.incomeId) ops.push({ op: 'delete', name: 'income', id: entry.incomeId })
    await batchOps(ops) // atomic: entry and its mirror leave together
  }

  const saveGroup = async (payload, group) => {
    if (group) {
      await updateGroup(group.id, payload)
    } else {
      // The generic subscription orders by `date`; docs without one are
      // silently dropped by Firestore, so stamp groups with creation date.
      await addGroup({ ...payload, date: new Date() })
    }
  }

  // Firestore commits at most 500 operations, so anything built from "every
  // entry in this group" goes in whole chunks rather than one write per row.
  // One write per row was both slow and only half-safe: a connection that
  // dropped in the middle left the group in a state neither the app nor the
  // user could describe.
  const commitInChunks = async (ops, size = 400) => {
    for (let i = 0; i < ops.length; i += size) {
      await batchOps(ops.slice(i, i + size))
    }
  }

  // Renaming a member must carry their history along, otherwise their past
  // payments stop counting toward anyone's balance — so the rename lands as
  // one commit, not a row at a time that can stop halfway.
  const remapEntryNames = async (groupId, renames) => {
    const ops = []
    for (const e of allEntries.filter((x) => x.groupId === groupId)) {
      const data = {}
      if (renames[e.paidBy]) data.paidBy = renames[e.paidBy]
      if (e.to && renames[e.to]) data.to = renames[e.to]
      if (Object.keys(data).length) ops.push({ op: 'update', name: 'groupExpenses', id: e.id, data })
    }
    await commitInChunks(ops)
  }

  // Deleting a group takes its entries with it — and their Dashboard mirrors.
  // Plain removeEntry() would strand the mirrored expenses/income in the main
  // books, where they stay visible forever with no group left to explain them.
  const deleteGroup = async (group) => {
    const ops = []
    for (const e of allEntries.filter((x) => x.groupId === group.id)) {
      ops.push({ op: 'delete', name: 'groupExpenses', id: e.id })
      if (e.expenseId) ops.push({ op: 'delete', name: 'expenses', id: e.expenseId })
      if (e.incomeId) ops.push({ op: 'delete', name: 'income', id: e.incomeId })
    }
    // The group itself goes last, so a failure part-way through leaves the
    // group standing and the whole thing safe to retry.
    ops.push({ op: 'delete', name: 'groups', id: group.id })
    await commitInChunks(ops)
    setSelectedId(null)
    toast(`🗑 ${group.name} deleted`)
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (selected) {
    return (
      <GroupDetail
        group={selected}
        entries={allEntries.filter((e) => e.groupId === selected.id)}
        onBack={() => setSelectedId(null)}
        onEdit={() => {
          setEditingGroup(selected)
          setShowGroupForm(true)
        }}
        addEntry={(payload) => addEntrySynced(selected, payload)}
        updateEntry={(id, payload) => updateEntrySynced(selected, id, payload)}
        removeEntry={removeEntrySynced}
        groupForm={
          showGroupForm && (
            <GroupForm
              initial={editingGroup}
              entries={allEntries.filter((e) => e.groupId === editingGroup?.id)}
              onSave={saveGroup}
              onRename={remapEntryNames}
              onDelete={deleteGroup}
              onClose={() => {
                setShowGroupForm(false)
                setEditingGroup(null)
              }}
            />
          )
        }
      />
    )
  }

  return (
    <div className="space-y-4 pb-16 lg:pb-0">
      <div className="card p-4 space-y-1">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">🏠 Shared groups</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Living with roommates? Make a group, log everything anyone buys for the house, and the
          report shows who owes whom — everything splits equally.
        </p>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon="🏠"
          message="No groups yet — create one like “Kitakyushu” for you and your roommate"
          actionLabel="+ New group"
          onAction={() => {
            setEditingGroup(null)
            setShowGroupForm(true)
          }}
        />
      ) : (
        <div className="space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              entries={allEntries.filter((e) => e.groupId === g.id)}
              onOpen={() => setSelectedId(g.id)}
            />
          ))}
        </div>
      )}

      <FloatingActionButton
        label="New group"
        onClick={() => {
          setEditingGroup(null)
          setShowGroupForm(true)
        }}
      />

      {showGroupForm && (
        <GroupForm
          initial={editingGroup}
          entries={allEntries.filter((e) => e.groupId === editingGroup?.id)}
          onSave={saveGroup}
          onRename={remapEntryNames}
          onDelete={deleteGroup}
          onClose={() => {
            setShowGroupForm(false)
            setEditingGroup(null)
          }}
        />
      )}
    </div>
  )
}

function GroupCard({ group, entries, onOpen }) {
  const report = useMemo(() => computeGroupReport(group.members || [], entries), [group.members, entries])
  const transfers = settleSuggestions(report)
  const expenseCount = entries.filter((e) => e.type !== 'settlement').length

  return (
    <button type="button" onClick={onOpen} className="card w-full p-4 text-left transition-transform active:scale-[0.99] touch-manipulation">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            🏠 {group.name}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {(group.members || []).join(' · ')} · {expenseCount} expense{expenseCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-base font-bold tabular-nums text-gray-900 dark:text-gray-100">
            {formatByCountry(report.total, group.country)}
          </p>
          <p className={`text-[11px] font-medium ${transfers.length ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {transfers.length
              ? `${transfers[0].from} owes ${formatByCountry(transfers[0].amount, group.country)}`
              : 'all settled ✓'}
          </p>
        </div>
      </div>
    </button>
  )
}

function GroupDetail({ group, entries, onBack, onEdit, addEntry, updateEntry, removeEntry, groupForm }) {
  const { pendingIds, requestDelete } = useUndoableDelete(removeEntry, 'Entry')
  const visible = useMemo(() => entries.filter((e) => !pendingIds.has(e.id)), [entries, pendingIds])

  const [showExpenseForm, setShowExpenseForm] = useState(false)
  const [editingEntry, setEditingEntry] = useState(null)
  const [settling, setSettling] = useState(null) // suggested transfer being recorded
  const [viewingImage, setViewingImage] = useState(null) // bill photo shown full-screen

  // Stable across renders, so the memoised row below actually skips work: a
  // fresh arrow per entry per render makes memo() a no-op that costs a
  // comparison. Each takes the entry rather than closing over it.
  //
  // Settlements are just "cash changed hands" — to fix one, delete it and
  // record again. Editing it as an expense would silently turn the payment
  // into new spending, so the guard lives here rather than in a null prop.
  const editEntry = useCallback((entry) => {
    if (entry?.type === 'settlement') return
    setEditingEntry(entry)
    setShowExpenseForm(true)
  }, [])
  const viewImage = useCallback((entry) => {
    if (entry?.billImage) setViewingImage(entry.billImage)
  }, [])
  const [calcPerson, setCalcPerson] = useState(null) // whose calculation log is open

  const members = group.members || NO_MEMBERS
  const report = useMemo(() => computeGroupReport(members, visible), [members, visible])
  const transfers = settleSuggestions(report)
  const fmt = (v) => formatByCountry(v, group.country)

  const sorted = useMemo(
    () => [...visible].sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0)),
    [visible]
  )

  // Where the money actually goes: total spend per shop/place, biggest first.
  // Settlements aren't spending; entries without a place pool together.
  const placeTotals = useMemo(() => {
    const map = {}
    for (const e of visible) {
      if (e.type === 'settlement') continue
      const key = e.place?.trim() || ''
      if (!map[key]) map[key] = { place: key, total: 0, count: 0 }
      map[key].total += e.amount || 0
      map[key].count += 1
    }
    return Object.values(map).sort((a, b) => b.total - a.total)
  }, [visible])
  const placeNames = useMemo(
    () => placeTotals.map((p) => p.place).filter(Boolean).sort(),
    [placeTotals]
  )
  const namedPlaces = placeTotals.filter((p) => p.place)

  const handleExport = () => {
    downloadCsv(`${group.name.toLowerCase().replace(/\s+/g, '-')}-report.csv`, sorted, [
      { label: 'Date', value: formatDateForCsv },
      { label: 'Type', value: (r) => (r.type === 'settlement' ? 'settlement' : 'expense') },
      { label: 'Item', value: (r) => r.item },
      { label: 'Paid by', value: (r) => r.paidBy },
      { label: 'Place', value: (r) => r.place || '' },
      { label: 'To', value: (r) => r.to || '' },
      { label: 'Amount', value: (r) => r.amount },
      { label: 'Items', value: (r) => (r.items || []).map((i) => `${i.name} x${i.qty || 1} @${i.price}`).join('; ') },
      { label: 'Note', value: (r) => r.note || '' },
    ])
  }

  return (
    <div className="space-y-4 pb-16 lg:pb-0">
      {/* Header: back to the group list + quick edit */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-white dark:text-gray-500 dark:hover:text-gray-200"
        >
          <ArrowLeft size={16} aria-hidden="true" /> Groups
        </button>
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit group"
          className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 transition-all hover:text-indigo-300 active:scale-90 touch-manipulation"
        >
          <Pencil size={15} />
        </button>
      </div>

      {/* The report: total spending, and each member's paid / share / balance */}
      <div className="card p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">🏠 {group.name}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Total spent together:{' '}
            <span className="font-bold tabular-nums text-gray-900 dark:text-gray-100">{fmt(report.total)}</span>
            {' '}· each share {fmt(members.length ? report.total / members.length : 0)}
          </p>
        </div>
        {/* Someone who paid for this household but is not on the member list
            — usually a member renamed or removed after they had already bought
            things. Their money is still theirs; showing it is what lets the
            list be corrected, and what keeps the balances adding up. */}
        {Object.entries(report.members)
          .filter(([, s]) => s.external)
          .map(([name, s]) => (
            <p
              key={`ext-${name}`}
              className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400"
            >
              ⓘ <b>{name}</b> paid {fmt(s.paid)} for this group but is not on the member list.
              They are still owed {fmt(s.net)}. Add them back, or rename a member to match, and
              the balances square up.
            </p>
          ))}

        {/* Per-person totals: what each member has spent for the group so
            far, their fair share, and where that leaves their balance. */}
        <div className="grid grid-cols-2 gap-2.5">
          {members.map((m) => {
            const s = report.members[m]
            const settled = Math.abs(s.net) < 1
            const count = visible.filter((e) => e.type !== 'settlement' && e.paidBy === m).length
            return (
              <button
                type="button"
                key={m}
                onClick={() => setCalcPerson(m)}
                className="rounded-xl border border-gray-200 bg-gray-100/80 p-3 text-left transition-transform active:scale-[0.98] touch-manipulation dark:border-transparent dark:bg-neutral-800/50"
              >
                <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 truncate">
                  {m} spent
                </p>
                <p className="text-base font-bold tabular-nums text-gray-900 dark:text-gray-100">
                  {fmt(s.paid)}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {count} expense{count === 1 ? '' : 's'} · share {fmt(s.share)}
                </p>
                <p
                  className={`text-[11px] font-semibold tabular-nums ${
                    settled || s.net > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {settled ? 'settled ✓' : s.net > 0 ? `gets back ${fmt(s.net)}` : `owes ${fmt(-s.net)}`}
                  <span className="font-normal text-gray-400 dark:text-gray-500"> · how? ▸</span>
                </p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Who pays whom to square up — one tap records the cash handover */}
      {transfers.length > 0 && (
        <div className="card p-4 space-y-2.5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">⚖️ To settle up</h2>
          {transfers.map((t) => (
            <div
              key={`${t.from}->${t.to}`}
              className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-100/80 px-3 py-2 dark:border-transparent dark:bg-neutral-800/50"
            >
              <span className="min-w-0 text-sm text-gray-800 dark:text-gray-100 truncate">
                <span className="font-medium">{t.from}</span> gives{' '}
                <span className="font-medium">{t.to}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {/* Tap the pending amount to see the calculation log behind it */}
                <button
                  type="button"
                  onClick={() => setCalcPerson(t.from)}
                  className="text-sm font-bold tabular-nums text-amber-600 underline decoration-dotted underline-offset-4 active:scale-95 touch-manipulation dark:text-amber-400"
                >
                  {fmt(t.amount)}
                </button>
                <button
                  type="button"
                  onClick={() => setSettling(t)}
                  className="rounded-full bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-transform active:scale-95 touch-manipulation dark:bg-indigo-500"
                >
                  Mark paid
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Spend-by-place rollup: which shops actually eat the money */}
      {namedPlaces.length > 0 && (
        <div className="card p-4 space-y-2.5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">📍 Where the money goes</h2>
          {placeTotals.map((p) => (
            <div key={p.place || '·none·'} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate font-medium text-gray-700 dark:text-gray-300">
                  {p.place || 'Place not noted'}
                  <span className="font-normal text-gray-500 dark:text-gray-400">
                    {' '}· {p.count} purchase{p.count === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                  {fmt(p.total)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-neutral-800">
                <div
                  className="h-full rounded-full bg-indigo-500 dark:bg-indigo-400"
                  style={{ width: `${Math.round((p.total / (placeTotals[0]?.total || 1)) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <button type="button" onClick={handleExport} className="btn-ghost w-full py-2 text-xs">
        ⬇ Export report CSV
      </button>

      <div className="space-y-2">
        {sorted.length === 0 && (
          <EmptyState
            icon="🛒"
            message="Nothing logged yet — add the first shared expense"
            actionLabel="+ Add expense"
            onAction={() => {
              setEditingEntry(null)
              setShowExpenseForm(true)
            }}
          />
        )}
        {sorted.map((e) => (
          <SwipeableRow
            key={e.id}
            onEdit={() => editEntry(e)}
            onDelete={() => requestDelete(e.id)}
          >
            <EntryRow
              entry={e}
              country={group.country}
              onViewImage={viewImage}
              onEdit={editEntry}
              onDelete={requestDelete}
            />
          </SwipeableRow>
        ))}
      </div>

      <FloatingActionButton
        label="Add shared expense"
        onClick={() => {
          setEditingEntry(null)
          setShowExpenseForm(true)
        }}
      />

      {showExpenseForm && (
        <ExpenseSheet
          group={group}
          initial={editingEntry}
          placeNames={placeNames}
          addEntry={addEntry}
          updateEntry={updateEntry}
          onClose={() => {
            setShowExpenseForm(false)
            setEditingEntry(null)
          }}
        />
      )}
      {settling && (
        <SettleSheet group={group} transfer={settling} addEntry={addEntry} onClose={() => setSettling(null)} />
      )}
      {viewingImage && <ImageViewer src={viewingImage} onClose={() => setViewingImage(null)} />}
      {calcPerson && (
        <CalcLogSheet
          group={group}
          entries={visible}
          person={calcPerson}
          onClose={() => setCalcPerson(null)}
        />
      )}
      {groupForm}
    </div>
  )
}

// Memoised: a group can hold a lot of entries, and a keystroke elsewhere on
// the page should not redraw all of them. Only possible because the handlers
// above are stable and each takes the entry rather than closing over it.
const EntryRow = memo(function EntryRow({ entry: e, country, onViewImage, onEdit, onDelete }) {
  const isSettlement = e.type === 'settlement'
  // Itemized bills expand in place: tap the 🧾 tag to see every product
  // with its qty and line total, tap again to fold it away.
  const [showItems, setShowItems] = useState(false)
  const hasItems = e.items?.length > 0
  return (
    <div className="card p-3 pl-4 flex items-center gap-3 animate-[toast-in_0.15s_ease-out]">
      <span className="icon-tile">
        {isSettlement ? <HandCoins size={15} aria-hidden="true" /> : <ShoppingCart size={15} aria-hidden="true" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
          {isSettlement ? (
            <>
              {e.paidBy} <span className="font-normal text-gray-500 dark:text-gray-400">paid</span> {e.to}
            </>
          ) : (
            <>
              {e.item} <span className="font-normal text-gray-500 dark:text-gray-400">· {e.paidBy} paid</span>
            </>
          )}
        </p>
        <p className="text-xs text-gray-500 truncate dark:text-gray-400">
          {toDate(e.date)?.toLocaleDateString()}
          {isSettlement && ' · settle up'}
          {e.place && ` · 📍 ${e.place}`}
          {hasItems && (
            <>
              {' · '}
              <button
                type="button"
                onClick={() => setShowItems((v) => !v)}
                className="font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
              >
                🧾 {e.items.length} item{e.items.length === 1 ? '' : 's'} {showItems ? '▴' : '▾'}
              </button>
            </>
          )}
          {e.note && ` · ${e.note}`}
        </p>
        {showItems && hasItems && (
          <div className="mt-1.5 space-y-0.5 rounded-lg bg-gray-100/80 px-2.5 py-1.5 dark:bg-neutral-800/50">
            {e.items.map((it, i) => (
              <p key={i} className="flex justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-300">
                <span className="min-w-0 truncate">
                  {it.name}
                  {(it.qty || 1) > 1 && (
                    <span className="text-gray-500 dark:text-gray-400">
                      {' '}×{it.qty} @ {formatByCountry(it.price, country)}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-medium tabular-nums">
                  {formatByCountry((it.qty || 1) * it.price, country)}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>
      <span className="shrink-0 text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100">
        {formatByCountry(e.amount, country)}
      </span>
      <div className="flex shrink-0 gap-0.5">
        {e.billImage && (
          <button
            type="button"
            onClick={() => onViewImage(e)}
            aria-label="View bill photo"
            className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 transition-all hover:text-indigo-600 active:scale-90 touch-manipulation dark:text-gray-500 dark:hover:text-indigo-400"
          >
            <Camera size={15} />
          </button>
        )}
        {!isSettlement && (
          <button
            type="button"
            onClick={() => onEdit(e)}
            aria-label="Edit"
            className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 transition-all hover:text-indigo-600 active:scale-90 touch-manipulation dark:text-gray-500 dark:hover:text-indigo-400"
          >
            <Pencil size={15} />
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(e.id)}
          aria-label="Delete"
          className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 transition-all hover:text-red-500 active:scale-90 touch-manipulation dark:text-gray-500 dark:hover:text-red-400"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  )})

// Log one shared purchase: what, how much, who fronted the money. The split
// itself is automatic — always equal between all members. Optionally attach
// a bill photo and/or itemize the receipt line by line (amount auto-totals).
function ExpenseSheet({ group, initial, placeNames = [], addEntry, updateEntry, onClose }) {
  const { toast } = useToast()
  const members = group.members || NO_MEMBERS
  const [item, setItem] = useState(initial?.item ?? '')
  const [amount, setAmount] = useState(initial?.amount ?? '')
  const [paidBy, setPaidBy] = useState(initial?.paidBy ?? members[0] ?? '')
  const [date, setDate] = useState(toDateInputValue(initial?.date))
  const [note, setNote] = useState(initial?.note ?? '')
  const [items, setItems] = useState(
    // Older entries were saved without qty — treat those as qty 1.
    initial?.items?.length ? initial.items.map((i) => ({ qty: 1, ...i })) : []
  )
  const [category, setCategory] = useState(initial?.category ?? 'Food')
  const [place, setPlace] = useState(initial?.place ?? '')
  // How the money left your pocket — asked exactly like the home screen,
  // preselecting whatever you used last time there.
  const [paymentMethod, setPaymentMethod] = useState(
    initial?.paymentMethod ?? loadLastPaymentMethod()
  )
  const owner = groupOwner(group)
  const [billImage, setBillImage] = useState(initial?.billImage ?? '')
  const [imageBusy, setImageBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Itemized mode: any item rows present → the total is Σ(qty × price) and
  // the amount field locks. No rows → plain single-amount entry.
  const cleanedItems = items
    .map((i) => ({
      name: (i.name || '').trim(),
      qty: parseFloat(i.qty) || 1,
      price: parseFloat(i.price) || 0,
    }))
    .filter((i) => i.name || i.price > 0)
  const itemized = items.length > 0
  const amountNum = itemized
    ? cleanedItems.reduce((s, i) => s + i.qty * i.price, 0)
    : parseFloat(amount) || 0
  const share = members.length ? amountNum / members.length : 0

  const setItemField = (i, key, value) =>
    setItems((prev) => prev.map((row, j) => (j === i ? { ...row, [key]: value } : row)))

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setImageBusy(true)
    setError('')
    try {
      setBillImage(await compressImage(file))
    } catch (err) {
      setError(err.message || 'Could not read that photo.')
    } finally {
      setImageBusy(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!item.trim() || !amountNum || !paidBy) {
      setError('Item, amount and who paid are required.')
      return
    }
    if (paidBy === owner && !paymentMethod) {
      setError('How did you pay? Pick a payment method.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        groupId: group.id,
        type: 'expense',
        item: item.trim(),
        amount: amountNum,
        paidBy,
        date: parseDateInput(date),
        note,
        place: place.trim(), // shop/place, for the "where do we spend" rollup
        category, // used by the Dashboard mirror when you're the payer
        paymentMethod: paidBy === owner ? paymentMethod : null,
        items: cleanedItems.filter((i) => i.name && i.price > 0),
        billImage: billImage || null,
      }
      if (paidBy === owner) rememberPaymentMethod(paymentMethod, group.country)
      if (initial?.id) {
        await updateEntry(initial.id, payload)
      } else {
        await addEntry(payload)
        celebrate()
      }
      toast(`✓ ${item.trim()} saved to ${group.name}`)
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      as="form"
      onSubmit={handleSubmit}
      onClose={onClose}
      title={initial ? 'Edit shared expense' : `Bought for ${group.name}`}
    >
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Field label="What did you buy?">
        <input
          value={item}
          onChange={(e) => setItem(e.target.value)}
          placeholder="e.g. Groceries, rice cooker, detergent"
          required
          autoFocus={!initial}
          className="input"
        />
      </Field>

      <Field label="Where did you buy it? (shop / place)">
        <input
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          list="group-places"
          placeholder="e.g. Don Quijote, 7-Eleven, Amazon"
          className="input"
        />
        <datalist id="group-places">
          {placeNames.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={itemized ? 'Amount (sum of items)' : 'Amount'}>
          <input
            type="number"
            step="any"
            required={!itemized}
            disabled={itemized}
            value={itemized ? amountNum : amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input disabled:opacity-60"
          />
        </Field>
        <Field label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </Field>
      </div>

      {/* Optional receipt breakdown: each line has its own price tag and the
          total above follows automatically. */}
      <FieldBlock label="Items on the bill (optional — auto-totals)">
        <div className="space-y-2">
          {items.map((row, i) => {
            const lineTotal = (parseFloat(row.qty) || 1) * (parseFloat(row.price) || 0)
            return (
              <div key={i} className="space-y-1">
                <div className="flex items-center gap-2">
                  <input
                    value={row.name}
                    onChange={(e) => setItemField(i, 'name', e.target.value)}
                    placeholder={`Product ${i + 1}`}
                    className="input min-w-0 flex-1"
                  />
                  <input
                    type="number"
                    step="any"
                    min="0"
                    inputMode="numeric"
                    value={row.qty}
                    onChange={(e) => setItemField(i, 'qty', e.target.value)}
                    placeholder="Qty"
                    aria-label="Quantity"
                    className="input w-14 shrink-0 px-2 text-center"
                  />
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={row.price}
                    onChange={(e) => setItemField(i, 'price', e.target.value)}
                    placeholder="Price of 1"
                    aria-label="Price of one"
                    className="input w-20 shrink-0 px-2"
                  />
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
                    aria-label="Remove item"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-400 transition-all hover:text-red-500 active:scale-90 touch-manipulation"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {(parseFloat(row.qty) || 1) > 1 && lineTotal > 0 && (
                  <p className="text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                    = {formatByCountry(lineTotal, group.country)}
                  </p>
                )}
              </div>
            )
          })}
          <button
            type="button"
            onClick={() => setItems((prev) => [...prev, { name: '', qty: 1, price: '' }])}
            className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400"
          >
            <Plus size={13} aria-hidden="true" /> Add product (name · qty · price of one)
          </button>
        </div>
      </FieldBlock>

      {/* Optional bill photo, compressed on-device to fit inside the record */}
      <FieldBlock label="Bill photo (optional)">
        {billImage ? (
          <div className="relative inline-block">
            <img src={billImage} alt="Bill" className="h-24 rounded-xl border border-gray-200 object-cover dark:border-white/10" />
            <button
              type="button"
              onClick={() => setBillImage('')}
              aria-label="Remove photo"
              className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 text-white shadow dark:bg-neutral-700"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-full border border-gray-200 bg-gray-100/80 px-3.5 py-2 text-xs font-semibold text-gray-700 transition-all active:scale-95 touch-manipulation dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300">
            <Camera size={14} aria-hidden="true" />
            {imageBusy ? 'Compressing…' : 'Add bill photo'}
            <input type="file" accept="image/*" onChange={handlePhoto} disabled={imageBusy} className="hidden" />
          </label>
        )}
      </FieldBlock>

      <FieldBlock label="Who paid?">
        <div className="flex flex-wrap gap-2">
          {members.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setPaidBy(m)}
              className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
                paidBy === m
                  ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                  : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </FieldBlock>

      {/* When you're the payer this also lands in your Dashboard books —
          ask how you paid and which category, exactly like the home screen. */}
      {paidBy === owner && (
        <>
          <FieldBlock label="How did you pay?">
            <PaymentPills value={paymentMethod} onChange={setPaymentMethod} country={group.country} />
          </FieldBlock>
          <Field label="Dashboard category (this is your money, so it counts in your main spending too)">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      <Field label="Note (optional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
      </Field>

      {amountNum > 0 && members.length > 1 && (
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
          Splits equally: {formatByCountry(share, group.country)} each for {members.length} people
        </p>
      )}

      <button type="submit" disabled={saving} className="btn-primary w-full py-3 text-sm">
        {saving ? 'Saving…' : 'Save expense'}
      </button>
    </BottomSheet>
  )
}

// Records the actual cash handover for a suggested transfer. The amount is
// editable so a partial payment (or a rounded-up one) is still recordable.
// When YOU are the one paying, it asks how — that payment mirrors into the
// main Dashboard as an expense.
function SettleSheet({ group, transfer, addEntry, onClose }) {
  const { toast } = useToast()
  const [amount, setAmount] = useState(String(transfer.amount || ''))
  const [paymentMethod, setPaymentMethod] = useState(loadLastPaymentMethod())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const youArePaying = transfer.from === groupOwner(group)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const amountNum = parseFloat(amount) || 0
    if (amountNum <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    if (!paymentMethod) {
      setError(youArePaying ? 'How did you pay? Pick a payment method.' : 'Where did the money land?')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (youArePaying) rememberPaymentMethod(paymentMethod, group.country)
      await addEntry({
        // Kept in both directions: paying, it's the method the expense mirror
        // uses; getting paid, it's the account the income lands in.
        groupId: group.id,
        type: 'settlement',
        item: 'Settle up',
        amount: amountNum,
        paidBy: transfer.from,
        to: transfer.to,
        paymentMethod,
        date: new Date(),
        note: '',
      })
      toast(`✓ ${transfer.from} paid ${transfer.to} ${formatByCountry(amountNum, group.country)}`)
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  return (
    <BottomSheet as="form" onSubmit={handleSubmit} onClose={onClose} title={`${transfer.from} pays ${transfer.to}`}>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Suggested: {formatByCountry(transfer.amount, group.country)} squares everyone up. Change it if
        a different amount actually changed hands.
      </p>
      <Field label="Amount handed over">
        <input
          type="number"
          step="any"
          required
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="input"
        />
      </Field>
      <FieldBlock
        label={
          youArePaying
            ? 'How did you pay? (this counts as your spending on the Dashboard)'
            : 'Where did the money land? (that balance goes up by this much)'
        }
      >
        <PaymentPills value={paymentMethod} onChange={setPaymentMethod} country={group.country} />
      </FieldBlock>
      <button type="submit" disabled={saving} className="btn-primary w-full py-3 text-sm">
        {saving ? 'Saving…' : 'Record payment'}
      </button>
    </BottomSheet>
  )
}

// ---- Payment method helpers (shared with the home-screen entry flow) ----

// Same localStorage key the home screen uses, so both flows preselect
// whatever method you used last, anywhere.
const LAST_PAYMENT_KEY = 'vs_last_payment'

function loadLastPaymentMethod() {
  try {
    return JSON.parse(localStorage.getItem(LAST_PAYMENT_KEY) || 'null')?.paymentMethod ?? null
  } catch {
    return null
  }
}

function rememberPaymentMethod(paymentMethod, country) {
  try {
    localStorage.setItem(LAST_PAYMENT_KEY, JSON.stringify({ paymentMethod, country: country || 'JP' }))
  } catch {
    // storage full/blocked — remembering the method is best-effort anyway
  }
}

// The ways you can pay into THIS group's ledger, as tap-pills.
//
// A group is settled in one currency (group.country), so listing every account
// let a yen share be paid from an Indian one — the group's maths stayed right
// while the account it named lost rupees.
function PaymentPills({ value, onChange, country = 'JP' }) {
  const { settings } = useSettings()
  const accounts = settings?.accounts || []
  const options = paymentMethodsFor(accounts, country)
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((label) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(label)}
          className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
            value === label
              ? 'bg-indigo-600 text-white dark:bg-indigo-500'
              : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// Create or edit a group: name, currency, and member names. Members can be
// renamed later — their expense history follows the new name automatically.
function GroupForm({ initial, entries = [], onSave, onRename, onDelete, onClose }) {
  const { toast } = useToast()
  const [name, setName] = useState(initial?.name ?? '')
  const [country, setCountry] = useState(initial?.country ?? 'JP')
  // Rows carry their ORIGINAL name, not just the edited one. Pairing renames
  // by array position instead breaks the moment a row is removed: deleting
  // [A,B,C][0] leaves [B,C], and position matching then reads that as
  // "A renamed to B, B renamed to C" — silently reassigning every one of A's
  // and B's purchases to the wrong person.
  const [rows, setRows] = useState(() =>
    initial?.members?.length
      ? initial.members.map((m, i) => ({ key: `m${i}`, name: m, original: m }))
      : [
          { key: 'm0', name: '', original: null },
          { key: 'm1', name: '', original: null },
        ]
  )
  const nextKey = useRef(rows.length)
  const members = rows.map((r) => r.name)
  // Which member is the account owner — their group payments mirror into
  // the main Dashboard as real spending.
  const [ownerName, setOwnerName] = useState(initial ? groupOwner(initial) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Timer handle for the confirm-again window below; cleared on unmount so a
  // sheet closed mid-decision leaves nothing running.
  const disarm = useRef(null)
  useEffect(() => () => clearTimeout(disarm.current), [])

  const namedMembers = members.map((m) => m.trim()).filter(Boolean)
  // Fallback order when no owner is marked yet (or theirs was renamed):
  // anyone called "Amazing" is the user, else the first member.
  const activeOwner = namedMembers.includes(ownerName)
    ? ownerName
    : namedMembers.find((m) => /amazing/i.test(m)) || namedMembers[0]

  const setMember = (i, value) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, name: value } : r)))

  // A member who already paid for things can't just be dropped: their entries
  // would keep inflating everyone's share while their own payments stopped
  // counting, so the balances would quietly stop adding up to zero.
  const entryCount = (member) =>
    entries.filter((e) => e.paidBy === member || e.to === member).length

  const handleSubmit = async (e) => {
    e.preventDefault()
    const cleaned = members.map((m) => m.trim()).filter(Boolean)
    if (!name.trim()) {
      setError('Group name is required.')
      return
    }
    if (cleaned.length < 2) {
      setError('Add at least two members — a split needs company.')
      return
    }
    if (new Set(cleaned.map((m) => m.toLowerCase())).size !== cleaned.length) {
      setError('Member names must be different from each other.')
      return
    }
    // Renames pair by row identity, so a removed row can't be misread as a
    // chain of renames across everyone below it.
    const renames = {}
    for (const r of rows) {
      const next = r.name.trim()
      if (r.original && next && r.original !== next) renames[r.original] = next
    }
    const dropped = (initial?.members || []).filter(
      (m) => !renames[m] && !cleaned.includes(m)
    )
    const blocked = dropped.filter((m) => entryCount(m) > 0)
    if (blocked.length) {
      setError(
        `${blocked.join(' and ')} still ${blocked.length === 1 ? 'has' : 'have'} expenses in this group — settle up and delete their entries first, or rename them instead.`
      )
      return
    }

    setSaving(true)
    setError('')
    try {
      const owner = renames[activeOwner] || activeOwner
      await onSave(
        {
          name: name.trim(),
          country,
          members: cleaned,
          owner: cleaned.includes(owner)
            ? owner
            : cleaned.find((m) => /amazing/i.test(m)) || cleaned[0],
        },
        initial
      )
      if (initial && Object.keys(renames).length) await onRename(initial.id, renames)
      toast(`✓ ${name.trim()} saved`)
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      // Disarms itself. Deleting a group takes every expense in it and their
      // mirrors in the main books, so the two-step warning is right here — but
      // an armed state with no expiry meant arming it, being distracted, and
      // coming back to a button that destroys all of that on a single tap.
      clearTimeout(disarm.current)
      disarm.current = setTimeout(() => setConfirmDelete(false), 5000)
      return
    }
    clearTimeout(disarm.current)
    setSaving(true)
    try {
      await onDelete(initial)
      onClose()
    } catch {
      setError('Could not delete. Try again.')
      setSaving(false)
    }
  }

  return (
    <BottomSheet as="form" onSubmit={handleSubmit} onClose={onClose} title={initial ? 'Edit group' : 'New shared group'}>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Group name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Kitakyushu"
            required
            autoFocus={!initial}
            className="input"
          />
        </Field>
        <Field label="Currency">
          <select value={country} onChange={(e) => setCountry(e.target.value)} className="input">
            <option value="JP">¥ JPY</option>
            <option value="IN">₹ INR</option>
          </select>
        </Field>
      </div>

      <FieldBlock label="Members (everyone splits equally)">
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.key} className="flex items-center gap-2">
              <input
                value={r.name}
                onChange={(e) => setMember(i, e.target.value)}
                placeholder={i === 0 ? 'You (e.g. Hari)' : 'Roommate'}
                className="input"
              />
              {rows.length > 2 && (
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="Remove member"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-400 transition-all hover:text-red-500 active:scale-90 touch-manipulation"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setRows((prev) => [
                ...prev,
                { key: `m${nextKey.current++}`, name: '', original: null },
              ])
            }
            className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400"
          >
            <Plus size={13} aria-hidden="true" /> Add member
          </button>
        </div>
      </FieldBlock>

      {/* Marking yourself makes YOUR group payments count in the main
          Dashboard spending automatically. */}
      {namedMembers.length >= 2 && (
        <FieldBlock label="Which one is you? (your payments sync to the Dashboard)">
          <div className="flex flex-wrap gap-2">
            {namedMembers.map((m) => {
              const active = activeOwner === m
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setOwnerName(m)}
                  className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
                    active
                      ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                      : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
                  }`}
                >
                  {m}
                </button>
              )
            })}
          </div>
        </FieldBlock>
      )}

      <button type="submit" disabled={saving} className="btn-primary w-full py-3 text-sm">
        {saving ? 'Saving…' : initial ? 'Save changes' : 'Create group'}
      </button>

      {initial && (
        <button
          type="button"
          disabled={saving}
          onClick={handleDelete}
          className={`w-full py-2 text-xs font-medium underline-offset-2 hover:underline ${
            confirmDelete ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          {confirmDelete
            ? 'Tap again to delete the group AND all its expenses'
            : 'Delete this group…'}
        </button>
      )}
    </BottomSheet>
  )
}

function Field({ label, children }) {
  return (
    <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
      {label}
      {children}
    </label>
  )
}

// Like Field but a plain <div>, for content that contains its own labels or
// buttons (nesting those inside a <label> breaks taps on mobile Safari).
function FieldBlock({ label, children }) {
  return (
    <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
      <p>{label}</p>
      {children}
    </div>
  )
}

// The calculation log: every entry that moved this member's balance, in
// date order with a running total — so an alternating "I buy today, they
// buy tomorrow" pattern visibly tallies down to the final pending amount.
function CalcLogSheet({ group, entries, person, onClose }) {
  const members = group.members || NO_MEMBERS
  const fmt = (v) => formatByCountry(v, group.country)
  const log = useMemo(() => balanceLog(members, entries, person), [members, entries, person])
  const final = log.length ? log[log.length - 1].running : 0

  const describe = ({ entry: e }) => {
    if (e.type === 'settlement') {
      return e.paidBy === person ? `${person} paid ${e.to} (settle up)` : `${e.paidBy} paid ${person} (settle up)`
    }
    return `${e.paidBy} paid ${fmt(e.amount)} — ${e.item}`
  }

  return (
    <BottomSheet onClose={onClose} title={`${person}'s balance — full calculation`}>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Every expense splits {members.length} ways: what {person} pays counts fully in their
        favour, minus their equal share of everything bought. Green = gets back more, amber =
        owes more.
      </p>

      {log.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Nothing affects this balance yet.</p>
      ) : (
        <div className="space-y-0.5 rounded-xl border border-gray-200 bg-gray-100/80 p-3 dark:border-transparent dark:bg-neutral-800/50">
          {log.map((row, i) => (
            <div key={row.entry.id ?? i} className="flex items-start justify-between gap-3 py-1">
              <div className="min-w-0">
                <p className="text-xs text-gray-700 dark:text-gray-200 truncate">{describe(row)}</p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  {toDate(row.entry.date)?.toLocaleDateString()}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={`text-xs font-semibold tabular-nums ${
                    row.delta > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {row.delta > 0 ? '+' : '−'}
                  {fmt(Math.abs(row.delta))}
                </p>
                <p className="text-[10px] tabular-nums text-gray-500 dark:text-gray-400">
                  = {row.running >= 0 ? '+' : '−'}
                  {fmt(Math.abs(row.running))}
                </p>
              </div>
            </div>
          ))}
          <p className="flex justify-between border-t border-gray-300 pt-2 text-xs font-semibold text-gray-800 dark:border-white/10 dark:text-gray-100">
            <span>Now</span>
            <span
              className={`tabular-nums ${
                Math.abs(final) < 1
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : final > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {Math.abs(final) < 1
                ? 'settled ✓'
                : final > 0
                  ? `gets back ${fmt(final)}`
                  : `owes ${fmt(-final)}`}
            </span>
          </p>
        </div>
      )}
    </BottomSheet>
  )
}

// Full-screen bill photo viewer — tap anywhere to dismiss.
function ImageViewer({ src, onClose }) {
  return (
    // Portalled so the lightbox covers the screen rather than the page's
    // content box — see components/ui/Portal.jsx.
    <Portal>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close photo"
        className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/90 p-4 animate-[toast-in_0.15s_ease-out]"
      >
        <img src={src} alt="Bill" className="max-h-full max-w-full rounded-xl object-contain" />
      </button>
    </Portal>
  )
}
