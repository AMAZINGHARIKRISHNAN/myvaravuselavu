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

// One route, wrapped so a failure inside it stays inside it.
//
// A single boundary at the root meant one screen throwing took the navigation
// down with it — the app was a blank error page you could not leave, on a
// device where the only way out is force-quitting. Per route, the tabs and the
// header survive and every other screen still works.
//
// `key` is what makes leaving possible: React keeps a boundary's error state
// until the subtree remounts, so without it a crashed route would stay crashed
// even after navigating away and back.
function Page({ name, children }) {
  return (
    <ErrorBoundary key={name} label={name}>
      <Suspense fallback={<PageLoading />}>{children}</Suspense>
    </ErrorBoundary>
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
                  <Route path="/" element={<Page name="Dashboard"><Dashboard /></Page>} />
                  {/* One Suspense boundary per lazy page keeps the shell (tabs,
                      header) mounted while only the content area shimmers. */}
                  <Route path="/charts" element={<Page name="Charts"><Charts /></Page>} />
                  <Route path="/transfers" element={<Page name="Transfers"><Transfers /></Page>} />
                  <Route path="/friends" element={<Page name="Friends"><Friends /></Page>} />
                  <Route path="/groups" element={<Page name="Groups"><Groups /></Page>} />
                  <Route path="/commute" element={<Page name="Commute"><Commute /></Page>} />
                  <Route path="/balances" element={<Page name="Balances"><Balances /></Page>} />
                  <Route path="/cash" element={<Page name="Cash"><Cash /></Page>} />
                  <Route path="/reimbursements" element={<Page name="Reimbursements"><Reimbursements /></Page>} />
                  <Route path="/profit" element={<Page name="Profit"><Profit /></Page>} />
                  <Route path="/shopping" element={<Page name="Shopping"><Shopping /></Page>} />
                  <Route path="/notes" element={<Page name="Notes"><Notes /></Page>} />
                  <Route path="/review" element={<Page name="Review"><Review /></Page>} />
                  <Route path="/audit" element={<Page name="Audit"><Audit /></Page>} />
                  <Route path="/reconcile" element={<Page name="Reconcile"><Reconcile /></Page>} />
                  <Route path="/history" element={<Page name="History"><History /></Page>} />
                  <Route path="/payslips" element={<Page name="Payslips"><Payslips /></Page>} />
                  <Route path="/settings" element={<Page name="Settings"><Settings /></Page>} />
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
