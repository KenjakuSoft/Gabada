import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/activity_provider.dart';
import '../widgets/activity_tile.dart';

class ActivityScreen extends StatefulWidget {
  const ActivityScreen({super.key});

  @override
  State<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityScreenState extends State<ActivityScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<ActivityProvider>().load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final provider = context.watch<ActivityProvider>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Recent Changes'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh',
            onPressed: provider.loading ? null : () => provider.load(),
          ),
        ],
      ),
      body: Column(
        children: [
          // Filter chips
          SizedBox(
            height: 48,
            child: ListView(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              scrollDirection: Axis.horizontal,
              children: [
                _FilterChip(
                  label: 'All',
                  value: null,
                  current: provider.filter,
                  onSelected: () => provider.setFilter(null),
                ),
                const SizedBox(width: 8),
                _FilterChip(
                  label: '↓ Price Drop',
                  value: 'price_down',
                  current: provider.filter,
                  onSelected: () => provider.setFilter('price_down'),
                ),
                const SizedBox(width: 8),
                _FilterChip(
                  label: '↑ Price Up',
                  value: 'price_up',
                  current: provider.filter,
                  onSelected: () => provider.setFilter('price_up'),
                ),
                const SizedBox(width: 8),
                _FilterChip(
                  label: 'Out of Stock',
                  value: 'stock_out',
                  current: provider.filter,
                  onSelected: () => provider.setFilter('stock_out'),
                ),
                const SizedBox(width: 8),
                _FilterChip(
                  label: 'Back in Stock',
                  value: 'stock_in',
                  current: provider.filter,
                  onSelected: () => provider.setFilter('stock_in'),
                ),
                const SizedBox(width: 8),
                _FilterChip(
                  label: 'New',
                  value: 'new',
                  current: provider.filter,
                  onSelected: () => provider.setFilter('new'),
                ),
              ],
            ),
          ),

          const Divider(height: 1),

          // Content
          Expanded(
            child: _buildBody(context, provider, cs),
          ),
        ],
      ),
    );
  }

  Widget _buildBody(BuildContext context, ActivityProvider provider, ColorScheme cs) {
    if (provider.loading && provider.entries.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (provider.error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 48, color: cs.error),
            const SizedBox(height: 12),
            Text('Failed to load activity', style: TextStyle(color: cs.error)),
            const SizedBox(height: 8),
            TextButton.icon(
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Retry'),
              onPressed: () => provider.load(),
            ),
          ],
        ),
      );
    }

    if (provider.entries.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.history_toggle_off_rounded,
                size: 56, color: cs.outline.withValues(alpha: 0.4)),
            const SizedBox(height: 16),
            Text(
              'No changes yet',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: cs.outline,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Scrape products to start tracking price and stock changes.',
              style: TextStyle(fontSize: 13, color: cs.outline.withValues(alpha: 0.7)),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () => provider.load(),
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(vertical: 8),
        itemCount: provider.entries.length,
        separatorBuilder: (_, _) => Divider(
          height: 1,
          indent: 72,
          color: cs.outlineVariant.withValues(alpha: 0.4),
        ),
        itemBuilder: (context, i) => ActivityTile(entry: provider.entries[i]),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final String? value;
  final String? current;
  final VoidCallback onSelected;

  const _FilterChip({
    required this.label,
    required this.value,
    required this.current,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    final selected = value == current;
    final cs = Theme.of(context).colorScheme;
    return FilterChip(
      label: Text(label, style: const TextStyle(fontSize: 12)),
      selected: selected,
      showCheckmark: false,
      selectedColor: cs.primaryContainer,
      onSelected: (_) => onSelected(),
    );
  }
}
