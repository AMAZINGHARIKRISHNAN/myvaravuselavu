import { useMemo, useState } from 'react'
import { Pencil, RotateCcw, ShoppingBag, Trash2 } from 'lucide-react'
import { useCollection } from '../hooks/useCollection'
import { useCollectionWriters } from '../hooks/useCollectionWriters'
import { useBatchOps } from '../hooks/useBatchOps'
import { useUndoableDelete } from '../hooks/useUndoableDelete'
import { fundingSources, paymentMethodsFor } from '../lib/money'
import { useSettings } from '../hooks/useSettings'
import { useToast } from '../context/ToastContext'
import { formatJPY, toDate, toDateInputValue, parseDateInput } from '../lib/format'
import BottomSheet from '../components/ui/BottomSheet'
import EmptyState from '../components/ui/EmptyState'
import FloatingActionButton from '../components/ui/FloatingActionButton'
import Skeleton from '../components/ui/Skeleton'
import SwipeableRow from '../components/ui/SwipeableRow'

// Not exported: nothing outside this page uses it, and exporting a constant
// from a component file is what breaks fast refresh.
const STORES = [
  { name: 'Temu', emoji: '🧧' },
  { name: 'Shein', emoji: '👗' },
  { name: 'Amazon', emoji: '📦' },
  { name: 'Other', emoji: '🛒' },
]
const storeOf = (name) => STORES.find((s) => s.name === name) || STORES[STORES.length - 1]

// Online shopping tracker: every order split into its real-money part and
// its points part. The cash part mirrors into main expenses; a return's
// money refund mirrors back as income — so the books always match reality.
export default function Shopping() {
  const orders = useCollection('onlineOrders')
  const pointsLog = useCollection('storePoints')
  const expenseWriters = useCollectionWriters('expenses')
  const batchOps = useBatchOps()
  const { settings, save: saveSettings } = useSettings()
  const { toast } = useToast()

  const [showOrderSheet, setShowOrderSheet] = useState(false)
  const [editingOrder, setEditingOrder] = useState(null)
  const [returningOrder, setReturningOrder] = useState(null)
  const [showBudgetSheet, setShowBudgetSheet] = useState(false)

  // ---- Mirrored writes: cash part ↔ expenses, money refunds ↔ income ----

  const mirrorNote = (o) => `🛒 ${o.store} · ${o.item}`

  // Atomic: order + its cash-part expense mirror land in one commit.
  const addOrderSynced = async (payload) => {
    const hasCash = payload.cashPaid > 0
    const ids = await batchOps([
      {
        op: 'set',
        name: 'onlineOrders',
        data: (ids) => ({ ...payload, expenseId: hasCash ? ids[1] : null }),
      },
      ...(hasCash
        ? [
            {
              op: 'set',
              name: 'expenses',
              data: (ids) => ({
                amount: payload.cashPaid,
                category: 'Shopping',
                country: 'JP',
                paymentMethod: payload.paymentMethod || 'Cash',
                // Same field the manual sheet writes, so online shops rank
                // alongside physical ones in the Charts store ranking.
                store: payload.store || '',
                note: mirrorNote(payload),
                date: payload.date,
                orderId: ids[0],
              }),
            },
          ]
        : []),
    ])
    return { id: ids[0] }
  }

  const updateOrderSynced = async (id, payload) => {
    const prev = orders.data.find((o) => o.id === id)
    await orders.update(id, payload)
    if (!prev) return
    if (prev.expenseId && payload.cashPaid > 0) {
      try {
        await expenseWriters.update(prev.expenseId, {
          amount: payload.cashPaid,
          paymentMethod: payload.paymentMethod || 'Cash',
          store: payload.store || '',
          note: mirrorNote(payload),
          date: payload.date,
        })
      } catch {
        // Mirror was deleted elsewhere — self-heal by recreating it.
        const expRef = await expenseWriters.add({
          amount: payload.cashPaid,
          category: 'Shopping',
          country: 'JP',
          paymentMethod: payload.paymentMethod || 'Cash',
          store: payload.store || '',
          note: mirrorNote(payload),
          date: payload.date,
          orderId: id,
        })
        await orders.update(id, { expenseId: expRef.id })
      }
    } else if (prev.expenseId && payload.cashPaid <= 0) {
      // Now fully paid with points — no real money left to book.
      await expenseWriters.remove(prev.expenseId)
      await orders.update(id, { expenseId: null })
    } else if (!prev.expenseId && payload.cashPaid > 0) {
      const expRef = await expenseWriters.add({
        amount: payload.cashPaid,
        category: 'Shopping',
        country: 'JP',
        paymentMethod: payload.paymentMethod || 'Cash',
        store: payload.store || '',
        note: mirrorNote(payload),
        date: payload.date,
        orderId: id,
      })
      await orders.update(id, { expenseId: expRef.id })
    }
  }

  const removeOrderSynced = async (id) => {
    const order = orders.data.find((o) => o.id === id)
    const ops = [{ op: 'delete', name: 'onlineOrders', id }]
    if (order?.expenseId) ops.push({ op: 'delete', name: 'expenses', id: order.expenseId })
    if (order?.refundIncomeId) ops.push({ op: 'delete', name: 'income', id: order.refundIncomeId })
    await batchOps(ops) // atomic: order + both mirrors leave together
  }

  const refundIncomeData = (order, amount, refundTo, date) => ({
    amount,
    source: 'Refund',
    gross: null,
    net: null,
    note: `${mirrorNote(order)} — refund`,
    account: refundTo || null,
    country: 'JP',
    date,
    orderId: order.id,
  })

  // Return: the money part becomes income only once it has ACTUALLY landed
  // (Temu/Shein refunds take days) — until then it sits as "pending", owed
  // to you but not counted. Points refunds are instant and recorded only.
  const recordReturn = async (order, { refundMoney, refundPoints, refundTo, refundDate, received }) => {
    const bookNow = refundMoney > 0 && received
    // Atomic: refund income (when the money already landed) and the order's
    // return state flip in one commit.
    await batchOps([
      ...(bookNow
        ? [{ op: 'set', name: 'income', data: refundIncomeData(order, refundMoney, refundTo, refundDate) }]
        : []),
      {
        op: 'update',
        name: 'onlineOrders',
        id: order.id,
        data: (ids) => ({
          status: 'returned',
          refundMoney,
          refundPoints,
          refundTo: refundTo || null,
          refundDate,
          refundStatus: refundMoney > 0 ? (received ? 'received' : 'pending') : null,
          refundIncomeId: bookNow ? ids[0] : order.refundIncomeId || null,
        }),
      },
    ])
    toast(
      refundMoney <= 0
        ? '↩ Return saved · refunded as points'
        : received
          ? `↩ Return saved · ${formatJPY(refundMoney)} refund booked as income`
          : `↩ Return saved · ${formatJPY(refundMoney)} refund pending — mark it when it lands`
    )
  }

  // The store finally paid up — book the waiting refund as real income.
  const markRefundReceived = async (order) => {
    await batchOps([
      { op: 'set', name: 'income', data: refundIncomeData(order, order.refundMoney, order.refundTo, new Date()) },
      {
        op: 'update',
        name: 'onlineOrders',
        id: order.id,
        data: (ids) => ({ refundStatus: 'received', refundIncomeId: ids[0] }),
      },
    ])
    toast(`💰 ${formatJPY(order.refundMoney)} refund received${order.refundTo ? ` into ${order.refundTo}` : ''}`)
  }

  const undoReturn = async (order) => {
    await batchOps([
      ...(order.refundIncomeId ? [{ op: 'delete', name: 'income', id: order.refundIncomeId }] : []),
      {
        op: 'update',
        name: 'onlineOrders',
        id: order.id,
        data: {
          status: 'ordered',
          refundMoney: null,
          refundPoints: null,
          refundTo: null,
          refundDate: null,
          refundStatus: null,
          refundIncomeId: null,
        },
      },
    ])
    toast('↩ Return undone — order is active again')
  }

  const { pendingIds, requestDelete } = useUndoableDelete(removeOrderSynced, 'Order')
  const visible = useMemo(
    () => orders.data.filter((o) => !pendingIds.has(o.id)),
    [orders.data, pendingIds]
  )
  const sorted = useMemo(
    () => [...visible].sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0)),
    [visible]
  )

  // Per-store rollup: net real money (cash paid − refunds RECEIVED — a
  // pending refund is still your money out there) + points used.
  const storeStats = useMemo(() => {
    const map = {}
    for (const o of visible) {
      const key = o.store || 'Other'
      if (!map[key]) map[key] = { store: key, cash: 0, refunds: 0, pending: 0, points: 0, count: 0 }
      map[key].cash += o.cashPaid || 0
      map[key].points += o.points || 0
      map[key].count += 1
      if (o.status === 'returned') {
        if (o.refundStatus === 'pending') map[key].pending += o.refundMoney || 0
        else map[key].refunds += o.refundMoney || 0
      }
    }
    return Object.values(map).sort((a, b) => b.cash - b.refunds - (a.cash - a.refunds))
  }, [visible])

  const pendingRefundTotal = useMemo(
    () => visible.reduce((s, o) => s + (o.status === 'returned' && o.refundStatus === 'pending' ? o.refundMoney || 0 : 0), 0),
    [visible]
  )

  // This month's real-money spend (cash parts, net of received refunds) —
  // measured against the optional monthly cap from settings.
  const budget = settings?.shoppingBudget || 0
  const monthNet = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    let net = 0
    for (const o of visible) {
      const d = toDate(o.date)
      if (!d || d < monthStart) continue
      net += o.cashPaid || 0
      if (o.status === 'returned' && o.refundStatus !== 'pending') net -= o.refundMoney || 0
    }
    return net
  }, [visible])

  // Points wallet per store: logged earnings − points spent on orders
  // + points handed back by returns. Points are store-money, never yen.
  const pointsBalances = useMemo(() => {
    const map = {}
    const bump = (store, delta) => {
      const key = store || 'Other'
      map[key] = (map[key] || 0) + delta
    }
    for (const p of pointsLog.data) bump(p.store, p.amount || 0)
    for (const o of visible) {
      bump(o.store, -(o.points || 0))
      if (o.status === 'returned') bump(o.store, o.refundPoints || 0)
    }
    return map
  }, [pointsLog.data, visible])

  if (orders.loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-16 lg:mx-auto lg:max-w-2xl lg:pb-0">
      <div className="card p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">🛍 Online shopping</h2>
          <button
            type="button"
            onClick={() => setShowBudgetSheet(true)}
            className="text-xs font-medium text-indigo-600 dark:text-indigo-400"
          >
            {budget > 0 ? 'Edit cap' : '+ Set monthly cap'}
          </button>
        </div>
        {budget > 0 ? (
          <div className="space-y-1">
            <div className="flex items-baseline justify-between text-xs">
              <span
                className={`font-semibold tabular-nums ${
                  monthNet > budget
                    ? 'text-red-500 dark:text-red-400'
                    : monthNet > budget * 0.8
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-gray-900 dark:text-gray-100'
                }`}
              >
                {formatJPY(monthNet)}
              </span>
              <span className="text-gray-500 dark:text-gray-400">of {formatJPY(budget)} this month</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-neutral-800">
              <div
                className={`h-full rounded-full transition-all ${
                  monthNet > budget ? 'bg-red-500' : monthNet > budget * 0.8 ? 'bg-amber-500' : 'bg-indigo-500'
                }`}
                style={{ width: `${Math.min(100, budget > 0 ? (monthNet / budget) * 100 : 0)}%` }}
              />
            </div>
            {monthNet > budget && (
              <p className="text-[11px] font-medium text-red-500 dark:text-red-400">
                {formatJPY(monthNet - budget)} over the cap — maybe let the cart sleep 😅
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Temu, Shein, Amazon & co. Cash parts count as real spending; points parts don't. Returns
            bring the money back as income.
          </p>
        )}
        {pendingRefundTotal > 0 && (
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
            ⏳ {formatJPY(pendingRefundTotal)} in refunds still on the way — tap ↩ on the order when
            it lands
          </p>
        )}
      </div>

      <PointsCard balances={pointsBalances} entries={pointsLog.data} onAdd={pointsLog.add} onDelete={pointsLog.remove} />

      {storeStats.length > 0 && (
        <div className="card p-4 space-y-2.5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">By store</h2>
          {storeStats.map((s) => {
            const net = s.cash - s.refunds
            return (
              <div key={s.store} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate font-medium text-gray-700 dark:text-gray-300">
                  {storeOf(s.store).emoji} {s.store}
                  <span className="font-normal text-gray-500 dark:text-gray-400">
                    {' '}· {s.count} order{s.count === 1 ? '' : 's'}
                    {s.points > 0 && ` · ${s.points.toLocaleString()} pts used`}
                    {s.refunds > 0 && ` · ${formatJPY(s.refunds)} refunded`}
                  </span>
                  {s.pending > 0 && (
                    <span className="font-medium text-amber-600 dark:text-amber-400">
                      {' '}· ⏳ {formatJPY(s.pending)} owed
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                  {formatJPY(net)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div className="space-y-2">
        {sorted.length === 0 && (
          <EmptyState
            icon="🛍"
            message="No orders yet — log your next Temu/Shein/Amazon buy"
            actionLabel="+ Add order"
            onAction={() => {
              setEditingOrder(null)
              setShowOrderSheet(true)
            }}
          />
        )}
        {sorted.map((o) => (
          <SwipeableRow
            key={o.id}
            onEdit={() => {
              setEditingOrder(o)
              setShowOrderSheet(true)
            }}
            onDelete={() => requestDelete(o.id)}
          >
            <OrderRow
              order={o}
              onReturn={() => setReturningOrder(o)}
              onEdit={() => {
                setEditingOrder(o)
                setShowOrderSheet(true)
              }}
              onDelete={() => requestDelete(o.id)}
            />
          </SwipeableRow>
        ))}
      </div>

      <FloatingActionButton
        label="Add order"
        onClick={() => {
          setEditingOrder(null)
          setShowOrderSheet(true)
        }}
      />

      {showOrderSheet && (
        <OrderSheet
          initial={editingOrder}
          onSave={async (payload) => {
            if (editingOrder?.id) await updateOrderSynced(editingOrder.id, payload)
            else await addOrderSynced(payload)
          }}
          onClose={() => {
            setShowOrderSheet(false)
            setEditingOrder(null)
          }}
        />
      )}
      {returningOrder && (
        <ReturnSheet
          order={returningOrder}
          onReturn={recordReturn}
          onUndo={undoReturn}
          onMarkReceived={markRefundReceived}
          onClose={() => setReturningOrder(null)}
        />
      )}
      {showBudgetSheet && (
        <BudgetSheet
          current={budget}
          onSave={async (value) => {
            await saveSettings({ shoppingBudget: value })
            toast(value > 0 ? `🎯 Monthly cap set: ${formatJPY(value)}` : 'Monthly cap removed')
          }}
          onClose={() => setShowBudgetSheet(false)}
        />
      )}
    </div>
  )
}

// Whole days until the return window closes; null when no window is set.
function returnDaysLeft(order) {
  const by = toDate(order.returnBy)
  if (!by) return null
  const today = new Date()
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((startOfDay(by) - startOfDay(today)) / 86400000)
}

function OrderRow({ order: o, onReturn, onEdit, onDelete }) {
  const store = storeOf(o.store)
  const returned = o.status === 'returned'
  const refundPending = returned && o.refundStatus === 'pending'
  const daysLeft = returned ? null : returnDaysLeft(o)
  return (
    <div className="card p-3 pl-4 flex items-center gap-3 animate-[toast-in_0.15s_ease-out]">
      <span className="icon-tile">
        <ShoppingBag size={15} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
          {o.item} <span className="font-normal text-gray-500 dark:text-gray-400">· {store.emoji} {o.store}</span>
        </p>
        <p className="text-xs text-gray-500 truncate dark:text-gray-400">
          {toDate(o.date)?.toLocaleDateString()}
          {(o.cashPaid || 0) > 0 && ` · ${formatJPY(o.cashPaid)} ${o.paymentMethod ? `by ${o.paymentMethod}` : ''}`}
          {(o.points || 0) > 0 && ` · ${o.points.toLocaleString()} pts`}
          {o.note && ` · ${o.note}`}
        </p>
        {returned &&
          (refundPending ? (
            <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
              ↩ Returned · ⏳ {formatJPY(o.refundMoney)} refund on the way — tap ↩ when it lands
            </p>
          ) : (
            <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
              ↩ Returned
              {(o.refundMoney || 0) > 0 && ` · ${formatJPY(o.refundMoney)} refunded${o.refundTo ? ` to ${o.refundTo}` : ''}`}
              {(o.refundPoints || 0) > 0 && ` · ${o.refundPoints.toLocaleString()} pts back`}
            </p>
          ))}
        {daysLeft != null &&
          (daysLeft < 0 ? (
            <p className="text-[11px] text-gray-400 dark:text-gray-500">return window closed</p>
          ) : daysLeft <= 5 ? (
            <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
              ⏰ {daysLeft === 0 ? 'Last day to return!' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left to return`}
            </p>
          ) : (
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              return by {toDate(o.returnBy)?.toLocaleDateString()}
            </p>
          ))}
      </div>
      <span className="shrink-0 text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100">
        {formatJPY(o.total || 0)}
      </span>
      <div className="flex shrink-0 gap-0.5">
        <button
          type="button"
          onClick={onReturn}
          aria-label={returned ? 'View return' : 'Record return'}
          className={`flex h-11 w-11 items-center justify-center rounded-full transition-all active:scale-90 touch-manipulation ${
            returned
              ? 'text-emerald-500 dark:text-emerald-400'
              : 'text-gray-400 hover:text-amber-600 dark:text-gray-500 dark:hover:text-amber-400'
          }`}
        >
          <RotateCcw size={15} />
        </button>
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit order"
          className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 transition-all hover:text-indigo-600 active:scale-90 touch-manipulation dark:text-gray-500 dark:hover:text-indigo-400"
        >
          <Pencil size={15} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete order"
          className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 transition-all hover:text-red-500 active:scale-90 touch-manipulation dark:text-gray-500 dark:hover:text-red-400"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  )
}

// One order: total price, how much of it points covered, and how the cash
// part was paid. Cash part = total − points, computed live.
function OrderSheet({ initial, onSave, onClose }) {
  const { toast } = useToast()
  const { settings } = useSettings()
  const accounts = settings?.accounts || []
  // Every order this page writes is stored as country 'JP', so offering a
  // rupee account or UPI could only ever produce a record that contradicts
  // itself — yen spending taken out of an Indian balance.
  const methods = paymentMethodsFor(accounts, 'JP')

  const [store, setStore] = useState(initial?.store ?? 'Temu')
  const [item, setItem] = useState(initial?.item ?? '')
  const [total, setTotal] = useState(initial?.total ?? '')
  const [points, setPoints] = useState(initial?.points || '')
  const [paymentMethod, setPaymentMethod] = useState(initial?.paymentMethod ?? null)
  const [date, setDate] = useState(toDateInputValue(initial?.date))
  const [returnBy, setReturnBy] = useState(initial?.returnBy ? toDateInputValue(initial.returnBy) : '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const totalNum = parseFloat(total) || 0
  const pointsNum = parseFloat(points) || 0
  const cashPaid = Math.max(0, totalNum - pointsNum)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!item.trim() || totalNum <= 0) {
      setError('Item and total price are required.')
      return
    }
    if (pointsNum > totalNum) {
      setError('Points can’t cover more than the total.')
      return
    }
    if (cashPaid > 0 && !paymentMethod) {
      setError('How did you pay the cash part? Pick a method.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave({
        store,
        item: item.trim(),
        total: totalNum,
        points: pointsNum,
        cashPaid,
        paymentMethod: cashPaid > 0 ? paymentMethod : null,
        date: parseDateInput(date),
        returnBy: returnBy ? parseDateInput(returnBy) : null,
        note: note.trim(),
        status: initial?.status ?? 'ordered',
      })
      toast(`✓ ${item.trim()} saved`)
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  return (
    <BottomSheet as="form" onSubmit={handleSubmit} onClose={onClose} title={initial ? 'Edit order' : 'New online order'}>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
        <p>Store</p>
        <div className="flex flex-wrap gap-2">
          {STORES.map((s) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setStore(s.name)}
              className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
                store === s.name
                  ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                  : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
              }`}
            >
              {s.emoji} {s.name}
            </button>
          ))}
        </div>
      </div>

      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        What did you order?
        <input
          value={item}
          onChange={(e) => setItem(e.target.value)}
          placeholder="e.g. Phone case, summer dress"
          required
          className="input"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Total price (¥)
          <input type="number" step="any" required value={total} onChange={(e) => setTotal(e.target.value)} className="input" />
        </label>
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Paid with points (blank = none)
          <input type="number" step="any" min="0" value={points} onChange={(e) => setPoints(e.target.value)} className="input" />
        </label>
      </div>

      {totalNum > 0 && (
        <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
          Real money: {formatJPY(cashPaid)}
          {pointsNum > 0 && ` · points cover ${pointsNum.toLocaleString()}`}
          {cashPaid === 0 && ' — fully covered by points, nothing hits your spending 🎉'}
        </p>
      )}

      {cashPaid > 0 && (
        <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
          <p>How did you pay the cash part?</p>
          <div className="flex flex-wrap gap-2">
            {methods.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPaymentMethod(m)}
                className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
                  paymentMethod === m
                    ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                    : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Order date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </label>
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
        </label>
      </div>

      {/* Return window: the app warns before it quietly expires. */}
      <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
        <p>Return window (optional — get a heads-up before it closes)</p>
        <div className="flex flex-wrap items-center gap-2">
          {[
            { label: 'None', days: null },
            { label: '14 days', days: 14 },
            { label: '30 days', days: 30 },
          ].map(({ label, days }) => {
            const value = days
              ? (() => {
                  const base = parseDateInput(date)
                  base.setDate(base.getDate() + days)
                  return toDateInputValue(base)
                })()
              : ''
            return (
              <button
                key={label}
                type="button"
                onClick={() => setReturnBy(value)}
                className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
                  returnBy === value
                    ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                    : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
                }`}
              >
                {label}
              </button>
            )
          })}
          <input
            type="date"
            value={returnBy}
            onChange={(e) => setReturnBy(e.target.value)}
            className="input !w-auto flex-1"
            aria-label="Return by date"
          />
        </div>
      </div>

      <button type="submit" disabled={saving} className="btn-primary w-full py-3 text-sm">
        {saving ? 'Saving…' : 'Save order'}
      </button>
    </BottomSheet>
  )
}

// Return & refund: money comes back (booked as income once it actually
// lands, optionally into a specific account) and/or points come back
// (recorded only). Store refunds take days — "pending" covers the gap.
function ReturnSheet({ order, onReturn, onUndo, onMarkReceived, onClose }) {
  const { settings } = useSettings()
  const accounts = settings?.accounts || []
  const alreadyReturned = order.status === 'returned'

  const [refundMoney, setRefundMoney] = useState(String(order.refundMoney ?? order.cashPaid ?? 0))
  const [refundPoints, setRefundPoints] = useState(String(order.refundPoints ?? order.points ?? 0))
  const [refundTo, setRefundTo] = useState(
    order.refundTo ?? (accounts.some((a) => a.label === order.paymentMethod) ? order.paymentMethod : 'Cash')
  )
  const [received, setReceived] = useState(false)
  // Shein/Temu: "keep it, we'll refund you anyway" — money back AND the goods.
  const [keptItem, setKeptItem] = useState(order.keptItem ?? false)
  const [date, setDate] = useState(toDateInputValue(order.refundDate))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const moneyNum = parseFloat(refundMoney) || 0
  const pointsNum = parseFloat(refundPoints) || 0

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (moneyNum <= 0 && pointsNum <= 0) {
      setError('Enter what came back — money, points, or both.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onReturn(order, {
        refundMoney: moneyNum,
        refundPoints: pointsNum,
        keptItem,
        refundTo: moneyNum > 0 && refundTo !== 'Cash' ? refundTo : null,
        refundDate: parseDateInput(date),
        received,
      })
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  if (alreadyReturned) {
    const pending = order.refundStatus === 'pending'
    return (
      <BottomSheet onClose={onClose} title={`${order.item} — returned`}>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Returned on {toDate(order.refundDate)?.toLocaleDateString()}
          {(order.refundMoney || 0) > 0 &&
            (pending
              ? ` · ⏳ ${formatJPY(order.refundMoney)} refund still on the way${order.refundTo ? ` (to ${order.refundTo})` : ''}`
              : ` · ${formatJPY(order.refundMoney)} refunded${order.refundTo ? ` to ${order.refundTo}` : ''} (booked as income)`)}
          {(order.refundPoints || 0) > 0 && ` · ${order.refundPoints.toLocaleString()} pts back`}
        </p>
        {pending && (
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              try {
                await onMarkReceived(order)
                onClose()
              } finally {
                setSaving(false)
              }
            }}
            className="btn-primary w-full py-3 text-sm"
          >
            {saving ? 'Booking…' : `💰 Refund landed — book ${formatJPY(order.refundMoney)} now`}
          </button>
        )}
        <button
          type="button"
          onClick={async () => {
            await onUndo(order)
            onClose()
          }}
          className="btn-ghost w-full py-2.5 text-sm"
        >
          ↩ Undo this return{pending ? '' : ' (removes the refund income too)'}
        </button>
      </BottomSheet>
    )
  }

  return (
    <BottomSheet as="form" onSubmit={handleSubmit} onClose={onClose} title={`Return ${order.item}`}>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        You paid {formatJPY(order.cashPaid || 0)}
        {(order.points || 0) > 0 && ` + ${order.points.toLocaleString()} pts`}. Enter what actually
        came back — partial refunds are fine.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Money refunded (¥)
          <input type="number" step="any" min="0" value={refundMoney} onChange={(e) => setRefundMoney(e.target.value)} className="input" />
        </label>
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Points refunded
          <input type="number" step="any" min="0" value={refundPoints} onChange={(e) => setRefundPoints(e.target.value)} className="input" />
        </label>
      </div>

      {moneyNum > 0 && (
        <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
          <p>Refund goes to (that balance goes up)</p>
          <div className="flex flex-wrap gap-2">
            {fundingSources(accounts, 'JP').map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => setRefundTo(label)}
                className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
                  refundTo === label
                    ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                    : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        Refund date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
      </label>

      {/* The seller refunded you but didn't want the item back. You end up with
          the money AND the goods, so the whole refund is gain — not a wash. */}
      <label className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-200">
        <input
          type="checkbox"
          checked={keptItem}
          onChange={(e) => setKeptItem(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 rounded accent-emerald-600"
        />
        <span>
          📦 They told me to keep the item
          <span className="block text-xs text-gray-500 dark:text-gray-400">
            Refunded without sending it back — the full {formatJPY(moneyNum)} counts as profit
            instead of just covering what you paid.
          </span>
        </span>
      </label>

      {moneyNum > 0 && (
        <label className="flex items-center gap-2.5 text-xs text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={received}
            onChange={(e) => setReceived(e.target.checked)}
            className="h-4 w-4 accent-indigo-600"
          />
          💴 Money is already back — book it as income now (unticked = still waiting)
        </label>
      )}

      <button type="submit" disabled={saving} className="btn-primary w-full py-3 text-sm">
        {saving ? 'Saving…' : 'Save return'}
      </button>
    </BottomSheet>
  )
}

// Points wallet: store points are store-money, not yen — tracked separately
// so they never inflate real spending. Balance = logged earnings − points
// spent on orders + points handed back by returns.
function PointsCard({ balances, entries, onAdd, onDelete }) {
  const { toast } = useToast()
  const [showAdd, setShowAdd] = useState(false)
  const active = STORES.filter((s) => (balances[s.name] || 0) !== 0 || entries.some((e) => e.store === s.name))
  const recent = [...entries]
    .sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0))
    .slice(0, 6)

  return (
    <div className="card p-4 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">⭐ Points</h2>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="text-xs font-medium text-indigo-600 dark:text-indigo-400"
        >
          + Points earned
        </button>
      </div>

      {active.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Got points from a promo or credit? Log them here — spending points on an order deducts
          them automatically.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {active.map((s) => {
            const bal = balances[s.name] || 0
            return (
              <span
                key={s.name}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold tabular-nums ${
                  bal < 0
                    ? 'border-amber-300 text-amber-600 dark:border-amber-500/40 dark:text-amber-400'
                    : 'border-gray-200 bg-gray-100/80 text-gray-800 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-200'
                }`}
              >
                {s.emoji} {s.name} · {bal.toLocaleString()} pts
              </span>
            )
          })}
        </div>
      )}
      {active.some((s) => (balances[s.name] || 0) < 0) && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          A negative balance means points were spent that were never logged as earned — add the
          missing "+ Points earned" entry to true it up.
        </p>
      )}

      {recent.length > 0 && (
        <div className="space-y-1 border-t border-gray-200 pt-2 dark:border-white/10">
          {recent.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-300">
              <span className="min-w-0 truncate">
                {toDate(p.date)?.toLocaleDateString()} · {storeOf(p.store).emoji} {p.store}
                {p.note && <span className="text-gray-500 dark:text-gray-400"> · {p.note}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  +{(p.amount || 0).toLocaleString()} pts
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await onDelete(p.id)
                    toast('🗑 Points entry removed')
                  }}
                  aria-label="Delete points entry"
                  className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 transition-all hover:text-red-500 active:scale-90 touch-manipulation dark:text-gray-500 dark:hover:text-red-400"
                >
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {showAdd && <PointsSheet onAdd={onAdd} onClose={() => setShowAdd(false)} />}
    </div>
  )
}

function PointsSheet({ onAdd, onClose }) {
  const { toast } = useToast()
  const [store, setStore] = useState('Temu')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(toDateInputValue())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    const amountNum = parseFloat(amount) || 0
    if (amountNum <= 0) {
      setError('Enter how many points you got.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onAdd({ store, amount: amountNum, date: parseDateInput(date), note: note.trim() })
      toast(`⭐ ${amountNum.toLocaleString()} ${store} points added`)
      onClose()
    } catch {
      setError('Could not save. Try again.')
      setSaving(false)
    }
  }

  return (
    <BottomSheet as="form" onSubmit={handleSubmit} onClose={onClose} title="Points earned">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {STORES.map((s) => (
          <button
            key={s.name}
            type="button"
            onClick={() => setStore(s.name)}
            className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
              store === s.name
                ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
            }`}
          >
            {s.emoji} {s.name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Points
          <input type="number" step="any" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
        </label>
        <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </label>
      </div>
      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        Note (optional — e.g. signup promo, review bonus)
        <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
      </label>
      <button type="submit" disabled={saving} className="btn-primary w-full py-3 text-sm">
        {saving ? 'Saving…' : 'Add points'}
      </button>
    </BottomSheet>
  )
}

// Soft monthly cap on real-money shopping spend. 0 / empty = no cap.
function BudgetSheet({ current, onSave, onClose }) {
  const [value, setValue] = useState(current > 0 ? String(current) : '')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave(Math.max(0, parseFloat(value) || 0))
      onClose()
    } catch {
      setSaving(false)
    }
  }

  return (
    <BottomSheet as="form" onSubmit={handleSubmit} onClose={onClose} title="Monthly shopping cap">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        A soft limit on real-money online spending per month (points don't count). The card turns
        amber at 80% and red when you're over — it never blocks anything.
      </p>
      <div className="flex flex-wrap gap-2">
        {[5000, 10000, 15000, 20000].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setValue(String(v))}
            className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 touch-manipulation ${
              parseFloat(value) === v
                ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                : 'border border-gray-200 bg-gray-100/80 text-gray-700 dark:border-transparent dark:bg-neutral-800/50 dark:text-gray-300'
            }`}
          >
            {formatJPY(v)}
          </button>
        ))}
      </div>
      <label className="block text-xs text-gray-500 space-y-1 dark:text-gray-400">
        Cap (¥) — leave empty to remove
        <input type="number" step="any" min="0" value={value} onChange={(e) => setValue(e.target.value)} className="input" />
      </label>
      <button type="submit" disabled={saving} className="btn-primary w-full py-3 text-sm">
        {saving ? 'Saving…' : value && parseFloat(value) > 0 ? `Set cap to ${formatJPY(parseFloat(value) || 0)}` : 'Remove cap'}
      </button>
    </BottomSheet>
  )
}
