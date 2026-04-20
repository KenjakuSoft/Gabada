import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from '@/components/layout/Shell'
import { Toaster } from '@/components/ui/toaster'
import { useApplyTheme } from '@/store/theme'
import { HomePage } from '@/pages/HomePage'
import { CategoriesPage } from '@/pages/CategoriesPage'
import { ProductDetailPage } from '@/pages/ProductDetailPage'
import { AddProductPage } from '@/pages/AddProductPage'
import { StoresPage } from '@/pages/StoresPage'
import { ImportPage } from '@/pages/ImportPage'
import { ProbePage } from '@/pages/ProbePage'
import { SelectorLabPage } from '@/pages/SelectorLabPage'
import { ActivityPage } from '@/pages/ActivityPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

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
        <Route index element={<HomePage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="product/:id" element={<ProductDetailPage />} />
        <Route path="add" element={<AddProductPage />} />
        <Route path="stores" element={<StoresPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="probe" element={<ProbePage />} />
        <Route path="selector-lab" element={<SelectorLabPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="404" element={<NotFoundPage />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Route>
    </Routes>
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
