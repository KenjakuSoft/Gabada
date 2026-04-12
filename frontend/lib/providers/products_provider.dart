import 'package:flutter/foundation.dart';
import '../models/product.dart';
import '../services/api_service.dart';

class ProductsProvider extends ChangeNotifier {
  final ApiService _api;

  ProductsProvider(this._api);

  List<Product> _products = [];
  bool _loading = false;
  String? _error;

  List<Product> get products => _products;
  bool get loading => _loading;
  String? get error => _error;

  Future<void> load() async {
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      _products = await _api.getProducts();
    } catch (e) {
      _error = e.toString();
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<Product?> createProduct(String name,
      {String? imageUrl, int? categoryId}) async {
    try {
      final p = await _api.createProduct(name,
          imageUrl: imageUrl, categoryId: categoryId);
      _products.add(p);
      notifyListeners();
      return p;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return null;
    }
  }

  Future<void> deleteProduct(int id) async {
    await _api.deleteProduct(id);
    _products.removeWhere((p) => p.id == id);
    notifyListeners();
  }

  Future<void> triggerScrape(int productStoreId) =>
      _api.triggerScrape(productStoreId);

  Future<void> triggerScrapeAll() => _api.triggerScrapeAll();

  /// Refresh a single product after scraping.
  Future<void> refreshProduct(int productId) async {
    final updated = await _api.getProduct(productId);
    final idx = _products.indexWhere((p) => p.id == productId);
    if (idx != -1) {
      _products[idx] = updated;
      notifyListeners();
    }
  }
}
