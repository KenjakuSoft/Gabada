import 'package:flutter/material.dart';

class StockBadge extends StatelessWidget {
  final String? status;
  const StockBadge({super.key, required this.status});

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (status) {
      'in_stock' => ('In Stock', const Color(0xFF22C55E)),
      'limited' => ('Limited', const Color(0xFFF59E0B)),
      'out_of_stock' => ('Out of Stock', const Color(0xFFEF4444)),
      _ => ('Unknown', const Color(0xFF6B7280)),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withValues(alpha: 0.4), width: 1),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.3,
        ),
      ),
    );
  }
}
