import { http } from './client'
import type { Product, ProductStoreSummary } from './types'

export interface QuickAddResult {
  url: string
  status: 'ok' | 'error'
  product_id?: number | null
  product_store_id?: number | null
  name?: string | null
  store_id?: number | null
  store_name?: string | null
  platform?: string | null
  price?: number | null
  discounted_price?: number | null
  stock_status?: string | null
  error?: string | null
}

export interface QuickAddResponse {
  results: QuickAddResult[]
}

export const productsApi = {
  list: async (categoryId?: number): Promise<Product[]> => {
    const { data } = await http.get<Product[]>('/products/', {
      params: categoryId ? { category_id: categoryId } : undefined,
    })
    return data
  },

  get: async (id: number): Promise<Product> => {
    const { data } = await http.get<Product>(`/products/${id}`)
    return data
  },

  create: async (body: {
    canonical_name: string
    image_url?: string | null
    category_id?: number | null
  }): Promise<Product> => {
    const { data } = await http.post<Product>('/products/', body)
    return data
  },

  update: async (
    id: number,
    body: {
      canonical_name: string
      image_url?: string | null
      category_id?: number | null
    },
  ): Promise<Product> => {
    const { data } = await http.patch<Product>(`/products/${id}`, body)
    return data
  },

  remove: async (id: number): Promise<void> => {
    await http.delete(`/products/${id}`)
  },

  addStore: async (
    productId: number,
    body: {
      store_id: number
      product_url?: string | null
      auto_detect?: boolean
    },
  ): Promise<ProductStoreSummary> => {
    const { data } = await http.post<ProductStoreSummary>(
      `/products/${productId}/stores`,
      body,
    )
    return data
  },

  removeStore: async (productId: number, storeLinkId: number): Promise<void> => {
    await http.delete(`/products/${productId}/stores/${storeLinkId}`)
  },

  updateStore: async (
    productId: number,
    storeLinkId: number,
    body: {
      product_url?: string | null
      manual_price?: number | null
      manual_stock_status?: string | null
      manual_warranty?: string | null
      override_note?: string | null
    },
  ): Promise<ProductStoreSummary> => {
    const { data } = await http.patch<ProductStoreSummary>(
      `/products/${productId}/stores/${storeLinkId}`,
      body,
    )
    return data
  },

  setOverride: async (
    productId: number,
    storeLinkId: number,
    body: {
      manual_price?: number | null
      manual_stock_status?: string | null
      manual_warranty?: string | null
      override_note?: string | null
    },
  ) => {
    const { data } = await http.put(
      `/products/${productId}/stores/${storeLinkId}/override`,
      body,
    )
    return data
  },

  clearOverride: async (productId: number, storeLinkId: number): Promise<void> => {
    await http.delete(`/products/${productId}/stores/${storeLinkId}/override`)
  },

  quickAdd: async (body: {
    urls: string[]
    category_id?: number | null
    store_id?: number | null
  }): Promise<QuickAddResponse> => {
    const { data } = await http.post<QuickAddResponse>(
      '/products/quick-add',
      body,
    )
    return data
  },
}
