import { http } from './client'
import type {
  ActivityEntry,
  Category,
  PriceLog,
  ProbeResponse,
  Settings,
  Store,
} from './types'

export { productsApi } from './products'
export { http }
export type * from './types'

export const storesApi = {
  list: async (): Promise<Store[]> => {
    const { data } = await http.get<Store[]>('/stores/')
    return data
  },
  create: async (body: { name: string; base_url: string }): Promise<Store> => {
    const { data } = await http.post<Store>('/stores/', body)
    return data
  },
  remove: async (id: number): Promise<void> => {
    await http.delete(`/stores/${id}`)
  },
}

export const categoriesApi = {
  list: async (): Promise<Category[]> => {
    const { data } = await http.get<Category[]>('/categories/')
    return data
  },
  create: async (body: { name: string; color?: string }): Promise<Category> => {
    const { data } = await http.post<Category>('/categories/', body)
    return data
  },
  update: async (
    id: number,
    body: { name: string; color: string },
  ): Promise<Category> => {
    const { data } = await http.patch<Category>(`/categories/${id}`, body)
    return data
  },
  remove: async (id: number): Promise<void> => {
    await http.delete(`/categories/${id}`)
  },
}

export const logsApi = {
  forProduct: async (productId: number): Promise<PriceLog[]> => {
    const { data } = await http.get<PriceLog[]>(`/logs/product/${productId}`)
    return data
  },
  all: async (params?: {
    limit?: number
    offset?: number
  }): Promise<PriceLog[]> => {
    const { data } = await http.get<PriceLog[]>('/logs/', { params })
    return data
  },
}

export const activityApi = {
  list: async (limit = 50): Promise<ActivityEntry[]> => {
    const { data } = await http.get<ActivityEntry[]>('/activity/', {
      params: { limit },
    })
    return data
  },
}

export const settingsApi = {
  get: async (): Promise<Settings> => {
    const { data } = await http.get<Settings>('/settings/')
    return data
  },
  update: async (body: Partial<Settings>): Promise<Settings> => {
    const { data } = await http.put<Settings>('/settings/', body)
    return data
  },
  nextRun: async (): Promise<{ next_run_time: string | null }> => {
    const { data } = await http.get('/settings/schedule/next')
    return data
  },
}

export const scraperApi = {
  scrapeOne: async (productStoreId: number): Promise<{ status: string }> => {
    const { data } = await http.post(`/scraper/scrape/${productStoreId}`)
    return data
  },
  scrapeAll: async (): Promise<{ status: string }> => {
    const { data } = await http.post('/scraper/scrape-all')
    return data
  },
  probe: async (body: {
    url: string
    use_playwright?: boolean
    wait_for?: string | null
    wait_timeout?: number
  }): Promise<ProbeResponse> => {
    const { data } = await http.post<ProbeResponse>('/scraper/probe', body)
    return data
  },
  reprobe: async (
    productStoreId: number,
  ): Promise<{
    status: string
    platform: string
    wait_for: string | null
    selectors: Record<string, string | null>
    notes: string[]
  }> => {
    const { data } = await http.post(`/scraper/reprobe/${productStoreId}`)
    return data
  },
  loginSession: async (body: {
    url: string
    save_path: string
    headless?: boolean
    wait_seconds?: number
  }) => {
    const { data } = await http.post('/scraper/login-session', body)
    return data
  },
}
