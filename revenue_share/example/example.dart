import 'package:revenue_share/revenue_share.dart';

/// Misol: muzqaymoq biznesi, 3 oylik hisobot.
void main() {
  final deal = Deal(
    id: 'muzqaymoq-001',
    entrepreneurId: 'tadbirkor_ali',
    investorId: 'investor_vali',
    introducerId: 'vositachi_sardor',
    firstPeriod: Period(2026, 1),
    introducerBps: 100, // 1%
    platformBps: 50, // 0.5%
    termMonths: 36, // 3 yil
  );

  final calc = RevenueShareCalculator();
  final ledger = <LedgerEntry>[];

  final reports = [
    MonthlyReport(dealId: deal.id, period: Period(2026, 1), grossRevenue: Money.som(80000000), status: ReportStatus.verified),
    MonthlyReport(dealId: deal.id, period: Period(2026, 2), grossRevenue: Money.som(95000000), status: ReportStatus.verified),
    MonthlyReport(dealId: deal.id, period: Period(2026, 3), grossRevenue: Money.som(110000000), status: ReportStatus.verified),
  ];

  for (final r in reports) {
    final entries = calc.calculate(deal: deal, report: r, ledger: ledger);
    ledger.addAll(entries); // real ilovada: serverda bitta tranzaksiyada saqlang
  }

  // Fevral hisoboti tuzatildi: 95 mln emas, 100 mln
  final fixed = reports[1].copyWith(grossRevenue: Money.som(100000000), version: 2);
  ledger.addAll(calc.calculate(deal: deal, report: fixed, ledger: ledger));

  for (final e in ledger) {
    print('${e.period}  ${e.role.name.padRight(10)}  ${e.type.name.padRight(10)}  ${e.amount}');
  }

  final s = RevenueShareCalculator.summarize(ledger, 'vositachi_sardor');
  print('\nVositachi jami: ${s.total}');
  print('Kelgusi oy uchun taxmin (120 mln tushumda): '
      '${RevenueShareCalculator.previewShare(Money.som(120000000))}');
  print('Hisobot topshirilmagan oylar: '
      '${calc.missingPeriods(deal: deal, reports: reports, current: Period(2026, 6))}');
}
