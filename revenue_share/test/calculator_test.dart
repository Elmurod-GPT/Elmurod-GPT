import 'package:revenue_share/revenue_share.dart';
import 'package:test/test.dart';

void main() {
  final fixedNow = DateTime.utc(2026, 11, 2);
  final calc = RevenueShareCalculator(clock: () => fixedNow);

  Deal deal({int? term, Money? cap, int platformBps = 50}) => Deal(
        id: 'deal1',
        entrepreneurId: 'tadbirkor',
        investorId: 'investor',
        introducerId: 'vositachi',
        firstPeriod: Period(2026, 1),
        platformBps: platformBps,
        termMonths: term,
        introducerCap: cap,
      );

  MonthlyReport report(Period p, num som, {ReportStatus status = ReportStatus.verified, int version = 1}) =>
      MonthlyReport(dealId: 'deal1', period: p, grossRevenue: Money.som(som), status: status, version: version);

  group('Money', () {
    test('1% hisoblash', () {
      expect(Money.som(100000000).percentBps(100), Money.som(1000000));
    });
    test('tiyinga pastga yaxlitlanadi', () {
      expect(const Money(12345).percentBps(100), const Money(123)); // 123.45 → 123
    });
    test('katta summada toshib ketmaydi', () {
      final huge = Money.som(5000000000000); // 5 trln so'm
      expect(huge.percentBps(100), Money.som(50000000000));
    });
    test('format', () {
      expect(Money.som(1234567.89).format(), "1 234 567,89 so'm");
      expect(const Money(-5).format(withCurrency: false), '-0,05');
      expect(const Money.zero().format(), "0,00 so'm");
    });
  });

  group('Deal validatsiya', () {
    test('ulushlar 100% dan oshmasin', () {
      expect(
        () => Deal(id: 'd', entrepreneurId: 'a', investorId: 'b', introducerId: 'c', firstPeriod: Period(2026, 1), introducerBps: 9000, platformBps: 2000),
        throwsArgumentError,
      );
    });
    test("vositachi tadbirkorning o'zi bo'lmasin", () {
      expect(
        () => Deal(id: 'd', entrepreneurId: 'a', investorId: 'b', introducerId: 'a', firstPeriod: Period(2026, 1)),
        throwsArgumentError,
      );
    });
    test('muddat', () {
      final d = deal(term: 36);
      expect(d.lastPeriod, Period(2028, 12));
      expect(d.coversPeriod(Period(2025, 12)), isFalse);
      expect(d.coversPeriod(Period(2028, 12)), isTrue);
      expect(d.coversPeriod(Period(2029, 1)), isFalse);
    });
  });

  group('calculate', () {
    test("vositachiga 1%, platformaga 0.5%", () {
      final entries = calc.calculate(deal: deal(), report: report(Period(2026, 3), 100000000), ledger: []);
      expect(entries, hasLength(2));
      final intro = entries.firstWhere((e) => e.role == PayoutRole.introducer);
      final plat = entries.firstWhere((e) => e.role == PayoutRole.platform);
      expect(intro.amount, Money.som(1000000));
      expect(intro.recipientId, 'vositachi');
      expect(intro.type, EntryType.regular);
      expect(plat.amount, Money.som(500000));
      expect(plat.recipientId, platformRecipientId);
    });

    test('tasdiqlanmagan hisobot rad etiladi', () {
      expect(
        () => calc.calculate(deal: deal(), report: report(Period(2026, 3), 100, status: ReportStatus.submitted), ledger: []),
        throwsStateError,
      );
    });

    test('boshqa bitim hisoboti rad etiladi', () {
      final r = MonthlyReport(dealId: 'boshqa', period: Period(2026, 3), grossRevenue: Money.som(1), status: ReportStatus.verified);
      expect(() => calc.calculate(deal: deal(), report: r, ledger: []), throwsArgumentError);
    });

    test('muddatdan tashqari oy — hech narsa', () {
      expect(calc.calculate(deal: deal(term: 12), report: report(Period(2027, 1), 100000000), ledger: []), isEmpty);
    });

    test('qayta hisoblash yangi yozuv bermaydi (idempotent)', () {
      final r = report(Period(2026, 3), 100000000);
      final first = calc.calculate(deal: deal(), report: r, ledger: []);
      expect(calc.calculate(deal: deal(), report: r, ledger: first), isEmpty);
    });

    test("hisobot ko'paytirib tuzatilsa — musbat adjustment", () {
      final ledger = calc.calculate(deal: deal(), report: report(Period(2026, 3), 100000000), ledger: []);
      final adj = calc.calculate(deal: deal(), report: report(Period(2026, 3), 120000000, version: 2), ledger: ledger);
      final intro = adj.firstWhere((e) => e.role == PayoutRole.introducer);
      expect(intro.type, EntryType.adjustment);
      expect(intro.amount, Money.som(200000));
      expect(intro.reportVersion, 2);
      expect(intro.id, endsWith('_2'));
    });

    test('hisobot kamaytirib tuzatilsa — manfiy adjustment', () {
      final ledger = calc.calculate(deal: deal(), report: report(Period(2026, 3), 100000000), ledger: []);
      final adj = calc.calculate(deal: deal(), report: report(Period(2026, 3), 80000000, version: 2), ledger: ledger);
      expect(adj.firstWhere((e) => e.role == PayoutRole.introducer).amount, Money.som(-200000));
    });

    test('vositachi chegarasi (cap)', () {
      final d = deal(cap: Money.som(1500000));
      final m1 = calc.calculate(deal: d, report: report(Period(2026, 1), 100000000), ledger: []);
      final m2 = calc.calculate(deal: d, report: report(Period(2026, 2), 100000000), ledger: m1);
      final m3 = calc.calculate(deal: d, report: report(Period(2026, 3), 100000000), ledger: [...m1, ...m2]);
      expect(m2.firstWhere((e) => e.role == PayoutRole.introducer).amount, Money.som(500000));
      expect(m3.where((e) => e.role == PayoutRole.introducer), isEmpty);
      // platforma ulushiga chegara ta'sir qilmaydi
      expect(m3.firstWhere((e) => e.role == PayoutRole.platform).amount, Money.som(500000));
      final s = RevenueShareCalculator.summarize([...m1, ...m2, ...m3], 'vositachi');
      expect(s.total, Money.som(1500000));
    });

    test("nol tushum — yozuv yo'q", () {
      expect(calc.calculate(deal: deal(), report: report(Period(2026, 4), 0), ledger: []), isEmpty);
    });
  });

  group('missingPeriods', () {
    test("hisobot topshirilmagan oylar", () {
      final reports = [
        report(Period(2026, 1), 1),
        report(Period(2026, 3), 1),
        report(Period(2026, 4), 1, status: ReportStatus.rejected),
      ];
      final missing = calc.missingPeriods(deal: deal(), reports: reports, current: Period(2026, 6));
      expect(missing, [Period(2026, 2), Period(2026, 4), Period(2026, 5)]);
    });
  });

  group('summarize va JSON', () {
    test('oylar va bitimlar bo\'yicha', () {
      final l1 = calc.calculate(deal: deal(), report: report(Period(2026, 2), 50000000), ledger: []);
      final l2 = calc.calculate(deal: deal(), report: report(Period(2026, 1), 30000000), ledger: l1);
      final s = RevenueShareCalculator.summarize([...l1, ...l2], 'vositachi');
      expect(s.total, Money.som(800000));
      expect(s.byPeriod.keys.toList(), [Period(2026, 1), Period(2026, 2)]);
      expect(s.byDeal['deal1'], Money.som(800000));
    });

    test('JSON aylanishi', () {
      final e = calc.calculate(deal: deal(), report: report(Period(2026, 2), 50000000), ledger: []).first;
      final back = LedgerEntry.fromJson(e.toJson());
      expect(back.amount, e.amount);
      expect(back.period, e.period);
      expect(back.role, e.role);
      final d = deal(term: 24, cap: Money.som(10));
      final d2 = Deal.fromJson(d.toJson());
      expect(d2.lastPeriod, d.lastPeriod);
      expect(d2.introducerCap, d.introducerCap);
      final r = report(Period(2026, 2), 7);
      expect(MonthlyReport.fromJson(r.toJson()).grossRevenue, r.grossRevenue);
    });
  });
}
