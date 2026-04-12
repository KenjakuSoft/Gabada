import 'package:dio/dio.dart';
import '../models/product.dart';
import '../models/store.dart';
import '../models/price_log.dart';
import '../models/category.dart';
import '../models/activity_entry.dart';

class ApiService {
  static const _base = 'http://localhost:8000';

  final Dio _dio = Dio(BaseOptions(
    baseUrl: _base,
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 30),
  ));

  // ── Categories ───────────────────────────────────────────────────────────────

  Future<List<Category>> getCategories() async {
    final res = await _dio.get('/categories/');
    return (res.data as List).map((j) => Category.fromJson(j)).toList();
  }

  Future<Category> createCategory(String name, String color) async {
    final res = await _dio.post('/categories/', data: {'name': name, 'color': color});
    return Category.fromJson(res.data);
  }

  Future<void> deleteCategory(int id) => _dio.delete('/categories/$id');

  // ── Products ─────────────────────────────────────────────────────────────────

  Future<List<Product>> getProducts({int? categoryId}) async {
    final res = await _dio.get('/products/', queryParameters: {
      'category_id': ?categoryId,
    });
    return (res.data as List).map((j) => Product.fromJson(j)).toList();
  }

  Future<Product> getProduct(int id) async {
    final res = await _dio.get('/products/$id');
    return Product.fromJson(res.data);
  }

  Future<Product> createProduct(String canonicalName,
      {String? imageUrl, int? categoryId}) async {
    final res = await _dio.post('/products/', data: {
      'canonical_name': canonicalName,
      'image_url': imageUrl,
      'category_id': categoryId,
    });
    return Product.fromJson(res.data);
  }

  Future<Product> updateProduct(int id, String canonicalName,
      {String? imageUrl, int? categoryId}) async {
    final res = await _dio.patch('/products/$id', data: {
      'canonical_name': canonicalName,
      'image_url': imageUrl,
      'category_id': categoryId,
    });
    return Product.fromJson(res.data);
  }

  Future<void> deleteProduct(int id) => _dio.delete('/products/$id');

  Future<ProductStoreSummary> addStoreLink(int productId,
      {required int storeId,
      required String productUrl,
      Map<String, dynamic>? scrapeConfig}) async {
    final body = <String, dynamic>{
      'store_id': storeId,
      'product_url': productUrl,
    };
    if (scrapeConfig != null) body['scrape_config'] = scrapeConfig;
    final res = await _dio.post('/products/$productId/stores', data: body);
    return ProductStoreSummary.fromJson(res.data);
  }

  Future<void> removeStoreLink(int productId, int productStoreId) =>
      _dio.delete('/products/$productId/stores/$productStoreId');

  Future<void> upsertOverride(
    int productId,
    int productStoreId, {
    double? manualPrice,
    String? manualStockStatus,
    String? overrideNote,
  }) =>
      _dio.put('/products/$productId/stores/$productStoreId/override', data: {
        'manual_price': manualPrice,
        'manual_stock_status': manualStockStatus,
        'override_note': overrideNote,
      });

  Future<void> clearOverride(int productId, int productStoreId) =>
      _dio.delete('/products/$productId/stores/$productStoreId/override');

  // ── Stores ───────────────────────────────────────────────────────────────────

  Future<List<Store>> getStores() async {
    final res = await _dio.get('/stores/');
    return (res.data as List).map((j) => Store.fromJson(j)).toList();
  }

  Future<Store> createStore(String name, String baseUrl) async {
    final res = await _dio.post('/stores/', data: {'name': name, 'base_url': baseUrl});
    return Store.fromJson(res.data);
  }

  Future<void> deleteStore(int id) => _dio.delete('/stores/$id');

  // ── Logs ─────────────────────────────────────────────────────────────────────

  Future<List<PriceLog>> getProductLogs(int productId,
      {DateTime? from, DateTime? to}) async {
    final res = await _dio.get('/logs/product/$productId', queryParameters: {
      if (from != null) 'from': from.toIso8601String().substring(0, 10),
      if (to != null) 'to': to.toIso8601String().substring(0, 10),
    });
    return (res.data as List).map((j) => PriceLog.fromJson(j)).toList();
  }

  // ── Scraper ──────────────────────────────────────────────────────────────────

  Future<void> triggerScrape(int productStoreId) =>
      _dio.post('/scraper/scrape/$productStoreId');

  Future<void> triggerScrapeAll() => _dio.post('/scraper/scrape-all');

  // ── Activity ─────────────────────────────────────────────────────────────────

  Future<List<ActivityEntry>> getActivity({
    int limit = 100,
    int offset = 0,
    String? changeType,
  }) async {
    final res = await _dio.get('/activity/', queryParameters: {
      'limit': limit,
      'offset': offset,
      'change_type': ?changeType,
    });
    return (res.data as List).map((j) => ActivityEntry.fromJson(j)).toList();
  }

  // ── Health ───────────────────────────────────────────────────────────────────

  Future<bool> isBackendOnline() async {
    try {
      await _dio.get('/health');
      return true;
    } catch (_) {
      return false;
    }
  }
}
