export type StockStatus =
  | 'in_stock'
  | 'out_of_stock'
  | 'limited'
  | 'preorder'
  | 'backorder'
  | 'unknown'

export interface Category {
  id: number
  name: string
  color: string
  created_at: string
}

export interface Store {
  id: number
  name: string
  base_url: string
  created_at: string
}

export interface ProductStoreSummary {
  id: number
  store_id: number
  store_name: string
  store_base_url: string
  product_url: string
  is_active: boolean
  latest_price: number | null
  latest_discounted_price: number | null
  latest_dealer_price: number | null
  latest_stock_status: StockStatus | null
  latest_scraped_at: string | null
  latest_change_type: string | null
  latest_price_delta: number | null
  manual_price: number | null
  manual_stock_status: StockStatus | null
  override_note: string | null
}

export interface Product {
  id: number
  canonical_name: string
  image_url: string | null
  category_id: number | null
  category_name: string | null
  category_color: string | null
  created_at: string
  stores: ProductStoreSummary[]
}

export interface PriceLog {
  id: number
  product_store_id: number
  scraped_at: string
  title: string | null
  price: number | null
  discounted_price: number | null
  dealer_price: number | null
  stock_status: StockStatus | null
  change_type: string | null
  price_delta: number | null
}

export interface ActivityEntry {
  id: number
  product_id: number
  product_name: string
  store_name: string
  change_type: string
  price: number | null
  discounted_price: number | null
  price_delta: number | null
  previous_price: number | null
  stock_status: StockStatus | null
  previous_stock_status: StockStatus | null
  scraped_at: string
}

export interface Settings {
  currency_code: string
  currency_symbol: string
  country_code: string
  timezone: string
  scrape_cron: string
  scrape_enabled: boolean
  locale: string
  theme: 'light' | 'dark' | 'system'
  updated_at: string | null
}

export interface ProbeCandidate {
  text: string
  value: number | null
  score: number
  font_size: number | null
  font_weight: number | null
  struck: boolean
  dealer: boolean
  variant_alt: boolean
  dom_path: string | null
}

export interface ScrapeResult {
  title: string | null
  price: number | null
  discounted_price: number | null
  dealer_price: number | null
  stock_status: StockStatus
  raw_price: string | null
  raw_discounted: string | null
  raw_dealer: string | null
  error: string | null
}

export interface ProbeResponse {
  url: string
  final_url: string | null
  platform: string
  suggested_wait_for: string | null
  suggested_selectors: Record<string, string | null>
  json_ld_found: boolean
  json_ld_name: string | null
  json_ld_price: number | null
  json_ld_availability: string | null
  extracted: ScrapeResult
  candidates: ProbeCandidate[]
  notes: string[]
}

export interface WooCredentials {
  site_url: string
  consumer_key: string
  consumer_secret: string
}

export interface WooProductPreview {
  woo_id: number
  name: string
  permalink: string
  regular_price: string | null
  sale_price: string | null
  stock_status: string
  image_url: string | null
  categories: string[]
}

export interface FileImportPreviewResponse {
  columns: string[]
  sample_rows: string[][]
  total_rows: number
  file_format: 'csv' | 'excel' | 'pdf'
}

export interface FileImportRow {
  name: string
  url: string
  image_url?: string | null
}
