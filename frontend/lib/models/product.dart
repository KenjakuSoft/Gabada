class ProductStoreSummary {
  final int id;
  final int storeId;
  final String storeName;
  final String storeBaseUrl;
  final String productUrl;
  final bool isActive;
  final double? latestPrice;
  final double? latestDiscountedPrice;
  final double? latestDealerPrice;
  final String? latestStockStatus;
  final DateTime? latestScrapedAt;
  final String? latestChangeType;
  final double? latestPriceDelta;

  const ProductStoreSummary({
    required this.id,
    required this.storeId,
    required this.storeName,
    required this.storeBaseUrl,
    required this.productUrl,
    required this.isActive,
    this.latestPrice,
    this.latestDiscountedPrice,
    this.latestDealerPrice,
    this.latestStockStatus,
    this.latestScrapedAt,
    this.latestChangeType,
    this.latestPriceDelta,
  });

  factory ProductStoreSummary.fromJson(Map<String, dynamic> j) =>
      ProductStoreSummary(
        id: j['id'],
        storeId: j['store_id'],
        storeName: j['store_name'],
        storeBaseUrl: j['store_base_url'],
        productUrl: j['product_url'],
        isActive: j['is_active'] == true,
        latestPrice: (j['latest_price'] as num?)?.toDouble(),
        latestDiscountedPrice:
            (j['latest_discounted_price'] as num?)?.toDouble(),
        latestDealerPrice: (j['latest_dealer_price'] as num?)?.toDouble(),
        latestStockStatus: j['latest_stock_status'],
        latestScrapedAt: j['latest_scraped_at'] != null
            ? DateTime.parse(j['latest_scraped_at'])
            : null,
        latestChangeType: j['latest_change_type'],
        latestPriceDelta: (j['latest_price_delta'] as num?)?.toDouble(),
      );

  bool get inStock => latestStockStatus == 'in_stock';
  bool get outOfStock => latestStockStatus == 'out_of_stock';
  bool get limited => latestStockStatus == 'limited';
  bool get hasDiscount =>
      latestDiscountedPrice != null &&
      latestPrice != null &&
      latestDiscountedPrice! < latestPrice!;
}

class Product {
  final int id;
  final String canonicalName;
  final String? imageUrl;
  final int? categoryId;
  final String? categoryName;
  final String? categoryColor;
  final DateTime createdAt;
  final List<ProductStoreSummary> stores;

  const Product({
    required this.id,
    required this.canonicalName,
    this.imageUrl,
    this.categoryId,
    this.categoryName,
    this.categoryColor,
    required this.createdAt,
    required this.stores,
  });

  factory Product.fromJson(Map<String, dynamic> j) => Product(
        id: j['id'],
        canonicalName: j['canonical_name'],
        imageUrl: j['image_url'],
        categoryId: j['category_id'],
        categoryName: j['category_name'],
        categoryColor: j['category_color'],
        createdAt: DateTime.parse(j['created_at']),
        stores: (j['stores'] as List<dynamic>)
            .map((s) => ProductStoreSummary.fromJson(s))
            .toList(),
      );

  double? get lowestPrice {
    final prices = stores
        .where((s) => s.latestPrice != null)
        .map((s) => s.latestDiscountedPrice ?? s.latestPrice!)
        .toList();
    if (prices.isEmpty) return null;
    return prices.reduce((a, b) => a < b ? a : b);
  }

  bool get anyInStock => stores.any((s) => s.inStock || s.limited);
}
