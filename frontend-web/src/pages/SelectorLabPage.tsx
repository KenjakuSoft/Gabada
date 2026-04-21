import { useMemo, useState, type ComponentProps } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Globe,
  Info,
  Link2,
  Loader2,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Target,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { ScrapeReviewNotice } from '@/components/scraper/ScrapeReviewNotice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { BentoGrid, BentoTile, TileHeader } from '@/components/ui/bento'
import { StatTile } from '@/components/ui/stat-tile'
import { scraperApi, storesApi } from '@/api'
import { toast } from '@/components/ui/toast-store'
import { useCurrencySymbol } from '@/hooks/useSettings'
import { formatMoney } from '@/lib/utils'
import type {
  ScrapeResult,
  ScrapeSelectorField,
  ScrapeSelectorMap,
  SelectorLabCandidate,
  SelectorLabResponse,
  Store,
} from '@/api'

const FIELD_META: Array<{
  key: ScrapeSelectorField
  label: string
  description: string
}> = [
  { key: 'title', label: 'Title', description: 'Product name heading' },
  { key: 'price', label: 'Price', description: 'Regular/original price' },
  {
    key: 'discounted_price',
    label: 'Discounted',
    description: 'Current sale price',
  },
  { key: 'dealer_price', label: 'Dealer', description: 'Trade or wholesale price' },
  {
    key: 'stock_status',
    label: 'Stock',
    description: 'Availability text or button state',
  },
  { key: 'image', label: 'Image', description: 'Primary product image' },
]

const PLATFORM_OPTIONS = [
  'generic',
  'cs-cart',
  'woocommerce',
  'shopify',
  'magento',
  'prestashop',
] as const

const ACTIVE_TARGETS: Array<'wait_for' | ScrapeSelectorField> = [
  'wait_for',
  ...FIELD_META.map((field) => field.key),
]

type ActiveTarget = 'wait_for' | ScrapeSelectorField
type CandidateFlag = 'payment' | 'related' | 'spec' | 'low_confidence'

interface SelectorDraft {
  platform: string
  waitFor: string
  selectors: ScrapeSelectorMap
  targetStoreId: string
}

function hostnameFromUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return null
  }
}

function isMskHost(hostname: string | null | undefined): boolean {
  return hostname?.endsWith('mskcomputers.lk') ?? false
}

function findStoreId(stores: Store[], host: string | null): string {
  if (!host) return ''
  const match = stores.find(
    (store) => hostnameFromUrl(store.base_url) === host.toLowerCase(),
  )
  return match ? String(match.id) : ''
}

function buildDraft(result: SelectorLabResponse, stores: Store[]): SelectorDraft {
  const selectors = FIELD_META.reduce<ScrapeSelectorMap>((acc, field) => {
    acc[field.key] =
      result.current_profile?.selectors[field.key] ??
      result.suggested_assignments[field.key] ??
      null
    return acc
  }, {})

  const host = result.hostname ?? hostnameFromUrl(result.final_url ?? result.url)
  return {
    platform: result.current_profile?.platform ?? result.platform ?? 'generic',
    waitFor:
      result.current_profile?.wait_for ??
      result.suggested_assignments.wait_for ??
      '',
    selectors,
    targetStoreId: findStoreId(stores, host),
  }
}

function fieldLabel(field: ActiveTarget): string {
  if (field === 'wait_for') return 'wait_for'
  return FIELD_META.find((item) => item.key === field)?.label ?? field
}

function fieldDescription(field: ActiveTarget): string {
  if (field === 'wait_for') return 'Element to wait for before scraping'
  return FIELD_META.find((item) => item.key === field)?.description ?? 'Scraper field'
}

function candidateSummary(candidate: SelectorLabCandidate, symbol: string): string {
  if (candidate.value != null) return formatMoney(candidate.value, symbol)
  if (candidate.stock_status) return candidate.stock_status
  return candidate.sample ?? candidate.text ?? 'n/a'
}

function resultValue(result: ScrapeResult, symbol: string): string {
  if (result.discounted_price != null) return formatMoney(result.discounted_price, symbol)
  if (result.price != null) return formatMoney(result.price, symbol)
  return 'n/a'
}

function candidateBlob(candidate: SelectorLabCandidate): string {
  return [
    candidate.selector,
    candidate.sample,
    candidate.text,
    candidate.reason,
    candidate.dom_path,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function candidateFlags(candidate: SelectorLabCandidate): CandidateFlag[] {
  const blob = candidateBlob(candidate)
  const flags: CandidateFlag[] = []
  if (
    /koko|installments?|today|30\s*days|60\s*days|credit\s*card|transaction\s*fee|webxpay|bank\s*rates|total|buy\s*now,\s*pay\s*later/.test(
      blob,
    )
  ) {
    flags.push('payment')
  }
  if (/related|you might also be interested|recommend|upsell|cross[\s-]?sell/.test(blob)) {
    flags.push('related')
  }
  if (
    /product attributes|product information|details|specifications?|warranty|weight|voltage|current|dimension|size|code|model/.test(
      blob,
    )
  ) {
    flags.push('spec')
  }
  if (candidate.confidence < 60) flags.push('low_confidence')
  return flags
}

function flagLabel(flag: CandidateFlag): string {
  switch (flag) {
    case 'payment':
      return 'payment noise'
    case 'related':
      return 'related'
    case 'spec':
      return 'spec'
    case 'low_confidence':
      return 'low confidence'
  }
}

function flagVariant(flag: CandidateFlag): ComponentProps<typeof Badge>['variant'] {
  switch (flag) {
    case 'payment':
    case 'related':
      return 'warning'
    case 'spec':
      return 'muted'
    case 'low_confidence':
      return 'outline'
  }
}

function isHelpfulCandidate(candidate: SelectorLabCandidate): boolean {
  const flags = candidateFlags(candidate)
  return (
    !flags.includes('payment') &&
    !flags.includes('related') &&
    candidate.confidence >= 56
  )
}

function matchesSearch(candidate: SelectorLabCandidate, query: string): boolean {
  if (!query.trim()) return true
  return candidateBlob(candidate).includes(query.trim().toLowerCase())
}

function sortCandidates(candidates: SelectorLabCandidate[]): SelectorLabCandidate[] {
  return [...candidates].sort(
    (a, b) =>
      b.confidence - a.confidence ||
      (b.value ?? 0) - (a.value ?? 0) ||
      a.selector.localeCompare(b.selector),
  )
}

function recommendForField(
  candidates: SelectorLabCandidate[],
  field: ScrapeSelectorField,
): SelectorLabCandidate | null {
  const direct = candidates.filter((candidate) => candidate.kind_hints.includes(field))
  const preferred = direct.filter(isHelpfulCandidate)
  return sortCandidates(preferred.length > 0 ? preferred : direct)[0] ?? null
}

function recommendWaitFor(
  recommendations: Partial<Record<ScrapeSelectorField, SelectorLabCandidate | null>>,
): SelectorLabCandidate | null {
  return (
    recommendations.discounted_price ??
    recommendations.price ??
    recommendations.stock_status ??
    recommendations.title ??
    null
  )
}

function findCandidateForSelector(
  candidates: SelectorLabCandidate[],
  selector: string | null | undefined,
  field?: ScrapeSelectorField,
): SelectorLabCandidate | null {
  if (!selector) return null
  const exact = candidates.filter((candidate) => candidate.selector === selector)
  const targeted = field
    ? exact.filter((candidate) => candidate.kind_hints.includes(field))
    : exact
  return sortCandidates(targeted.length > 0 ? targeted : exact)[0] ?? null
}

function quickTargets(candidate: SelectorLabCandidate): ActiveTarget[] {
  const targets = new Set<ActiveTarget>()
  if (
    candidate.kind_hints.some((hint) =>
      ['title', 'price', 'discounted_price', 'stock_status'].includes(hint),
    )
  ) {
    targets.add('wait_for')
  }
  for (const target of ACTIVE_TARGETS) {
    if (target !== 'wait_for' && candidate.kind_hints.includes(target)) {
      targets.add(target)
    }
  }
  return ACTIVE_TARGETS.filter((target) => targets.has(target))
}

function isAssignedToTarget(
  draft: SelectorDraft,
  target: ActiveTarget,
  selector: string,
): boolean {
  if (target === 'wait_for') return draft.waitFor === selector
  return draft.selectors[target] === selector
}

export function SelectorLabPage() {
  const symbol = useCurrencySymbol()
  const [url, setUrl] = useState('')
  const [waitForInput, setWaitForInput] = useState('')
  const [usePlaywright, setUsePlaywright] = useState(true)
  const [activeTarget, setActiveTarget] = useState<ActiveTarget>('price')
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [helpfulOnly, setHelpfulOnly] = useState(false)
  const [draft, setDraft] = useState<SelectorDraft | null>(null)

  const stores = useQuery<Store[]>({
    queryKey: ['stores'],
    queryFn: () => storesApi.list(),
  })

  const analyze = useMutation({
    mutationFn: () =>
      scraperApi.selectorLab({
        url: url.trim(),
        use_playwright: usePlaywright,
        wait_for: waitForInput.trim() || null,
      }),
    onSuccess: (data) => {
      setDraft(buildDraft(data, stores.data ?? []))
      setHelpfulOnly(isMskHost(data.hostname))
      test.reset()
      toast.success('Selector scan complete', data.hostname ?? data.platform)
    },
    onError: () =>
      toast.error('Scan failed', 'Check the URL and backend, then try again'),
  })

  const test = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('No selector draft')
      return scraperApi.testSelectorLab({
        url: url.trim(),
        use_playwright: usePlaywright,
        wait_for: draft.waitFor.trim() || null,
        platform: draft.platform || null,
        selectors: draft.selectors,
      })
    },
    onSuccess: () => toast.success('Selection tested'),
    onError: () => toast.error('Test failed', 'The selector set could not be run'),
  })

  const save = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('No selector draft')
      return scraperApi.saveSelectorProfile({
        url: url.trim(),
        store_id: draft.targetStoreId ? Number(draft.targetStoreId) : null,
        platform: draft.platform || null,
        wait_for: draft.waitFor.trim() || null,
        selectors: draft.selectors,
      })
    },
    onSuccess: (data) => {
      setDraft((current) =>
        current
          ? {
              ...current,
              platform: data.profile.platform ?? current.platform,
              waitFor: data.profile.wait_for ?? current.waitFor,
              selectors: {
                ...current.selectors,
                ...data.profile.selectors,
              },
            }
          : current,
      )
      toast.success('Selector profile saved', data.profile.hostname)
    },
    onError: () =>
      toast.error('Save failed', 'Could not write the store selector profile'),
  })

  const result = analyze.data
  const displayed = test.data ?? result?.extracted ?? null
  const host = result?.hostname ?? hostnameFromUrl(result?.final_url ?? url)
  const noisyHost = isMskHost(host)
  const saveTarget = draft?.targetStoreId
    ? stores.data?.find((store) => String(store.id) === draft.targetStoreId)?.name ??
      host ??
      'selected store'
    : host ?? 'current URL host'

  const recommendations = useMemo(() => {
    if (!result) return null
    const byField = FIELD_META.reduce<
      Partial<Record<ScrapeSelectorField, SelectorLabCandidate | null>>
    >((acc, field) => {
      acc[field.key] = recommendForField(result.candidates, field.key)
      return acc
    }, {})
    return {
      ...byField,
      wait_for: recommendWaitFor(byField),
    }
  }, [result])

  const selectedCandidates = useMemo(() => {
    if (!result || !draft) return null
    const selections = FIELD_META.reduce<
      Partial<Record<ScrapeSelectorField, SelectorLabCandidate | null>>
    >((acc, field) => {
      acc[field.key] = findCandidateForSelector(
        result.candidates,
        draft.selectors[field.key],
        field.key,
      )
      return acc
    }, {})
    return {
      ...selections,
      wait_for: findCandidateForSelector(result.candidates, draft.waitFor),
    }
  }, [draft, result])

  const filteredCandidates = useMemo(() => {
    const source = result?.candidates ?? []
    return source.filter((candidate) => {
      if (filter !== 'all' && !candidate.kind_hints.includes(filter as ScrapeSelectorField)) {
        return false
      }
      if (helpfulOnly && !isHelpfulCandidate(candidate)) return false
      if (!matchesSearch(candidate, search)) return false
      return true
    })
  }, [filter, helpfulOnly, result?.candidates, search])

  const resetDraft = () => {
    if (!result) return
    setDraft(buildDraft(result, stores.data ?? []))
    test.reset()
  }

  const assignToTarget = (target: ActiveTarget, selector: string) => {
    setDraft((current) => {
      if (!current) return current
      if (target === 'wait_for') return { ...current, waitFor: selector }
      return {
        ...current,
        selectors: {
          ...current.selectors,
          [target]: selector,
        },
      }
    })
  }

  const updateSelector = (field: ScrapeSelectorField, value: string) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            selectors: {
              ...current.selectors,
              [field]: value || null,
            },
          }
        : current,
    )
  }

  return (
    <div className="max-w-7xl space-y-6">
      <PageHeader
        title="Selector Lab"
        description="Scan a product page, review the strongest selector candidates, test them, and save a profile for the store."
      />

      <BentoGrid cols={6}>
        <BentoTile colSpan={4} tone="primary">
          <TileHeader
            eyebrow="Inspect"
            title="Scan a product URL"
            icon={<Link2 className="h-4 w-4" />}
          />
          <div className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="selector-lab-url">URL</Label>
              <Input
                id="selector-lab-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://shop.example.com/product/item"
                disabled={analyze.isPending}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="selector-lab-waitfor">
                  Wait-for selector (optional)
                </Label>
                <Input
                  id="selector-lab-waitfor"
                  value={waitForInput}
                  onChange={(event) => setWaitForInput(event.target.value)}
                  placeholder=".product-price"
                  className="font-mono"
                  disabled={analyze.isPending}
                />
              </div>
              <div className="flex items-end">
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={usePlaywright}
                    onChange={(event) => setUsePlaywright(event.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="text-sm">Playwright</span>
                </label>
              </div>
              <div className="flex items-end">
                <Button
                  onClick={() => analyze.mutate()}
                  disabled={url.trim().length < 8 || analyze.isPending}
                >
                  {analyze.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  Scan selectors
                </Button>
              </div>
            </div>
          </div>
        </BentoTile>

        <StatTile
          label="Platform"
          value={result?.platform ?? 'n/a'}
          icon={<Sparkles className="h-4 w-4" />}
          hint={result ? 'detected' : 'run scan first'}
          tone={result ? 'primary' : 'default'}
        />
        <StatTile
          label="Candidates"
          value={result?.candidates.length ?? 0}
          icon={<Target className="h-4 w-4" />}
          hint={result?.root_selector ?? 'awaiting scan'}
          tone={result && result.candidates.length > 0 ? 'accent' : 'default'}
        />
      </BentoGrid>

      {result && draft && recommendations ? (
        <div className="space-y-6">
          <BentoGrid cols={6}>
            <BentoTile colSpan={2} tone={noisyHost ? 'accent' : 'default'}>
              <TileHeader
                eyebrow="Workflow"
                title="Make it reliable"
                icon={
                  noisyHost ? (
                    <AlertTriangle className="h-4 w-4" />
                  ) : (
                    <Info className="h-4 w-4" />
                  )
                }
              />
              <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                <p>1. Start with the recommended selectors below.</p>
                <p>2. Test before saving so the extracted price and stock look right.</p>
                <p>3. If a page is noisy, turn on useful-only filtering and ignore payment or related rows.</p>
                {noisyHost ? (
                  <div className="rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-200">
                    MSK pages often include KOKO installment numbers and related-product prices.
                    Pick the main `LKR` value near the top product block, then test on a few products
                    before saving the store profile.
                  </div>
                ) : null}
              </div>
            </BentoTile>

            <BentoTile colSpan={4}>
              <TileHeader
                eyebrow="Recommended"
                title="Best guesses from this page"
                icon={<Sparkles className="h-4 w-4" />}
                action={
                  <Button size="sm" variant="outline" onClick={resetDraft}>
                    <RotateCcw className="h-4 w-4" />
                    Reset to detected
                  </Button>
                }
              />
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <RecommendedCard
                  label="wait_for"
                  description="Element to wait for"
                  candidate={recommendations.wait_for}
                  symbol={symbol}
                  selected={draft.waitFor}
                  onUse={(selector) => assignToTarget('wait_for', selector)}
                />
                {FIELD_META.map((field) => (
                  <RecommendedCard
                    key={field.key}
                    label={field.label}
                    description={field.description}
                    candidate={recommendations[field.key] ?? null}
                    symbol={symbol}
                    selected={draft.selectors[field.key] ?? null}
                    onUse={(selector) => assignToTarget(field.key, selector)}
                  />
                ))}
              </div>
            </BentoTile>
          </BentoGrid>

          <BentoGrid cols={6}>
            <BentoTile colSpan={4}>
              <TileHeader
                eyebrow="Assignments"
                title="Selected scraper fields"
                icon={<Settings2 className="h-4 w-4" />}
                action={
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => test.mutate()}
                      disabled={test.isPending || save.isPending}
                    >
                      {test.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      Test selection
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => save.mutate()}
                      disabled={save.isPending || test.isPending}
                    >
                      {save.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Globe className="h-4 w-4" />
                      )}
                      Save for {saveTarget}
                    </Button>
                  </div>
                }
              />

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="selector-lab-store">Store target</Label>
                  <Select
                    id="selector-lab-store"
                    value={draft.targetStoreId}
                    onChange={(event) =>
                      setDraft((current) =>
                        current
                          ? { ...current, targetStoreId: event.target.value }
                          : current,
                      )
                    }
                  >
                    <option value="">Use detected host</option>
                    {(stores.data ?? []).map((store) => (
                      <option key={store.id} value={store.id}>
                        {store.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="selector-lab-platform">Platform</Label>
                  <Select
                    id="selector-lab-platform"
                    value={draft.platform}
                    onChange={(event) =>
                      setDraft((current) =>
                        current
                          ? { ...current, platform: event.target.value }
                          : current,
                      )
                    }
                  >
                    {PLATFORM_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="selector-lab-active-target">Quick assign target</Label>
                  <Select
                    id="selector-lab-active-target"
                    value={activeTarget}
                    onChange={(event) =>
                      setActiveTarget(event.target.value as ActiveTarget)
                    }
                  >
                    {ACTIVE_TARGETS.map((target) => (
                      <option key={target} value={target}>
                        {fieldLabel(target)}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <SelectionCard
                  label="wait_for"
                  description={fieldDescription('wait_for')}
                  value={draft.waitFor}
                  candidate={selectedCandidates?.wait_for ?? null}
                  active={activeTarget === 'wait_for'}
                  onFocus={() => setActiveTarget('wait_for')}
                  onChange={(value) =>
                    setDraft((current) =>
                      current ? { ...current, waitFor: value } : current,
                    )
                  }
                  onClear={() =>
                    setDraft((current) =>
                      current ? { ...current, waitFor: '' } : current,
                    )
                  }
                  symbol={symbol}
                />

                {FIELD_META.map((field) => (
                  <SelectionCard
                    key={field.key}
                    label={field.label}
                    description={field.description}
                    value={draft.selectors[field.key] ?? ''}
                    candidate={selectedCandidates?.[field.key] ?? null}
                    active={activeTarget === field.key}
                    onFocus={() => setActiveTarget(field.key)}
                    onChange={(value) => updateSelector(field.key, value)}
                    onClear={() => updateSelector(field.key, '')}
                    symbol={symbol}
                  />
                ))}
              </div>
            </BentoTile>

            <BentoTile colSpan={2}>
              <TileHeader
                eyebrow="Preview"
                title={test.data ? 'Test result' : 'Current extraction'}
                icon={<CheckCircle2 className="h-4 w-4" />}
              />
              <dl className="mt-3 grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Title</dt>
                <dd className="line-clamp-2">{displayed?.title ?? 'n/a'}</dd>
                <dt className="text-muted-foreground">Price</dt>
                <dd className="font-semibold tabular-nums">
                  {displayed ? resultValue(displayed, symbol) : 'n/a'}
                </dd>
                <dt className="text-muted-foreground">Regular</dt>
                <dd className="font-semibold tabular-nums">
                  {displayed?.price != null
                    ? formatMoney(displayed.price, symbol)
                    : 'n/a'}
                </dd>
                <dt className="text-muted-foreground">Discounted</dt>
                <dd className="font-semibold tabular-nums">
                  {displayed?.discounted_price != null
                    ? formatMoney(displayed.discounted_price, symbol)
                    : 'n/a'}
                </dd>
                <dt className="text-muted-foreground">Stock</dt>
                <dd>
                  <Badge
                    variant={
                      displayed?.stock_status === 'in_stock' ||
                      displayed?.stock_status === 'limited'
                        ? 'success'
                        : displayed?.stock_status === 'out_of_stock'
                          ? 'destructive'
                          : 'muted'
                    }
                  >
                    {displayed?.stock_status ?? 'unknown'}
                  </Badge>
                </dd>
                <dt className="text-muted-foreground">Raw price</dt>
                <dd className="truncate font-mono text-xs">
                  {displayed?.raw_price ?? 'n/a'}
                </dd>
              </dl>
              {displayed?.error ? (
                <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                  {displayed.error}
                </div>
              ) : null}
              {displayed ? (
                <ScrapeReviewNotice result={displayed} className="mt-4" />
              ) : null}
            </BentoTile>
          </BentoGrid>

          <BentoGrid cols={6}>
            <BentoTile colSpan={6}>
              <TileHeader
                eyebrow="Candidate explorer"
                title={`${filteredCandidates.length} visible candidates`}
                icon={<FileText className="h-4 w-4" />}
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search selector, text, or notes"
                      className="h-8 w-60"
                    />
                    <Select
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                    >
                      <option value="all">All hints</option>
                      {FIELD_META.map((field) => (
                        <option key={field.key} value={field.key}>
                          {field.label}
                        </option>
                      ))}
                    </Select>
                    <label className="flex items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={helpfulOnly}
                        onChange={(event) => setHelpfulOnly(event.target.checked)}
                        className="h-4 w-4 accent-primary"
                      />
                      Useful only
                    </label>
                    <Badge variant="secondary">
                      Quick target: {fieldLabel(activeTarget)}
                    </Badge>
                  </div>
                }
              />

              <div className="mt-3 overflow-hidden rounded-md border border-border">
                <div className="max-h-[560px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 text-muted-foreground backdrop-blur">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium">Sample</th>
                        <th className="px-2 py-1.5 text-left font-medium">Hints</th>
                        <th className="px-2 py-1.5 text-left font-medium">Selector</th>
                        <th className="px-2 py-1.5 text-left font-medium">Quick assign</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCandidates.map((candidate, index) => {
                        const flags = candidateFlags(candidate)
                        const activeMatch = isAssignedToTarget(
                          draft,
                          activeTarget,
                          candidate.selector,
                        )
                        return (
                          <tr
                            key={`${candidate.selector}-${candidate.sample ?? index}`}
                            className={`border-t border-border transition-colors hover:bg-accent/30 ${
                              activeMatch ? 'bg-primary/5' : ''
                            }`}
                          >
                            <td className="px-2 py-2 align-top">
                              <div className="max-w-[280px]">
                                <div className="font-medium">
                                  {candidateSummary(candidate, symbol)}
                                </div>
                                {candidate.text && candidate.text !== candidate.sample ? (
                                  <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                                    {candidate.text}
                                  </div>
                                ) : null}
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {flags.map((flag) => (
                                    <Badge
                                      key={`${candidate.selector}-${flag}`}
                                      variant={flagVariant(flag)}
                                      className="text-[10px]"
                                    >
                                      {flagLabel(flag)}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            </td>
                            <td className="px-2 py-2 align-top">
                              <div className="flex max-w-[220px] flex-wrap gap-1">
                                {candidate.kind_hints.map((hint) => (
                                  <Badge
                                    key={`${candidate.selector}-${hint}`}
                                    variant="outline"
                                    className="text-[10px]"
                                  >
                                    {hint}
                                  </Badge>
                                ))}
                                <Badge variant="muted" className="text-[10px]">
                                  {candidate.source}
                                </Badge>
                                <Badge
                                  variant={
                                    candidate.confidence >= 80 ? 'success' : 'secondary'
                                  }
                                  className="text-[10px]"
                                >
                                  {candidate.confidence}
                                </Badge>
                              </div>
                              {candidate.reason ? (
                                <div className="mt-1 max-w-[220px] truncate text-[10px] text-muted-foreground">
                                  {candidate.reason}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-2 py-2 align-top">
                              <div className="max-w-[360px] truncate font-mono text-[11px]">
                                {candidate.selector}
                              </div>
                              {candidate.dom_path ? (
                                <div className="mt-0.5 max-w-[360px] truncate text-[10px] text-muted-foreground">
                                  {candidate.dom_path}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-2 py-2 align-top">
                              <div className="flex max-w-[260px] flex-wrap gap-1">
                                {quickTargets(candidate).map((target) => (
                                  <Button
                                    key={`${candidate.selector}-${target}`}
                                    size="sm"
                                    variant={
                                      isAssignedToTarget(draft, target, candidate.selector)
                                        ? 'secondary'
                                        : activeTarget === target
                                          ? 'default'
                                          : 'outline'
                                    }
                                    onClick={() => assignToTarget(target, candidate.selector)}
                                  >
                                    {fieldLabel(target)}
                                  </Button>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </BentoTile>
          </BentoGrid>

          {result.notes.length > 0 ? (
            <BentoGrid cols={6}>
              <BentoTile colSpan={6} tone="accent">
                <TileHeader
                  eyebrow="Notes"
                  title="Inspector observations"
                  icon={<Info className="h-4 w-4" />}
                />
                <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                  {result.notes.map((note, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </BentoTile>
            </BentoGrid>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function RecommendedCard({
  label,
  description,
  candidate,
  symbol,
  selected,
  onUse,
}: {
  label: string
  description: string
  candidate: SelectorLabCandidate | null
  symbol: string
  selected: string | null
  onUse: (selector: string) => void
}) {
  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        {selected && candidate && selected === candidate.selector ? (
          <Badge variant="success">selected</Badge>
        ) : null}
      </div>
      {candidate ? (
        <div className="mt-3 space-y-2">
          <div className="text-sm font-medium">
            {candidateSummary(candidate, symbol)}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {candidate.selector}
          </div>
          <div className="flex flex-wrap gap-1">
            {candidate.kind_hints.map((hint) => (
              <Badge key={`${candidate.selector}-${hint}`} variant="outline" className="text-[10px]">
                {hint}
              </Badge>
            ))}
            <Badge
              variant={candidate.confidence >= 80 ? 'success' : 'secondary'}
              className="text-[10px]"
            >
              {candidate.confidence}
            </Badge>
          </div>
          <Button size="sm" variant="outline" onClick={() => onUse(candidate.selector)}>
            Use selector
          </Button>
        </div>
      ) : (
        <div className="mt-3 text-xs text-muted-foreground">
          No strong candidate found on this page.
        </div>
      )}
    </div>
  )
}

function SelectionCard({
  label,
  description,
  value,
  candidate,
  active,
  onFocus,
  onChange,
  onClear,
  symbol,
}: {
  label: string
  description: string
  value: string
  candidate: SelectorLabCandidate | null
  active: boolean
  onFocus: () => void
  onChange: (value: string) => void
  onClear: () => void
  symbol: string
}) {
  const flags = candidate ? candidateFlags(candidate) : []
  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        <div className="flex items-center gap-2">
          {value ? (
            <Button size="sm" variant="ghost" onClick={onClear}>
              Clear
            </Button>
          ) : null}
          <Button size="sm" variant={active ? 'secondary' : 'ghost'} onClick={onFocus}>
            Focus
          </Button>
        </div>
      </div>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 font-mono text-xs"
        placeholder="No selector selected"
      />
      {candidate ? (
        <div className="mt-2 space-y-2 rounded-md border border-border/60 bg-background/60 p-2">
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="secondary">{candidateSummary(candidate, symbol)}</Badge>
            <Badge
              variant={candidate.confidence >= 80 ? 'success' : 'secondary'}
              className="text-[10px]"
            >
              {candidate.confidence}
            </Badge>
            {flags.map((flag) => (
              <Badge key={`${candidate.selector}-${flag}`} variant={flagVariant(flag)} className="text-[10px]">
                {flagLabel(flag)}
              </Badge>
            ))}
          </div>
          {candidate.dom_path ? (
            <div className="truncate text-[10px] text-muted-foreground">
              {candidate.dom_path}
            </div>
          ) : null}
        </div>
      ) : value ? (
        <div className="mt-2 text-[11px] text-muted-foreground">
          This selector is custom and does not match a scanned candidate on this page.
        </div>
      ) : null}
    </div>
  )
}
