import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gabada/main.dart';

void main() {
  testWidgets('App smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const GabadaApp());
    expect(find.byType(MaterialApp), findsOneWidget);
  });
}
