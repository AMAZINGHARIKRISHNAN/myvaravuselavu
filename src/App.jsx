import { lazy, Suspense } from 'react'
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
import Transfers from './pages/Transfers'
import Settings from './pages/Settings'
import History from './pages/History'
import Skeleton from './components/ui/Skeleton'

const Charts = lazy(() => import('./pages/Charts'))

function ChartsLoading() {
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
                  <Route
                    path="/charts"
                    element={
                      <Suspense fallback={<ChartsLoading />}>
                        <Charts />
                      </Suspense>
                    }
                  />
                  <Route path="/transfers" element={<Transfers />} />
                  <Route path="/history" element={<History />} />
                  <Route path="/settings" element={<Settings />} />
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
