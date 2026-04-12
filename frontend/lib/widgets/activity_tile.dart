import 'package:flutter/material.dart';
import '../models/activity_entry.dart';

class ActivityTile extends StatelessWidget {
  final ActivityEntry entry;

  const ActivityTile({super.key, required this.entry});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final info = _info(cs);

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: Container(
        width: 42,
        height: 42,
        decoration: BoxDecoration(
          color: info.color.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Icon(info.icon, color: info.color, size: 20),
      ),
      title: Text(
        entry.productName,
        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 2),
          Text(
            info.description,
            style: TextStyle(
              fontSize: 12,
              color: info.color,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            '${entry.storeName}  ·  ${_relativeTime(entry.scrapedAt)}',
            style: TextStyle(fontSize: 11, color: cs.outline),
          ),
        ],
      ),
      trailing: entry.effectivePrice != null
          ? Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  '\$${entry.effectivePrice!.toStringAsFixed(2)}',
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 14,
                    color: cs.onSurface,
                  ),
                ),
                if (entry.previousPrice != null)
                  Text(
                    '\$${entry.previousPrice!.toStringAsFixed(2)}',
                    style: TextStyle(
                      fontSize: 11,
                      color: cs.outline,
                      decoration: TextDecoration.lineThrough,
                    ),
                  ),
              ],
            )
          : null,
      isThreeLine: true,
    );
  }

  _Info _info(ColorScheme cs) {
    final delta = entry.priceDelta;

    switch (entry.changeType) {
      case 'price_down':
        final amt = delta != null ? delta.abs().toStringAsFixed(2) : '?';
        return _Info(
          icon: Icons.arrow_downward_rounded,
          color: const Color(0xFF22C55E),
          description: 'Price dropped by \$$amt',
        );
      case 'price_up':
        final amt = delta != null ? delta.abs().toStringAsFixed(2) : '?';
        return _Info(
          icon: Icons.arrow_upward_rounded,
          color: const Color(0xFFEF4444),
          description: 'Price increased by \$$amt',
        );
      case 'stock_out':
        return _Info(
          icon: Icons.remove_shopping_cart_outlined,
          color: const Color(0xFFEF4444),
          description: 'Went out of stock',
        );
      case 'stock_in':
        return _Info(
          icon: Icons.shopping_cart_checkout_outlined,
          color: const Color(0xFF22C55E),
          description: 'Back in stock',
        );
      case 'price_and_stock':
        final stockStr = entry.stockStatus == 'out_of_stock' ? 'out of stock' : 'in stock';
        final priceStr = delta != null
            ? (delta > 0
                ? 'up \$${delta.abs().toStringAsFixed(2)}'
                : 'down \$${delta.abs().toStringAsFixed(2)}')
            : 'changed';
        return _Info(
          icon: Icons.sync_alt_rounded,
          color: const Color(0xFFF97316),
          description: 'Price $priceStr · now $stockStr',
        );
      case 'stock_change':
        return _Info(
          icon: Icons.swap_horiz_rounded,
          color: const Color(0xFFF97316),
          description: 'Stock changed to ${entry.stockStatus ?? 'unknown'}',
        );
      case 'new':
        return _Info(
          icon: Icons.fiber_new_rounded,
          color: cs.primary,
          description: 'First price recorded',
        );
      default:
        return _Info(
          icon: Icons.update_rounded,
          color: cs.outline,
          description: 'Updated',
        );
    }
  }

  String _relativeTime(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inSeconds < 60) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays == 1) return 'yesterday';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${dt.day}/${dt.month}/${dt.year}';
  }
}

class _Info {
  final IconData icon;
  final Color color;
  final String description;
  const _Info({
    required this.icon,
    required this.color,
    required this.description,
  });
}
