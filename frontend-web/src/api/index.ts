import { http } from './client'
import type {
  ActivityEntry,
  ApiPlatform,
  ApiProductPreview,
  ApiSyncResult,
  BuyAreaPick,
  BuyAreaPicksResponse,
  BuyAreaPickTarget,
  Category,
  DatabaseImportResponse,
  DatabaseTransferInfo,
  DrivePushResponse,
  DriveRestoreResponse,
  DriveSnapshotList,
  DriveStatus,
  FileImportPreviewResponse,
  FileImportRow,
  FileImportCommitResponse,
  PriceLog,
  ScrapeAllResponse,
  ProbeResponse,
  ScrapeResult,
  ScrapeRunResponse,
  ScrapeSelectorMap,
  SelectorLabResponse,
  SelectorLabSaveResponse,
  Settings,
  Store,
  StoreCatalogClearResult,
  StoreLoginSessionResponse,
  UpdateCheckResponse,
  WooSyncResult,
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
  create: async (body: {
    name: string
    base_url?: string
    manual_only?: boolean
    login_url?: string | null
    woo_enabled?: boolean
    woo_site_url?: string | null
    woo_consumer_key?: string | null
    woo_consumer_secret?: string | null
    woo_auto_import_new?: boolean
    api_enabled?: boolean
    api_platform?: ApiPlatform | null
    api_base_url?: string | null
    api_key?: string | null
    api_config?: Record<string, unknown>
    api_auto_import_new?: boolean
  }): Promise<Store> => {
    const { data } = await http.post<Store>('/stores/', body)
    return data
  },
  update: async (
    id: number,
    body: {
      name?: string
      base_url?: string
      manual_only?: boolean
      login_url?: string | null
      storage_state_path?: string | null
      woo_enabled?: boolean
      woo_site_url?: string | null
      woo_consumer_key?: string | null
      woo_consumer_secret?: string | null
      woo_auto_import_new?: boolean
      api_enabled?: boolean
      api_platform?: ApiPlatform | null
      api_base_url?: string | null
      api_key?: string | null
      api_config?: Record<string, unknown>
      api_auto_import_new?: boolean
    },
  ): Promise<Store> => {
    const { data } = await http.patch<Store>(`/stores/${id}`, body)
    return data
  },
  syncWoo: async (id: number): Promise<WooSyncResult> => {
    const { data } = await http.post<WooSyncResult>(`/stores/${id}/woo-sync`, undefined, {
      timeout: 300_000,
    })
    return data
  },
  syncApi: async (id: number): Promise<ApiSyncResult> => {
    const { data } = await http.post<ApiSyncResult>(`/stores/${id}/api-sync`, undefined, {
      timeout: 300_000,
    })
    return data
  },
  captureLoginSession: async (
    id: number,
    body?: { wait_seconds?: number; headless?: boolean },
  ): Promise<StoreLoginSessionResponse> => {
    const { data } = await http.post<StoreLoginSessionResponse>(
      `/stores/${id}/login-session`,
      body ?? {},
      { timeout: 300_000 },
    )
    return data
  },
  clearLoginSession: async (id: number): Promise<Store> => {
    const { data } = await http.delete<Store>(`/stores/${id}/login-session`)
    return data
  },
  clearCatalog: async (id: number): Promise<StoreCatalogClearResult> => {
    const { data } = await http.delete<StoreCatalogClearResult>(`/stores/${id}/catalog`)
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
  forProduct: async (
    productId: number,
    params?: { from?: string | null; to?: string | null; limit?: number },
  ): Promise<PriceLog[]> => {
    const { data } = await http.get<PriceLog[]>(`/logs/product/${productId}`, {
      params: {
        from: params?.from || undefined,
        to: params?.to || undefined,
        limit: params?.limit,
      },
    })
    return data
  },
  all: async (
    productStoreId: number,
    params?: { from?: string | null; to?: string | null; limit?: number },
  ): Promise<PriceLog[]> => {
    const { data } = await http.get<PriceLog[]>('/logs/', {
      params: {
        product_store_id: productStoreId,
        from: params?.from || undefined,
        to: params?.to || undefined,
        limit: params?.limit,
      },
    })
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
  shutdown: async (): Promise<{ status: string }> => {
    const { data } = await http.post<{ status: string }>('/settings/shutdown')
    return data
  },
  databaseInfo: async (): Promise<DatabaseTransferInfo> => {
    const { data } = await http.get<DatabaseTransferInfo>('/settings/database/info')
    return data
  },
  exportDatabase: async (): Promise<{ blob: Blob; filename: string }> => {
    const response = await http.get<Blob>('/settings/database/export', {
      responseType: 'blob',
    })
    const disposition =
      response.headers['content-disposition'] ??
      response.headers['Content-Disposition']
    const match =
      typeof disposition === 'string'
        ? /filename="?([^"]+)"?/.exec(disposition)
        : null
    return {
      blob: response.data,
      filename: match?.[1] ?? 'gabada-backup.zip',
    }
  },
  importDatabase: async (file: File): Promise<DatabaseImportResponse> => {
    const form = new FormData()
    form.append('file', file)
    const { data } = await http.post<DatabaseImportResponse>(
      '/settings/database/import',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
    return data
  },
  checkUpdates: async (): Promise<UpdateCheckResponse> => {
    const { data } = await http.get<UpdateCheckResponse>('/settings/updates/latest', {
      timeout: 30_000,
    })
    return data
  },
}

export const scraperApi = {
  scrapeOne: async (productStoreId: number): Promise<ScrapeRunResponse> => {
    const { data } = await http.post<ScrapeRunResponse>(
      `/scraper/scrape/${productStoreId}`,
      undefined,
      { timeout: 300_000 },
    )
    return data
  },
  scrapeAll: async (): Promise<ScrapeAllResponse> => {
    const { data } = await http.post<ScrapeAllResponse>(
      '/scraper/scrape-all',
      undefined,
      { timeout: 600_000 },
    )
    return data
  },
  probe: async (body: {
    url: string
    use_playwright?: boolean
    wait_for?: string | null
    wait_timeout?: number
  }): Promise<ProbeResponse> => {
    // 5 min: a probe may fall through to the SeleniumBase stealth retry on
    // Cloudflare-protected sites, which pushes the call past the 30s default.
    const { data } = await http.post<ProbeResponse>('/scraper/probe', body, {
      timeout: 300_000,
    })
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
      { timeout: 300_000 },
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
    buy_area_picks?: BuyAreaPick[]
  }): Promise<ScrapeResult> => {
    const { data } = await http.post<ScrapeResult>(
      '/scraper/selector-lab/test',
      body,
      { timeout: 300_000 },
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
  listBuyAreaPicks: async (
    productStoreId: number,
  ): Promise<BuyAreaPicksResponse> => {
    const { data } = await http.get<BuyAreaPicksResponse>(
      `/scraper/selector-lab/buy-area-picks/${productStoreId}`,
    )
    return data
  },
  upsertBuyAreaPick: async (body: {
    product_store_id: number
    pick: BuyAreaPick
  }): Promise<BuyAreaPicksResponse> => {
    const { data } = await http.put<BuyAreaPicksResponse>(
      '/scraper/selector-lab/buy-area-pick',
      body,
    )
    return data
  },
  deleteBuyAreaPick: async (
    productStoreId: number,
    targetField: BuyAreaPickTarget,
  ): Promise<BuyAreaPicksResponse> => {
    const { data } = await http.delete<BuyAreaPicksResponse>(
      `/scraper/selector-lab/buy-area-pick/${productStoreId}/${targetField}`,
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
    const { data } = await http.post(
      `/scraper/reprobe/${productStoreId}`,
      undefined,
      { timeout: 300_000 },
    )
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
  apiPreview: async (body: {
    platform: ApiPlatform
    query?: string | null
    external_ids?: string[]
    country_code?: string | null
    language?: string | null
    limit?: number
    base_url?: string | null
    api_key?: string | null
    config?: Record<string, unknown>
  }): Promise<ApiProductPreview[]> => {
    const { data } = await http.post<ApiProductPreview[]>(
      '/import/api/preview',
      body,
      { timeout: 300_000 },
    )
    return data
  },
  apiImport: async (body: {
    platform: ApiPlatform
    store_id: number
    external_ids: string[]
    country_code?: string | null
    language?: string | null
    base_url?: string | null
    api_key?: string | null
    config?: Record<string, unknown>
  }): Promise<{ imported: number; existing: number; updated: number }> => {
    const { data } = await http.post('/import/api/import', body, {
      timeout: 300_000,
    })
    return data
  },
  wooPreview: async (body: {
    credentials: WooCredentials
    per_page?: number
    page?: number
    fetch_all?: boolean
  }): Promise<WooProductPreview[]> => {
    const { data } = await http.post<WooProductPreview[]>(
      '/import/woo/preview',
      body,
      { timeout: 300_000 },
    )
    return data
  },
  wooImport: async (body: {
    credentials: WooCredentials
    store_id: number
    product_ids: number[]
  }): Promise<{ imported: number }> => {
    const { data } = await http.post('/import/woo/import', body, {
      timeout: 300_000,
    })
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
    create_missing_products?: boolean
    missing_rows_policy?: 'ignore' | 'mark_dealer_unavailable'
    full_catalog_seen_product_store_ids?: number[]
    dealer_column_mapped?: boolean
    warranty_column_mapped?: boolean
  }): Promise<FileImportCommitResponse> => {
    const { data } = await http.post<FileImportCommitResponse>(
      '/import/file/commit',
      body,
    )
    return data
  },
}

export const driveApi = {
  status: async (): Promise<DriveStatus> => {
    const { data } = await http.get<DriveStatus>('/drive/status')
    return data
  },
  saveCredentials: async (body: {
    client_id: string
    client_secret: string
  }): Promise<DriveStatus> => {
    const { data } = await http.post<DriveStatus>('/drive/credentials', body)
    return data
  },
  clearCredentials: async (): Promise<DriveStatus> => {
    const { data } = await http.delete<DriveStatus>('/drive/credentials')
    return data
  },
  authStart: async (): Promise<{ auth_url: string }> => {
    const { data } = await http.post<{ auth_url: string }>('/drive/auth/start')
    return data
  },
  authPoll: async (): Promise<DriveStatus> => {
    const { data } = await http.get<DriveStatus>('/drive/auth/poll')
    return data
  },
  authCancel: async (): Promise<DriveStatus> => {
    const { data } = await http.post<DriveStatus>('/drive/auth/cancel')
    return data
  },
  signOut: async (): Promise<DriveStatus> => {
    const { data } = await http.post<DriveStatus>('/drive/auth/signout')
    return data
  },
  listSnapshots: async (): Promise<DriveSnapshotList> => {
    const { data } = await http.get<DriveSnapshotList>('/drive/snapshots')
    return data
  },
  push: async (): Promise<DrivePushResponse> => {
    const { data } = await http.post<DrivePushResponse>(
      '/drive/snapshots/push',
      undefined,
      { timeout: 600_000 },
    )
    return data
  },
  restore: async (snapshotId: string): Promise<DriveRestoreResponse> => {
    const { data } = await http.post<DriveRestoreResponse>(
      `/drive/snapshots/restore/${encodeURIComponent(snapshotId)}`,
      undefined,
      { timeout: 600_000 },
    )
    return data
  },
  delete: async (snapshotId: string): Promise<{ status: string; id: string }> => {
    const { data } = await http.delete<{ status: string; id: string }>(
      `/drive/snapshots/${encodeURIComponent(snapshotId)}`,
    )
    return data
  },
}
