class ActivityEntry {
  final int id;
  final int productId;
  final String productName;
  final String storeName;
  final String changeType;
  final double? price;
  final double? discountedPrice;
  final double? priceDelta;
  final double? previousPrice;
  final String? stockStatus;
  final String? previousStockStatus;
  final DateTime scrapedAt;

  const ActivityEntry({
    required this.id,
    required this.productId,
    required this.productName,
    required this.storeName,
    required this.changeType,
    this.price,
    this.discountedPrice,
    this.priceDelta,
    this.previousPrice,
    this.stockStatus,
    this.previousStockStatus,
    required this.scrapedAt,
  });

  factory ActivityEntry.fromJson(Map<String, dynamic> j) => ActivityEntry(
        id: j['id'],
        productId: j['product_id'],
        productName: j['product_name'],
        storeName: j['store_name'],
        changeType: j['change_type'],
        price: (j['price'] as num?)?.toDouble(),
        discountedPrice: (j['discounted_price'] as num?)?.toDouble(),
        priceDelta: (j['price_delta'] as num?)?.toDouble(),
        previousPrice: (j['previous_price'] as num?)?.toDouble(),
        stockStatus: j['stock_status'],
        previousStockStatus: j['previous_stock_status'],
        scrapedAt: DateTime.parse(j['scraped_at']),
      );

  double? get effectivePrice => discountedPrice ?? price;
}
