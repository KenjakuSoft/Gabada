import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shimmer/shimmer.dart';
import '../providers/products_provider.dart';
import '../providers/categories_provider.dart';
import '../widgets/product_card.dart';
import 'product_detail_screen.dart';
import 'add_product_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  String _search = '';
  int? _selectedCategoryId; // null = All

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<ProductsProvider>().load();
      context.read<CategoriesProvider>().load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final products = context.watch<ProductsProvider>();
    final cats = context.watch<CategoriesProvider>();
    final cs = Theme.of(context).colorScheme;

    final filtered = products.products.where((p) {
      final matchSearch =
          p.canonicalName.toLowerCase().contains(_search.toLowerCase());
      final matchCat =
          _selectedCategoryId == null || p.categoryId == _selectedCategoryId;
      return matchSearch && matchCat;
    }).toList();

    return Scaffold(
      backgroundColor: cs.surface,
      body: CustomScrollView(
        slivers: [
          // ── App bar ──────────────────────────────────────────────────────
          SliverAppBar(
            floating: true,
            pinned: false,
            backgroundColor: cs.surface,
            title: Row(
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: cs.primary,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(Icons.track_changes, color: Colors.white, size: 18),
                ),
                const SizedBox(width: 10),
                const Text('Gabada',
                    style: TextStyle(fontWeight: FontWeight.w800, fontSize: 22)),
              ],
            ),
            actions: [
              IconButton(
                icon: const Icon(Icons.refresh_rounded),
                tooltip: 'Scrape all now',
                onPressed: () async {
                  await products.triggerScrapeAll();
                  if (!context.mounted) return;
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                    content: Text('Scraping all products — refreshing every 10 s…'),
                    behavior: SnackBarBehavior.floating,
                    duration: Duration(seconds: 60),
                  ));
                  // Reload repeatedly while scraping completes (sequential per store)
                  for (int i = 0; i < 6; i++) {
                    await Future.delayed(const Duration(seconds: 10));
                    if (!context.mounted) return;
                    await products.load();
                  }
                },
              ),
              IconButton(
                icon: const Icon(Icons.label_outline_rounded),
                tooltip: 'Manage categories',
                onPressed: () => _showCategoryManager(context, cats),
              ),
              const SizedBox(width: 4),
            ],
          ),

          // ── Search bar ───────────────────────────────────────────────────
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
              child: TextField(
                decoration: InputDecoration(
                  hintText: 'Search products…',
                  prefixIcon: const Icon(Icons.search, size: 20),
                  suffixIcon: _search.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear, size: 18),
                          onPressed: () => setState(() => _search = ''),
                        )
                      : null,
                ),
                onChanged: (v) => setState(() => _search = v),
              ),
            ),
          ),

          // ── Category chips ───────────────────────────────────────────────
          SliverToBoxAdapter(
            child: SizedBox(
              height: 52,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                children: [
                  _CategoryChip(
                    label: 'All',
                    color: cs.primary,
                    selected: _selectedCategoryId == null,
                    onTap: () => setState(() => _selectedCategoryId = null),
                  ),
                  ...cats.categories.map((c) => _CategoryChip(
                        label: c.name,
                        color: c.flutterColor,
                        selected: _selectedCategoryId == c.id,
                        onTap: () =>
                            setState(() => _selectedCategoryId = c.id),
                      )),
                ],
              ),
            ),
          ),

          // ── Stats row ────────────────────────────────────────────────────
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text(
                '${filtered.length} product${filtered.length == 1 ? '' : 's'}',
                style: TextStyle(fontSize: 12, color: cs.outline),
              ),
            ),
          ),

          // ── Product list ─────────────────────────────────────────────────
          if (products.loading)
            SliverList(
              delegate: SliverChildBuilderDelegate(
                (_, i) => _ShimmerCard(),
                childCount: 6,
              ),
            )
          else if (products.error != null)
            SliverFillRemaining(child: _buildError(products))
          else if (filtered.isEmpty)
            SliverFillRemaining(child: _buildEmpty())
          else
            SliverList(
              delegate: SliverChildBuilderDelegate(
                (ctx, i) => Padding(
                  padding: EdgeInsets.fromLTRB(
                      16, 0, 16, i == filtered.length - 1 ? 96 : 10),
                  child: ProductCard(
                    product: filtered[i],
                    onTap: () => Navigator.push(
                      ctx,
                      MaterialPageRoute(
                        builder: (_) =>
                            ProductDetailScreen(productId: filtered[i].id),
                      ),
                    ).then((_) => products.load()),
                  ),
                ),
                childCount: filtered.length,
              ),
            ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => const AddProductScreen()),
        ).then((_) => products.load()),
        icon: const Icon(Icons.add),
        label: const Text('Add Product'),
      ),
    );
  }

  void _showCategoryManager(BuildContext context, CategoriesProvider cats) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => ChangeNotifierProvider.value(
        value: cats,
        child: const _CategoryManagerSheet(),
      ),
    );
  }

  Widget _buildError(ProductsProvider p) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.wifi_off_rounded, size: 48, color: Colors.redAccent),
            const SizedBox(height: 12),
            const Text('Cannot reach backend'),
            const SizedBox(height: 4),
            Text(
              'Run: python -m uvicorn main:app --port 8000',
              style: TextStyle(color: Theme.of(context).colorScheme.outline, fontSize: 12),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: p.load,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      );

  Widget _buildEmpty() => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.inventory_2_outlined,
                size: 56, color: Theme.of(context).colorScheme.outline),
            const SizedBox(height: 12),
            Text(
              _selectedCategoryId != null
                  ? 'No products in this category'
                  : 'No products yet',
            ),
            const SizedBox(height: 8),
            Text(
              'Tap + Add Product to get started',
              style: TextStyle(color: Theme.of(context).colorScheme.outline),
            ),
          ],
        ),
      );
}

// ── Category chip ──────────────────────────────────────────────────────────────

class _CategoryChip extends StatelessWidget {
  final String label;
  final Color color;
  final bool selected;
  final VoidCallback onTap;

  const _CategoryChip({
    required this.label,
    required this.color,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        margin: const EdgeInsets.only(right: 8),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? color : color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: selected ? color : color.withValues(alpha: 0.3),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? Colors.white : color,
            fontWeight: FontWeight.w600,
            fontSize: 13,
          ),
        ),
      ),
    );
  }
}

// ── Shimmer placeholder ────────────────────────────────────────────────────────

class _ShimmerCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: Shimmer.fromColors(
        baseColor: const Color(0xFF1A1A24),
        highlightColor: const Color(0xFF2A2A38),
        child: Container(
          height: 96,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
          ),
        ),
      ),
    );
  }
}

// ── Category manager bottom sheet ─────────────────────────────────────────────

class _CategoryManagerSheet extends StatefulWidget {
  const _CategoryManagerSheet();
  @override
  State<_CategoryManagerSheet> createState() => _CategoryManagerSheetState();
}

class _CategoryManagerSheetState extends State<_CategoryManagerSheet> {
  final _nameCtrl = TextEditingController();
  String _pickedColor = '#6C63FF';
  bool _saving = false;

  static const _palette = [
    '#6C63FF', '#FF6B6B', '#4CAF50', '#00B4D8',
    '#FF9800', '#E91E63', '#009688', '#795548',
    '#607D8B', '#9C27B0',
  ];

  @override
  void dispose() {
    _nameCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cats = context.watch<CategoriesProvider>();
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.55,
      maxChildSize: 0.85,
      builder: (ctx, scroll) => Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 12,
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 16,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 36,
                height: 4,
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(
                  color: Theme.of(ctx).colorScheme.outlineVariant,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            Text('Categories', style: Theme.of(ctx).textTheme.titleLarge),
            const SizedBox(height: 16),

            // Existing categories
            Expanded(
              child: cats.categories.isEmpty
                  ? Center(
                      child: Text('No categories yet',
                          style: TextStyle(
                              color: Theme.of(ctx).colorScheme.outline)),
                    )
                  : ListView.builder(
                      controller: scroll,
                      itemCount: cats.categories.length,
                      itemBuilder: (_, i) {
                        final c = cats.categories[i];
                        return ListTile(
                          leading: CircleAvatar(
                            backgroundColor: c.flutterColor,
                            radius: 10,
                          ),
                          title: Text(c.name),
                          trailing: IconButton(
                            icon: Icon(Icons.delete_outline,
                                color: Theme.of(ctx).colorScheme.error, size: 20),
                            onPressed: () => cats.delete(c.id),
                          ),
                          contentPadding: EdgeInsets.zero,
                        );
                      },
                    ),
            ),

            const Divider(),
            Text('New Category', style: Theme.of(ctx).textTheme.labelLarge),
            const SizedBox(height: 8),

            // Color picker
            SizedBox(
              height: 36,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: _palette.map((hex) {
                  final color = Color(int.parse('FF${hex.substring(1)}', radix: 16));
                  final selected = hex == _pickedColor;
                  return GestureDetector(
                    onTap: () => setState(() => _pickedColor = hex),
                    child: Container(
                      width: 30,
                      height: 30,
                      margin: const EdgeInsets.only(right: 8),
                      decoration: BoxDecoration(
                        color: color,
                        shape: BoxShape.circle,
                        border: selected
                            ? Border.all(color: Colors.white, width: 3)
                            : null,
                        boxShadow: selected
                            ? [BoxShadow(color: color.withValues(alpha: 0.6), blurRadius: 6)]
                            : null,
                      ),
                    ),
                  );
                }).toList(),
              ),
            ),
            const SizedBox(height: 10),

            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _nameCtrl,
                    decoration: const InputDecoration(
                      hintText: 'Category name…',
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                FilledButton(
                  onPressed: _saving ? null : _create,
                  child: _saving
                      ? const SizedBox(width: 16, height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('Add'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _create() async {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) return;
    setState(() => _saving = true);
    await context.read<CategoriesProvider>().create(name, _pickedColor);
    _nameCtrl.clear();
    if (mounted) setState(() => _saving = false);
  }
}
