import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../models/product.dart';
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
                  await context.read<ProductsProvider>().triggerScrape(s.id);
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text('Scraping ${s.storeName}…'),
                        behavior: SnackBarBehavior.floating,
                      ),
                    );
                    await Future.delayed(const Duration(seconds: 5));
                    await _load();
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

  Future<void> _addStoreDialog() async {
    final api = ApiService();
    final stores = await api.getStores();
    if (!mounted) return;

    int? selectedStoreId;
    final urlCtrl = TextEditingController();

    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Link a Store'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<int>(
              decoration: const InputDecoration(labelText: 'Store'),
              items: stores
                  .map((s) => DropdownMenuItem(value: s.id, child: Text(s.name)))
                  .toList(),
              onChanged: (v) => selectedStoreId = v,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: urlCtrl,
              decoration: const InputDecoration(
                labelText: 'Product URL',
                hintText: 'https://shop.com/product/...',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () async {
              if (selectedStoreId == null || urlCtrl.text.isEmpty) return;
              await api.addStoreLink(
                _product!.id,
                storeId: selectedStoreId!,
                productUrl: urlCtrl.text.trim(),
              );
              if (ctx.mounted) Navigator.pop(ctx);
              await _load();
            },
            child: const Text('Add'),
          ),
        ],
      ),
    );
  }
}

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
                  '\$${v.toStringAsFixed(0)}',
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
