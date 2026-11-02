import 'models.dart';
import 'money.dart';

/// Platforma ulushi oluvchisining identifikatori.
const String platformRecipientId = 'platform';

/// Bitim tushumidan vositachi (1%) va platforma ulushini hisoblaydi.
///
/// Asosiy tamoyillar:
/// * Faqat **tasdiqlangan** hisobot bo'yicha hisoblanadi.
/// * Natija — yangi ledger yozuvlari; mavjud yozuvlar o'zgartirilmaydi.
/// * **Idempotent**: bir xil hisobotni qayta hisoblash yangi yozuv bermaydi.
/// * Hisobot tuzatilsa, faqat farq `adjustment` sifatida yoziladi.
/// * Vositachi chegarasi (`introducerCap`) va muddat (`termMonths`) hisobga olinadi.
class RevenueShareCalculator {
  final DateTime Function() _clock;

  RevenueShareCalculator({DateTime Function()? clock}) : _clock = clock ?? DateTime.now;

  /// Tushum va ulush bo'yicha oldindan ko'rsatish (UI uchun):
  /// "Tushum 100 mln bo'lsa, siz 1 mln olasiz".
  static Money previewShare(Money revenue, {int bps = 100}) => revenue.percentBps(bps);

  /// [report] bo'yicha qo'shilishi kerak bo'lgan yangi ledger yozuvlarini qaytaradi.
  ///
  /// [ledger] — shu bitim bo'yicha (yoki barcha) mavjud yozuvlar.
  List<LedgerEntry> calculate({
    required Deal deal,
    required MonthlyReport report,
    required Iterable<LedgerEntry> ledger,
  }) {
    if (report.dealId != deal.id) {
      throw ArgumentError('Hisobot boshqa bitimga tegishli: ${report.dealId} != ${deal.id}');
    }
    if (report.status != ReportStatus.verified) {
      throw StateError('Hisobot tasdiqlanmagan (${report.status.name}). Avval tekshiring.');
    }
    if (!deal.coversPeriod(report.period)) {
      return const []; // bitim muddatidan tashqari
    }

    final dealLedger = ledger.where((e) => e.dealId == deal.id).toList();
    final now = _clock();
    final result = <LedgerEntry>[];

    for (final role in PayoutRole.values) {
      final bps = role == PayoutRole.introducer ? deal.introducerBps : deal.platformBps;
      final recipientId = role == PayoutRole.introducer ? deal.introducerId : platformRecipientId;

      final roleEntries = dealLedger.where((e) => e.role == role);
      final samePeriod = roleEntries.where((e) => e.period == report.period).toList();
      final alreadyForPeriod = _sum(samePeriod);

      var target = report.grossRevenue.percentBps(bps);

      final cap = deal.introducerCap;
      if (role == PayoutRole.introducer && cap != null) {
        final paidOtherPeriods = _sum(roleEntries.where((e) => e.period != report.period));
        final remaining = Money.max(const Money.zero(), cap - paidOtherPeriods);
        target = Money.min(target, remaining);
      }

      final delta = target - alreadyForPeriod;
      if (delta.isZero) continue;

      result.add(LedgerEntry(
        id: '${deal.id}_${report.period}_${role.name}_${samePeriod.length + 1}',
        dealId: deal.id,
        period: report.period,
        role: role,
        recipientId: recipientId,
        amount: delta,
        type: samePeriod.isEmpty ? EntryType.regular : EntryType.adjustment,
        reportVersion: report.version,
        baseRevenue: report.grossRevenue,
        createdAt: now,
      ));
    }
    return result;
  }

  /// Muddati o'tgan, lekin tasdiqlangan hisoboti yo'q oylar.
  /// [current] — joriy oy (u hali tugamagani uchun hisobga olinmaydi).
  List<Period> missingPeriods({
    required Deal deal,
    required Iterable<MonthlyReport> reports,
    required Period current,
  }) {
    final verified = reports
        .where((r) => r.dealId == deal.id && r.status == ReportStatus.verified)
        .map((r) => r.period)
        .toSet();
    final missing = <Period>[];
    for (var p = deal.firstPeriod; p.isBefore(current) && deal.coversPeriod(p); p = p.next) {
      if (!verified.contains(p)) missing.add(p);
    }
    return missing;
  }

  /// Bitta oluvchining daromadi: jami va oylar bo'yicha.
  static EarningsSummary summarize(Iterable<LedgerEntry> ledger, String recipientId) {
    final mine = ledger.where((e) => e.recipientId == recipientId);
    final byPeriod = <Period, Money>{};
    final byDeal = <String, Money>{};
    for (final e in mine) {
      byPeriod[e.period] = (byPeriod[e.period] ?? const Money.zero()) + e.amount;
      byDeal[e.dealId] = (byDeal[e.dealId] ?? const Money.zero()) + e.amount;
    }
    final sortedPeriods = byPeriod.keys.toList()..sort();
    return EarningsSummary(
      recipientId: recipientId,
      total: _sum(mine),
      byPeriod: {for (final p in sortedPeriods) p: byPeriod[p]!},
      byDeal: byDeal,
    );
  }

  static Money _sum(Iterable<LedgerEntry> entries) =>
      entries.fold(const Money.zero(), (acc, e) => acc + e.amount);
}

class EarningsSummary {
  final String recipientId;
  final Money total;
  final Map<Period, Money> byPeriod;
  final Map<String, Money> byDeal;

  const EarningsSummary({
    required this.recipientId,
    required this.total,
    required this.byPeriod,
    required this.byDeal,
  });
}
