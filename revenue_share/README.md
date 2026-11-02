# revenue_share — 1% ulush hisoblash moduli

Tadbirkor–investor bitimi tushumidan **vositachiga 1%** va **platformaga x%** ulushni hisoblaydi.
Toza Dart: Flutter ilovada ham, Dart serverda ham ishlaydi.

## Ulash

Flutter loyihangizning `pubspec.yaml` fayliga:

```yaml
dependencies:
  revenue_share:
    path: ../revenue_share   # yoki git orqali
```

## Ishlatish

```dart
import 'package:revenue_share/revenue_share.dart';

final deal = Deal(
  id: 'muzqaymoq-001',
  entrepreneurId: 'ali', investorId: 'vali', introducerId: 'sardor',
  firstPeriod: Period(2026, 1),
  introducerBps: 100,   // 1%
  platformBps: 50,      // 0.5%
  termMonths: 36,       // 3 yil (null — muddatsiz)
  introducerCap: null,  // vositachiga jami chegara (ixtiyoriy)
);

final calc = RevenueShareCalculator();
final newEntries = calc.calculate(deal: deal, report: verifiedReport, ledger: existingEntries);
// newEntries'ni bazaga saqlang (faqat qo'shiladi, o'zgartirilmaydi)

final summary = RevenueShareCalculator.summarize(allEntries, 'sardor');
Text('Jami daromad: ${summary.total}'); // 2 900 000,00 so'm
```

## Qoidalar

- Pul **tiyinda** (`int`) saqlanadi, `double` ishlatilmaydi.
- Ulush tiyingacha pastga yaxlitlanadi — tushumdan ortiq pul hech qachon taqsimlanmaydi.
- Faqat `verified` (tasdiqlangan) hisobot hisoblanadi.
- Hisobot tuzatilsa, farq `adjustment` yozuvi sifatida qo'shiladi; bir xil hisobotni qayta hisoblash yangi yozuv bermaydi.
- `missingPeriods()` — hisobot topshirilmagan oylarni topadi (eslatma yuborish uchun).

## ⚠️ Muhim: hisob serverda bajarilsin

Telefondagi kodni o'zgartirish mumkin. Pulga oid yakuniy hisob va ledger'ga yozish
**serverda** (Dart backend, yoki shu mantiq ko'chirilgan Cloud Functions va h.k.) bajarilishi kerak.
Flutter ilovada bu moduldan faqat ko'rsatish va oldindan hisoblash (`previewShare`) uchun foydalaning.

## Test

```bash
dart pub get
dart test
dart run example/example.dart
```
