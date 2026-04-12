import 'package:flutter/foundation.dart';
import '../models/activity_entry.dart';
import '../services/api_service.dart';

class ActivityProvider extends ChangeNotifier {
  final ApiService _api;
  ActivityProvider(this._api);

  List<ActivityEntry> _entries = [];
  bool _loading = false;
  String? _error;
  String? _filter; // null = all change types

  List<ActivityEntry> get entries => _entries;
  bool get loading => _loading;
  String? get error => _error;
  String? get filter => _filter;

  Future<void> load() async {
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      _entries = await _api.getActivity(changeType: _filter);
    } catch (e) {
      _error = e.toString();
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  void setFilter(String? changeType) {
    if (_filter == changeType) return;
    _filter = changeType;
    load();
  }
}
