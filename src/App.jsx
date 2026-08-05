import { Suspense } from 'react'
import { lazyWithRetry } from './lib/lazyWithRetry'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { ToastProvider } from './context/ToastContext'
import RequireAuth from './components/layout/RequireAuth'
import PinGate from './components/layout/PinGate'
import ErrorBoundary from './components/layout/ErrorBoundary'
import Layout from './components/layout/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Skeleton from './components/ui/Skeleton'
import { useDelayedShow } from './hooks/useDelayedShow'

// Code-splitting: only Dashboard (the landing screen) ships in the main
// bundle. Every other page loads on first visit — Charts especially matters
// since it pulls in the whole Recharts library.
const Charts = lazyWithRetry(() => import('./pages/Charts'))
const Transfers = lazyWithRetry(() => import('./pages/Transfers'))
const Friends = lazyWithRetry(() => import('./pages/Friends'))
const Groups = lazyWithRetry(() => import('./pages/Groups'))
const Commute = lazyWithRetry(() => import('./pages/Commute'))
const Balances = lazyWithRetry(() => import('./pages/Balances'))
const Cash = lazyWithRetry(() => import('./pages/Cash'))
const Reimbursements = lazyWithRetry(() => import('./pages/Reimbursements'))
const Profit = lazyWithRetry(() => import('./pages/Profit'))
const Shopping = lazyWithRetry(() => import('./pages/Shopping'))
const Notes = lazyWithRetry(() => import('./pages/Notes'))
const Review = lazyWithRetry(() => import('./pages/Review'))
const Audit = lazyWithRetry(() => import('./pages/Audit'))
const Reconcile = lazyWithRetry(() => import('./pages/Reconcile'))
const History = lazyWithRetry(() => import('./pages/History'))
const Settings = lazyWithRetry(() => import('./pages/Settings'))
const Payslips = lazyWithRetry(() => import('./pages/Payslips'))

// Shimmer for a lazy page chunk — but only when the chunk is actually slow.
// Once the service worker has it, the import resolves in a few milliseconds and
// a skeleton that appears and vanishes reads as a glitch, so nothing renders
// for the first 300ms.
function PageLoading() {
  const show = useDelayedShow(300)
  if (!show) return null
  return (
    <div className="space-y-4">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <BrowserRouter>
            <AuthProvider>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route
                  element={
                    <RequireAuth>
                      <PinGate>
                        <Layout />
                      </PinGate>
                    </RequireAuth>
                  }
                >
                  <Route path="/" element={<Dashboard />} />
                  {/* One Suspense boundary per lazy page keeps the shell (tabs,
                      header) mounted while only the content area shimmers. */}
                  <Route path="/charts" element={<Suspense fallback={<PageLoading />}><Charts /></Suspense>} />
                  <Route path="/transfers" element={<Suspense fallback={<PageLoading />}><Transfers /></Suspense>} />
                  <Route path="/friends" element={<Suspense fallback={<PageLoading />}><Friends /></Suspense>} />
                  <Route path="/groups" element={<Suspense fallback={<PageLoading />}><Groups /></Suspense>} />
                  <Route path="/commute" element={<Suspense fallback={<PageLoading />}><Commute /></Suspense>} />
                  <Route path="/balances" element={<Suspense fallback={<PageLoading />}><Balances /></Suspense>} />
                  <Route path="/cash" element={<Suspense fallback={<PageLoading />}><Cash /></Suspense>} />
                  <Route path="/reimbursements" element={<Suspense fallback={<PageLoading />}><Reimbursements /></Suspense>} />
                  <Route path="/profit" element={<Suspense fallback={<PageLoading />}><Profit /></Suspense>} />
                  <Route path="/shopping" element={<Suspense fallback={<PageLoading />}><Shopping /></Suspense>} />
                  <Route path="/notes" element={<Suspense fallback={<PageLoading />}><Notes /></Suspense>} />
                  <Route path="/review" element={<Suspense fallback={<PageLoading />}><Review /></Suspense>} />
                  <Route path="/audit" element={<Suspense fallback={<PageLoading />}><Audit /></Suspense>} />
                  <Route path="/reconcile" element={<Suspense fallback={<PageLoading />}><Reconcile /></Suspense>} />
                  <Route path="/history" element={<Suspense fallback={<PageLoading />}><History /></Suspense>} />
                  <Route path="/payslips" element={<Suspense fallback={<PageLoading />}><Payslips /></Suspense>} />
                  <Route path="/settings" element={<Suspense fallback={<PageLoading />}><Settings /></Suspense>} />
                </Route>
              </Routes>
            </AuthProvider>
          </BrowserRouter>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
