class Store {
  final int id;
  final String name;
  final String baseUrl;
  final DateTime createdAt;

  const Store({
    required this.id,
    required this.name,
    required this.baseUrl,
    required this.createdAt,
  });

  factory Store.fromJson(Map<String, dynamic> j) => Store(
        id: j['id'],
        name: j['name'],
        baseUrl: j['base_url'],
        createdAt: DateTime.parse(j['created_at']),
      );

  Map<String, dynamic> toJson() => {
        'name': name,
        'base_url': baseUrl,
      };
}
