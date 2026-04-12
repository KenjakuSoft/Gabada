class PriceLog {
  final int id;
  final int productStoreId;
  final DateTime scrapedAt;
  final String? title;
  final double? price;
  final double? discountedPrice;
  final String? stockStatus;

  const PriceLog({
    required this.id,
    required this.productStoreId,
    required this.scrapedAt,
    this.title,
    this.price,
    this.discountedPrice,
    this.stockStatus,
  });

  factory PriceLog.fromJson(Map<String, dynamic> j) => PriceLog(
        id: j['id'],
        productStoreId: j['product_store_id'],
        scrapedAt: DateTime.parse(j['scraped_at']),
        title: j['title'],
        price: (j['price'] as num?)?.toDouble(),
        discountedPrice: (j['discounted_price'] as num?)?.toDouble(),
        stockStatus: j['stock_status'],
      );

  double? get effectivePrice => discountedPrice ?? price;
}
