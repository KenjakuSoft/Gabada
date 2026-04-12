import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/product.dart';
import '../services/api_service.dart';
import 'stock_badge.dart';

class StoreRow extends StatelessWidget {
  final int productId;
  final ProductStoreSummary summary;
  final VoidCallback? onScrape;
  final VoidCallback? onRemove;
  final VoidCallback? onOverrideChanged;

  const StoreRow({
    super.key,
    required this.productId,
    required this.summary,
    this.onScrape,
    this.onRemove,
    this.onOverrideChanged,
  });

  static final _fmt = NumberFormat('#,##0', 'en_US');

  String _price(double v) => 'Rs. ${_fmt.format(v)}';

  void _openOverrideSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => _OverrideSheet(
        productId: productId,
        summary: summary,
        onChanged: onOverrideChanged,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: summary.hasOverride
              ? cs.tertiary.withValues(alpha: 0.5)
              : cs.outlineVariant.withValues(alpha: 0.3),
        ),
      ),
      child: Row(
        children: [
          // Store name + URL
          Expanded(
            flex: 3,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      summary.storeName,
                      style: const TextStyle(
                          fontWeight: FontWeight.w600, fontSize: 13),
                    ),
                    if (summary.hasOverride) ...[
                      const SizedBox(width: 6),
                      Tooltip(
                        message: summary.overrideNote ?? 'Manual override active',
                        child: Icon(Icons.edit_note,
                            size: 14, color: cs.tertiary),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  summary.productUrl,
                  style: TextStyle(fontSize: 11, color: cs.outline),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),

          const SizedBox(width: 12),

          // Stock badge
          StockBadge(status: summary.latestStockStatus),

          const SizedBox(width: 12),

          // Prices
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              if (summary.latestDiscountedPrice != null) ...[
                Text(
                  _price(summary.latestDiscountedPrice!),
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                    color: cs.primary,
                  ),
                ),
                Text(
                  _price(summary.latestPrice!),
                  style: TextStyle(
                    fontSize: 12,
                    color: cs.outline,
                    decoration: TextDecoration.lineThrough,
                  ),
                ),
              ] else if (summary.latestPrice != null)
                Text(
                  _price(summary.latestPrice!),
                  style: const TextStyle(
                      fontWeight: FontWeight.w700, fontSize: 15),
                )
              else
                Text('—', style: TextStyle(color: cs.outline)),
              if (summary.latestDealerPrice != null) ...[
                const SizedBox(height: 3),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.storefront_outlined,
                        size: 11, color: cs.tertiary),
                    const SizedBox(width: 3),
                    Text(
                      _price(summary.latestDealerPrice!),
                      style: TextStyle(
                        fontSize: 11,
                        color: cs.tertiary,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ],
              if (summary.manualPrice != null) ...[
                const SizedBox(height: 3),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.edit_outlined, size: 11, color: cs.secondary),
                    const SizedBox(width: 3),
                    Text(
                      _price(summary.manualPrice!),
                      style: TextStyle(
                        fontSize: 11,
                        color: cs.secondary,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),

          const SizedBox(width: 4),

          // Actions
          IconButton(
            icon: const Icon(Icons.refresh, size: 18),
            tooltip: 'Scrape now',
            onPressed: onScrape,
          ),
          IconButton(
            icon: Icon(
              summary.hasOverride ? Icons.edit : Icons.edit_outlined,
              size: 18,
              color: summary.hasOverride ? cs.tertiary : null,
            ),
            tooltip: 'Manual override',
            onPressed: () => _openOverrideSheet(context),
          ),
          if (onRemove != null)
            IconButton(
              icon: const Icon(Icons.delete_outline, size: 18),
              tooltip: 'Remove',
              color: cs.error,
              onPressed: onRemove,
            ),
        ],
      ),
    );
  }
}

// ── Override Bottom Sheet ──────────────────────────────────────────────────────

class _OverrideSheet extends StatefulWidget {
  final int productId;
  final ProductStoreSummary summary;
  final VoidCallback? onChanged;

  const _OverrideSheet({
    required this.productId,
    required this.summary,
    this.onChanged,
  });

  @override
  State<_OverrideSheet> createState() => _OverrideSheetState();
}

class _OverrideSheetState extends State<_OverrideSheet> {
  final _priceCtrl = TextEditingController();
  final _noteCtrl = TextEditingController();
  String? _stockStatus; // null = no override
  bool _saving = false;

  static const _stockOptions = [
    (value: null, label: 'No override'),
    (value: 'in_stock', label: 'In Stock'),
    (value: 'limited', label: 'Limited'),
    (value: 'out_of_stock', label: 'Out of Stock'),
  ];

  @override
  void initState() {
    super.initState();
    final s = widget.summary;
    if (s.manualPrice != null) {
      _priceCtrl.text = s.manualPrice!.toStringAsFixed(0);
    }
    _stockStatus = s.manualStockStatus;
    _noteCtrl.text = s.overrideNote ?? '';
  }

  @override
  void dispose() {
    _priceCtrl.dispose();
    _noteCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final priceText = _priceCtrl.text.trim();
      final manualPrice =
          priceText.isNotEmpty ? double.tryParse(priceText) : null;
      await ApiService().upsertOverride(
        widget.productId,
        widget.summary.id,
        manualPrice: manualPrice,
        manualStockStatus: _stockStatus,
        overrideNote: _noteCtrl.text.trim().isEmpty
            ? null
            : _noteCtrl.text.trim(),
      );
      if (!mounted) return;
      Navigator.pop(context);
      widget.onChanged?.call();
    } catch (e) {
      setState(() => _saving = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: $e'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }
  }

  Future<void> _clear() async {
    setState(() => _saving = true);
    try {
      await ApiService().clearOverride(widget.productId, widget.summary.id);
      if (!mounted) return;
      Navigator.pop(context);
      widget.onChanged?.call();
    } catch (e) {
      setState(() => _saving = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: $e'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Padding(
      padding: EdgeInsets.fromLTRB(
        24,
        24,
        24,
        24 + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header
          Row(
            children: [
              Icon(Icons.edit_note, color: cs.tertiary),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Manual Override',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                    ),
                    Text(
                      widget.summary.storeName,
                      style: TextStyle(fontSize: 12, color: cs.outline),
                    ),
                  ],
                ),
              ),
              if (widget.summary.hasOverride)
                TextButton.icon(
                  onPressed: _saving ? null : _clear,
                  icon: Icon(Icons.clear, size: 16, color: cs.error),
                  label: Text('Clear', style: TextStyle(color: cs.error)),
                ),
            ],
          ),

          const SizedBox(height: 20),

          // Price field
          TextField(
            controller: _priceCtrl,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Manual price (optional)',
              hintText: 'e.g. 149900',
              prefixText: 'Rs. ',
              border: OutlineInputBorder(),
            ),
          ),

          const SizedBox(height: 16),

          // Stock status dropdown
          DropdownButtonFormField<String?>(
            initialValue: _stockStatus,
            decoration: const InputDecoration(
              labelText: 'Stock status (optional)',
              border: OutlineInputBorder(),
            ),
            items: _stockOptions
                .map((o) => DropdownMenuItem(
                      value: o.value,
                      child: Text(o.label),
                    ))
                .toList(),
            onChanged: (v) => setState(() => _stockStatus = v),
          ),

          const SizedBox(height: 16),

          // Note field
          TextField(
            controller: _noteCtrl,
            maxLines: 2,
            decoration: const InputDecoration(
              labelText: 'Note (optional)',
              hintText: 'e.g. Checked PDF catalog 2026-04-13',
              border: OutlineInputBorder(),
            ),
          ),

          const SizedBox(height: 24),

          // Buttons
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: _saving ? null : () => Navigator.pop(context),
                  child: const Text('Cancel'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton(
                  onPressed: _saving ? null : _save,
                  child: _saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Save Override'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
