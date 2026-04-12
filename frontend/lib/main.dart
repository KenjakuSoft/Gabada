import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'services/api_service.dart';
import 'providers/products_provider.dart';
import 'providers/categories_provider.dart';
import 'providers/activity_provider.dart';
import 'screens/home_screen.dart';
import 'screens/activity_screen.dart';
import 'theme/app_theme.dart';

void main() {
  runApp(const GabadaApp());
}

class GabadaApp extends StatelessWidget {
  const GabadaApp({super.key});

  @override
  Widget build(BuildContext context) {
    final api = ApiService();

    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => ProductsProvider(api)),
        ChangeNotifierProvider(create: (_) => CategoriesProvider(api)),
        ChangeNotifierProvider(create: (_) => ActivityProvider(api)),
      ],
      child: MaterialApp(
        title: 'Gabada',
        debugShowCheckedModeBanner: false,
        theme: lightTheme,
        darkTheme: darkTheme,
        themeMode: ThemeMode.dark,
        home: const _Shell(),
      ),
    );
  }
}

class _Shell extends StatefulWidget {
  const _Shell();

  @override
  State<_Shell> createState() => _ShellState();
}

class _ShellState extends State<_Shell> {
  int _index = 0;

  static const _screens = [
    HomeScreen(),
    ActivityScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _index,
        children: _screens,
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.storefront_outlined),
            selectedIcon: Icon(Icons.storefront),
            label: 'Products',
          ),
          NavigationDestination(
            icon: Icon(Icons.timeline_outlined),
            selectedIcon: Icon(Icons.timeline),
            label: 'Activity',
          ),
        ],
      ),
    );
  }
}
