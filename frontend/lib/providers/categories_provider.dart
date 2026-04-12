import 'package:flutter/foundation.dart' hide Category;
import '../models/category.dart';
import '../services/api_service.dart';

class CategoriesProvider extends ChangeNotifier {
  final ApiService _api;
  CategoriesProvider(this._api);

  List<Category> _categories = [];
  bool _loading = false;

  List<Category> get categories => _categories;
  bool get loading => _loading;

  Future<void> load() async {
    _loading = true;
    notifyListeners();
    try {
      _categories = await _api.getCategories();
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<Category?> create(String name, String color) async {
    final c = await _api.createCategory(name, color);
    _categories.add(c);
    _categories.sort((a, b) => a.name.compareTo(b.name));
    notifyListeners();
    return c;
  }

  Future<void> delete(int id) async {
    await _api.deleteCategory(id);
    _categories.removeWhere((c) => c.id == id);
    notifyListeners();
  }
}
