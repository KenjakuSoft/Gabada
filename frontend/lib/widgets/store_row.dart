import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/product.dart';
import 'stock_badge.dart';

class StoreRow extends StatelessWidget {
  final ProductStoreSummary summary;
  final VoidCallback? onScrape;
  final VoidCallback? onRemove;

  const StoreRow({
    super.key,
    required this.summary,
    this.onScrape,
    this.onRemove,
  });

  static final _fmt = NumberFormat('#,##0', 'en_US');

  String _price(double v) => 'Rs. ${_fmt.format(v)}';

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: cs.outlineVariant.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          // Store name
          Expanded(
            flex: 3,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  summary.storeName,
                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
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
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                )
              else
                Text('—', style: TextStyle(color: cs.outline)),
              if (summary.latestDealerPrice != null) ...[
                const SizedBox(height: 3),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.storefront_outlined, size: 11, color: cs.tertiary),
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
            ],
          ),

          const SizedBox(width: 8),

          // Actions
          IconButton(
            icon: const Icon(Icons.refresh, size: 18),
            tooltip: 'Scrape now',
            onPressed: onScrape,
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
