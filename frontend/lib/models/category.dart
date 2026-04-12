import 'package:flutter/material.dart';

class Category {
  final int id;
  final String name;
  final String color;
  final DateTime createdAt;

  const Category({
    required this.id,
    required this.name,
    required this.color,
    required this.createdAt,
  });

  factory Category.fromJson(Map<String, dynamic> j) => Category(
        id: j['id'],
        name: j['name'],
        color: j['color'] ?? '#6C63FF',
        createdAt: DateTime.parse(j['created_at']),
      );

  Color get flutterColor {
    try {
      final hex = color.replaceFirst('#', '');
      return Color(int.parse('FF$hex', radix: 16));
    } catch (_) {
      return const Color(0xFF6C63FF);
    }
  }
}
