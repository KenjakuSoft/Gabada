import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:intl/intl.dart';
import '../models/product.dart';
import 'stock_badge.dart';

class ProductCard extends StatelessWidget {
  final Product product;
  final VoidCallback onTap;

  const ProductCard({super.key, required this.product, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final lowest = product.lowestPrice;
    final catColor = _parseCatColor(product.categoryColor, cs.primary);

    return Material(
      color: cs.surfaceContainerLow,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Left color accent bar
                Container(width: 4, color: catColor),

                // Product image
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: product.imageUrl != null
                        ? CachedNetworkImage(
                            imageUrl: product.imageUrl!,
                            width: 68,
                            height: 68,
                            fit: BoxFit.cover,
                            errorWidget: (ctx, url, err) => _placeholder(catColor),
                          )
                        : _placeholder(catColor),
                  ),
                ),

                // Info
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(0, 12, 12, 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        // Product name
                        Text(
                          product.canonicalName,
                          style: const TextStyle(
                              fontWeight: FontWeight.w700, fontSize: 14),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 5),

                        // Category + stock
                        Row(
                          children: [
                            if (product.categoryName != null) ...[
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 7, vertical: 2),
                                decoration: BoxDecoration(
                                  color: catColor.withValues(alpha: 0.15),
                                  borderRadius: BorderRadius.circular(5),
                                ),
                                child: Text(
                                  product.categoryName!,
                                  style: TextStyle(
                                      fontSize: 10,
                                      color: catColor,
                                      fontWeight: FontWeight.w600),
                                ),
                              ),
                              const SizedBox(width: 6),
                            ],
                            StockBadge(
                              status: product.anyInStock
                                  ? 'in_stock'
                                  : product.stores.isEmpty
                                      ? null
                                      : 'out_of_stock',
                            ),
                          ],
                        ),
                        const SizedBox(height: 5),

                        // Stores + price
                        Row(
                          children: [
                            Icon(Icons.storefront_outlined,
                                size: 12, color: cs.outline),
                            const SizedBox(width: 3),
                            Text(
                              '${product.stores.length} store${product.stores.length == 1 ? '' : 's'}',
                              style: TextStyle(fontSize: 11, color: cs.outline),
                            ),
                            const Spacer(),
                            if (lowest != null)
                              Text(
                                'Rs. ${NumberFormat('#,##0', 'en_US').format(lowest)}',
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w800,
                                  color: catColor,
                                ),
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),

                // Change indicator + chevron
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      ?_latestChangeIcon(product),
                      Icon(Icons.chevron_right,
                          color: cs.outline.withValues(alpha: 0.5), size: 20),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _placeholder(Color color) => Container(
        width: 68,
        height: 68,
        color: color.withValues(alpha: 0.08),
        child: Icon(Icons.image_outlined, color: color.withValues(alpha: 0.4)),
      );

  Widget? _latestChangeIcon(Product product) {
    // Show indicator for the most significant recent change across all stores
    final changes = product.stores.map((s) => s.latestChangeType).whereType<String>();
    if (changes.isEmpty) return null;

    if (changes.contains('stock_out')) {
      return const Icon(Icons.remove_shopping_cart_outlined,
          size: 14, color: Color(0xFFEF4444));
    }
    if (changes.contains('price_down')) {
      return const Icon(Icons.arrow_downward_rounded,
          size: 14, color: Color(0xFF22C55E));
    }
    if (changes.contains('price_up')) {
      return const Icon(Icons.arrow_upward_rounded,
          size: 14, color: Color(0xFFEF4444));
    }
    if (changes.contains('stock_in')) {
      return const Icon(Icons.shopping_cart_checkout_outlined,
          size: 14, color: Color(0xFF22C55E));
    }
    return null;
  }

  Color _parseCatColor(String? hex, Color fallback) {
    if (hex == null) return fallback;
    try {
      return Color(int.parse('FF${hex.replaceFirst('#', '')}', radix: 16));
    } catch (_) {
      return fallback;
    }
  }
}
