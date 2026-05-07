import { lazy, Suspense, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from '@/components/layout/Shell'
import { Toaster } from '@/components/ui/toaster'
import { useApplyTheme } from '@/store/theme'

const HomePage = lazy(() =>
  import('@/pages/HomePage').then((module) => ({ default: module.HomePage })),
)
const CategoriesPage = lazy(() =>
  import('@/pages/CategoriesPage').then((module) => ({
    default: module.CategoriesPage,
  })),
)
const ProductDetailPage = lazy(() =>
  import('@/pages/ProductDetailPage').then((module) => ({
    default: module.ProductDetailPage,
  })),
)
const AddProductPage = lazy(() =>
  import('@/pages/AddProductPage').then((module) => ({
    default: module.AddProductPage,
  })),
)
const StoresPage = lazy(() =>
  import('@/pages/StoresPage').then((module) => ({ default: module.StoresPage })),
)
const ImportPage = lazy(() =>
  import('@/pages/ImportPage').then((module) => ({ default: module.ImportPage })),
)
const ProbePage = lazy(() =>
  import('@/pages/ProbePage').then((module) => ({ default: module.ProbePage })),
)
const SelectorLabPage = lazy(() =>
  import('@/pages/SelectorLabPage').then((module) => ({
    default: module.SelectorLabPage,
  })),
)
const ActivityPage = lazy(() =>
  import('@/pages/ActivityPage').then((module) => ({
    default: module.ActivityPage,
  })),
)
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((module) => ({
    default: module.SettingsPage,
  })),
)
const NotFoundPage = lazy(() =>
  import('@/pages/NotFoundPage').then((module) => ({
    default: module.NotFoundPage,
  })),
)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
})

function ThemedApp() {
  useApplyTheme()
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<PageRoute><HomePage /></PageRoute>} />
        <Route path="categories" element={<PageRoute><CategoriesPage /></PageRoute>} />
        <Route path="product/:id" element={<PageRoute><ProductDetailPage /></PageRoute>} />
        <Route path="add" element={<PageRoute><AddProductPage /></PageRoute>} />
        <Route path="stores" element={<PageRoute><StoresPage /></PageRoute>} />
        <Route path="import" element={<PageRoute><ImportPage /></PageRoute>} />
        <Route path="probe" element={<PageRoute><ProbePage /></PageRoute>} />
        <Route path="selector-lab" element={<PageRoute><SelectorLabPage /></PageRoute>} />
        <Route path="activity" element={<PageRoute><ActivityPage /></PageRoute>} />
        <Route path="settings" element={<PageRoute><SettingsPage /></PageRoute>} />
        <Route path="404" element={<PageRoute><NotFoundPage /></PageRoute>} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Route>
    </Routes>
  )
}

function PageRoute({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="h-32 rounded-md border border-border bg-card/50 gbd-skeleton" />
      }
    >
      {children}
    </Suspense>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemedApp />
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
