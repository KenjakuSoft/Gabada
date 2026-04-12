class WooProductPreview {
  final int wooId;
  final String name;
  final String permalink;
  final String? regularPrice;
  final String? salePrice;
  final String stockStatus;
  final String? imageUrl;
  final List<String> categories;

  const WooProductPreview({
    required this.wooId,
    required this.name,
    required this.permalink,
    this.regularPrice,
    this.salePrice,
    required this.stockStatus,
    this.imageUrl,
    required this.categories,
  });

  factory WooProductPreview.fromJson(Map<String, dynamic> j) => WooProductPreview(
        wooId: j['woo_id'],
        name: j['name'],
        permalink: j['permalink'],
        regularPrice: j['regular_price'],
        salePrice: j['sale_price'],
        stockStatus: j['stock_status'] ?? 'unknown',
        imageUrl: j['image_url'],
        categories: List<String>.from(j['categories'] ?? []),
      );
}

class FileImportPreview {
  final List<String> columns;
  final List<List<String>> sampleRows;
  final int totalRows;
  final String fileFormat;

  const FileImportPreview({
    required this.columns,
    required this.sampleRows,
    required this.totalRows,
    required this.fileFormat,
  });

  factory FileImportPreview.fromJson(Map<String, dynamic> j) => FileImportPreview(
        columns: List<String>.from(j['columns']),
        sampleRows: (j['sample_rows'] as List)
            .map((r) => List<String>.from(r as List))
            .toList(),
        totalRows: j['total_rows'],
        fileFormat: j['file_format'],
      );
}
