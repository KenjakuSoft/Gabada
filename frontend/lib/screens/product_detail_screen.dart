import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../models/product.dart';
import '../models/store.dart';
import '../models/price_log.dart';
import '../providers/products_provider.dart';
import '../services/api_service.dart';
import '../widgets/store_row.dart';

class ProductDetailScreen extends StatefulWidget {
  final int productId;
  const ProductDetailScreen({super.key, required this.productId});

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  Product? _product;
  List<PriceLog> _logs = [];
  DateTimeRange? _range;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = ApiService();
    final product = await api.getProduct(widget.productId);
    final logs = await api.getProductLogs(
      widget.productId,
      from: _range?.start,
      to: _range?.end,
    );
    if (mounted) {
      setState(() {
        _product = product;
        _logs = logs;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    if (_product == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final p = _product!;

    return Scaffold(
      appBar: AppBar(
        title: Text(p.canonicalName, maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [
          IconButton(
            icon: const Icon(Icons.date_range_outlined),
            tooltip: 'Filter date range',
            onPressed: _pickRange,
          ),
          IconButton(
            icon: Icon(Icons.delete_outline, color: cs.error),
            tooltip: 'Delete product',
            onPressed: _deleteProduct,
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Price chart
          if (_logs.isNotEmpty) ...[
            Text('Price History', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            _PriceChart(logs: _logs),
            const SizedBox(height: 24),
          ],

          // Stores
          Row(
            children: [
              Text('Stores (${p.stores.length})',
                  style: Theme.of(context).textTheme.titleMedium),
              const Spacer(),
              TextButton.icon(
                onPressed: _addStoreDialog,
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Add Store'),
              ),
            ],
          ),
          const SizedBox(height: 8),

          ...p.stores.map((s) => StoreRow(
                summary: s,
                onScrape: () async {
                  final triggeredAt = DateTime.now();
                  final messenger = ScaffoldMessenger.of(context);
                  await context.read<ProductsProvider>().triggerScrape(s.id);
                  if (!context.mounted) return;
                  messenger.showSnackBar(
                    SnackBar(
                      content: Text('Scraping ${s.storeName}…'),
                      behavior: SnackBarBehavior.floating,
                      duration: const Duration(seconds: 30),
                    ),
                  );
                  // Poll every 5 s until a new log appears (up to 35 s)
                  for (int i = 0; i < 7; i++) {
                    await Future.delayed(const Duration(seconds: 5));
                    if (!context.mounted) return;
                    await _load();
                    final hasNewLog =
                        _logs.any((l) => l.scrapedAt.isAfter(triggeredAt));
                    if (hasNewLog) {
                      messenger.hideCurrentSnackBar();
                      break;
                    }
                  }
                },
                onRemove: () async {
                  await ApiService().removeStoreLink(p.id, s.id);
                  await _load();
                },
              )),

          if (p.stores.isEmpty)
            Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  'No stores linked yet.\nTap "Add Store" to add where this product is sold.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: cs.outline),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _pickRange() async {
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2024),
      lastDate: DateTime.now(),
      initialDateRange: _range,
    );
    if (picked != null) {
      setState(() {
        _range = picked;
      });
      await _load();
    }
  }

  Future<void> _deleteProduct() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Product?'),
        content: Text('Remove "${_product!.canonicalName}" and all its price history?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed == true && mounted) {
      await context.read<ProductsProvider>().deleteProduct(_product!.id);
      if (mounted) Navigator.pop(context);
    }
  }

  Future<void> _addStoreDialog() async {
    final api = ApiService();
    final stores = await api.getStores();
    if (!mounted) return;

    await showDialog(
      context: context,
      builder: (ctx) => _AddStoreLinkDialog(
        productId: _product!.id,
        existingStores: stores,
        api: api,
        onDone: _load,
      ),
    );
  }
}

// ── Add Store Link Dialog ──────────────────────────────────────────────────────

class _AddStoreLinkDialog extends StatefulWidget {
  final int productId;
  final List<Store> existingStores;
  final ApiService api;
  final VoidCallback onDone;

  const _AddStoreLinkDialog({
    required this.productId,
    required this.existingStores,
    required this.api,
    required this.onDone,
  });

  @override
  State<_AddStoreLinkDialog> createState() => _AddStoreLinkDialogState();
}

class _AddStoreLinkDialogState extends State<_AddStoreLinkDialog> {
  late List<Store> _stores;
  int? _selectedStoreId;
  final _urlCtrl = TextEditingController();

  // New store creation
  bool _creatingStore = false;
  final _storeNameCtrl = TextEditingController();
  final _storeBaseUrlCtrl = TextEditingController();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _stores = List.from(widget.existingStores);
    if (_stores.isNotEmpty) _selectedStoreId = _stores.first.id;
  }

  @override
  void dispose() {
    _urlCtrl.dispose();
    _storeNameCtrl.dispose();
    _storeBaseUrlCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Link a Store'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Store selector or "create new" toggle
            if (!_creatingStore) ...[
              if (_stores.isEmpty)
                Text(
                  'No stores yet — create one below.',
                  style: TextStyle(color: Theme.of(context).colorScheme.outline, fontSize: 13),
                )
              else
                DropdownButtonFormField<int>(
                  initialValue: _selectedStoreId,
                  decoration: const InputDecoration(labelText: 'Store'),
                  items: _stores
                      .map((s) => DropdownMenuItem(value: s.id, child: Text(s.name)))
                      .toList(),
                  onChanged: (v) => setState(() => _selectedStoreId = v),
                ),
              const SizedBox(height: 4),
              TextButton.icon(
                onPressed: () => setState(() => _creatingStore = true),
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Create new store'),
                style: TextButton.styleFrom(alignment: Alignment.centerLeft),
              ),
            ] else ...[
              // Inline store creation form
              Text('New Store',
                  style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 8),
              TextField(
                controller: _storeNameCtrl,
                decoration: const InputDecoration(
                  labelText: 'Store name *',
                  hintText: 'e.g. Amazon, Newegg',
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _storeBaseUrlCtrl,
                decoration: const InputDecoration(
                  labelText: 'Base URL *',
                  hintText: 'https://amazon.com',
                ),
                keyboardType: TextInputType.url,
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  TextButton(
                    onPressed: () => setState(() => _creatingStore = false),
                    child: const Text('Cancel'),
                  ),
                  const Spacer(),
                  FilledButton(
                    onPressed: _saving ? null : _createStore,
                    child: _saving
                        ? const SizedBox(width: 16, height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Create'),
                  ),
                ],
              ),
              const Divider(height: 24),
            ],

            // Product URL (always shown when a store is selected)
            if (!_creatingStore && _selectedStoreId != null) ...[
              const SizedBox(height: 8),
              TextField(
                controller: _urlCtrl,
                decoration: const InputDecoration(
                  labelText: 'Product URL *',
                  hintText: 'https://store.com/product/...',
                ),
                keyboardType: TextInputType.url,
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        if (!_creatingStore && _selectedStoreId != null)
          FilledButton(
            onPressed: _saving ? null : _linkStore,
            child: _saving
                ? const SizedBox(width: 16, height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Link'),
          ),
      ],
    );
  }

  Future<void> _createStore() async {
    final name = _storeNameCtrl.text.trim();
    final baseUrl = _storeBaseUrlCtrl.text.trim();
    if (name.isEmpty || baseUrl.isEmpty) return;
    setState(() => _saving = true);
    try {
      final store = await widget.api.createStore(name, baseUrl);
      setState(() {
        _stores.add(store);
        _selectedStoreId = store.id;
        _creatingStore = false;
        _saving = false;
      });
    } catch (e) {
      setState(() => _saving = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), behavior: SnackBarBehavior.floating),
        );
      }
    }
  }

  Future<void> _linkStore() async {
    if (_selectedStoreId == null || _urlCtrl.text.trim().isEmpty) return;
    setState(() => _saving = true);
    try {
      await widget.api.addStoreLink(
        widget.productId,
        storeId: _selectedStoreId!,
        productUrl: _urlCtrl.text.trim(),
      );
      if (mounted) Navigator.pop(context);
      widget.onDone();
    } catch (e) {
      setState(() => _saving = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), behavior: SnackBarBehavior.floating),
        );
      }
    }
  }
}

// ── Price Chart ────────────────────────────────────────────────────────────────

class _PriceChart extends StatelessWidget {
  final List<PriceLog> logs;
  const _PriceChart({required this.logs});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final sorted = [...logs]..sort((a, b) => a.scrapedAt.compareTo(b.scrapedAt));

    final spots = sorted
        .where((l) => l.effectivePrice != null)
        .toList();

    if (spots.isEmpty) return const SizedBox.shrink();

    final minY = spots.map((l) => l.effectivePrice!).reduce((a, b) => a < b ? a : b);
    final maxY = spots.map((l) => l.effectivePrice!).reduce((a, b) => a > b ? a : b);
    final padding = (maxY - minY) * 0.15 + 5;

    return Container(
      height: 220,
      padding: const EdgeInsets.fromLTRB(8, 16, 16, 8),
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(16),
      ),
      child: LineChart(
        LineChartData(
          minY: minY - padding,
          maxY: maxY + padding,
          gridData: FlGridData(
            drawVerticalLine: false,
            getDrawingHorizontalLine: (_) => FlLine(
              color: cs.outlineVariant.withValues(alpha: 0.2),
              strokeWidth: 1,
            ),
          ),
          borderData: FlBorderData(show: false),
          titlesData: FlTitlesData(
            leftTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 56,
                getTitlesWidget: (v, _) => Text(
                  NumberFormat('#,##0', 'en_US').format(v),
                  style: TextStyle(fontSize: 10, color: cs.outline),
                ),
              ),
            ),
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 28,
                interval: (spots.length / 4).ceilToDouble(),
                getTitlesWidget: (v, _) {
                  final idx = v.toInt();
                  if (idx < 0 || idx >= spots.length) return const SizedBox();
                  return Text(
                    DateFormat('MMM d').format(spots[idx].scrapedAt),
                    style: TextStyle(fontSize: 10, color: cs.outline),
                  );
                },
              ),
            ),
            rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
            topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          ),
          lineBarsData: [
            LineChartBarData(
              spots: spots.asMap().entries.map((e) {
                return FlSpot(e.key.toDouble(), e.value.effectivePrice!);
              }).toList(),
              isCurved: true,
              color: cs.primary,
              barWidth: 2.5,
              dotData: const FlDotData(show: false),
              belowBarData: BarAreaData(
                show: true,
                color: cs.primary.withValues(alpha: 0.08),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
