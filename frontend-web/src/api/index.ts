import { http } from './client'
import type {
  ActivityEntry,
  Category,
  FileImportPreviewResponse,
  FileImportRow,
  FileImportCommitResponse,
  PriceLog,
  ProbeResponse,
  ScrapeResult,
  ScrapeSelectorMap,
  SelectorLabResponse,
  SelectorLabSaveResponse,
  Settings,
  Store,
  WooCredentials,
  WooProductPreview,
} from './types'

export { productsApi } from './products'
export type { QuickAddResponse, QuickAddResult } from './products'
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
  selectorLab: async (body: {
    url: string
    use_playwright?: boolean
    wait_for?: string | null
    wait_timeout?: number
  }): Promise<SelectorLabResponse> => {
    const { data } = await http.post<SelectorLabResponse>(
      '/scraper/selector-lab',
      body,
    )
    return data
  },
  testSelectorLab: async (body: {
    url: string
    use_playwright?: boolean
    wait_for?: string | null
    wait_timeout?: number
    platform?: string | null
    selectors: ScrapeSelectorMap
  }): Promise<ScrapeResult> => {
    const { data } = await http.post<ScrapeResult>(
      '/scraper/selector-lab/test',
      body,
    )
    return data
  },
  saveSelectorProfile: async (body: {
    url?: string
    store_id?: number | null
    hostname?: string | null
    platform?: string | null
    wait_for?: string | null
    selectors: ScrapeSelectorMap
  }): Promise<SelectorLabSaveResponse> => {
    const { data } = await http.put<SelectorLabSaveResponse>(
      '/scraper/selector-lab/profile',
      body,
    )
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
  getSitesConfig: async (): Promise<SitesConfigResponse> => {
    const { data } = await http.get<SitesConfigResponse>('/scraper/sites-config')
    return data
  },
  putSitesConfig: async (content: string): Promise<SitesConfigResponse> => {
    const { data } = await http.put<SitesConfigResponse>('/scraper/sites-config', {
      content,
    })
    return data
  },
}

export interface SitesConfigResponse {
  content: string
  path: string
  hostnames: string[]
}

export const importApi = {
  wooPreview: async (body: {
    credentials: WooCredentials
    per_page?: number
    page?: number
    fetch_all?: boolean
  }): Promise<WooProductPreview[]> => {
    const { data } = await http.post<WooProductPreview[]>(
      '/import/woo/preview',
      body,
    )
    return data
  },
  wooImport: async (body: {
    credentials: WooCredentials
    store_id: number
    product_ids: number[]
  }): Promise<{ imported: number }> => {
    const { data } = await http.post('/import/woo/import', body)
    return data
  },
  filePreview: async (file: File): Promise<FileImportPreviewResponse> => {
    const form = new FormData()
    form.append('file', file)
    const { data } = await http.post<FileImportPreviewResponse>(
      '/import/file/preview',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
    return data
  },
  fileCommit: async (body: {
    rows: FileImportRow[]
    store_id: number
    category_id?: number | null
  }): Promise<FileImportCommitResponse> => {
    const { data } = await http.post<FileImportCommitResponse>(
      '/import/file/commit',
      body,
    )
    return data
  },
}
