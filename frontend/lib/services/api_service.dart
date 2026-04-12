import 'package:dio/dio.dart';
import '../models/product.dart';
import '../models/store.dart';
import '../models/price_log.dart';

class ApiService {
  static const _base = 'http://localhost:8000';

  final Dio _dio = Dio(BaseOptions(
    baseUrl: _base,
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 30),
  ));

  // ── Products ────────────────────────────────────────────────────────────────

  Future<List<Product>> getProducts() async {
    final res = await _dio.get('/products/');
    return (res.data as List).map((j) => Product.fromJson(j)).toList();
  }

  Future<Product> getProduct(int id) async {
    final res = await _dio.get('/products/$id');
    return Product.fromJson(res.data);
  }

  Future<Product> createProduct(String canonicalName, {String? imageUrl}) async {
    final res = await _dio.post('/products/', data: {
      'canonical_name': canonicalName,
      'image_url': imageUrl,
    });
    return Product.fromJson(res.data);
  }

  Future<Product> updateProduct(int id, String canonicalName, {String? imageUrl}) async {
    final res = await _dio.patch('/products/$id', data: {
      'canonical_name': canonicalName,
      'image_url': imageUrl,
    });
    return Product.fromJson(res.data);
  }

  Future<void> deleteProduct(int id) => _dio.delete('/products/$id');

  Future<ProductStoreSummary> addStoreLink(
    int productId, {
    required int storeId,
    required String productUrl,
    Map<String, dynamic>? scrapeConfig,
  }) async {
    final res = await _dio.post('/products/$productId/stores', data: {
      'store_id': storeId,
      'product_url': productUrl,
      'scrape_config': scrapeConfig,
    });
    return ProductStoreSummary.fromJson(res.data);
  }

  Future<void> removeStoreLink(int productId, int productStoreId) =>
      _dio.delete('/products/$productId/stores/$productStoreId');

  // ── Stores ──────────────────────────────────────────────────────────────────

  Future<List<Store>> getStores() async {
    final res = await _dio.get('/stores/');
    return (res.data as List).map((j) => Store.fromJson(j)).toList();
  }

  Future<Store> createStore(String name, String baseUrl) async {
    final res = await _dio.post('/stores/', data: {
      'name': name,
      'base_url': baseUrl,
    });
    return Store.fromJson(res.data);
  }

  Future<void> deleteStore(int id) => _dio.delete('/stores/$id');

  // ── Logs ────────────────────────────────────────────────────────────────────

  Future<List<PriceLog>> getLogs(
    int productStoreId, {
    DateTime? from,
    DateTime? to,
  }) async {
    final res = await _dio.get('/logs/', queryParameters: {
      'product_store_id': productStoreId,
      if (from != null) 'from': from.toIso8601String().substring(0, 10),
      if (to != null) 'to': to.toIso8601String().substring(0, 10),
    });
    return (res.data as List).map((j) => PriceLog.fromJson(j)).toList();
  }

  Future<List<PriceLog>> getProductLogs(
    int productId, {
    DateTime? from,
    DateTime? to,
  }) async {
    final res = await _dio.get('/logs/product/$productId', queryParameters: {
      if (from != null) 'from': from.toIso8601String().substring(0, 10),
      if (to != null) 'to': to.toIso8601String().substring(0, 10),
    });
    return (res.data as List).map((j) => PriceLog.fromJson(j)).toList();
  }

  // ── Scraper ─────────────────────────────────────────────────────────────────

  Future<void> triggerScrape(int productStoreId) =>
      _dio.post('/scraper/scrape/$productStoreId');

  Future<void> triggerScrapeAll() => _dio.post('/scraper/scrape-all');

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
