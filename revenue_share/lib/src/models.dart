import 'money.dart';

/// Hisobot davri: yil va oy.
class Period implements Comparable<Period> {
  final int year;
  final int month; // 1..12

  Period(this.year, this.month) {
    if (month < 1 || month > 12) {
      throw ArgumentError.value(month, 'month', "Oy 1 dan 12 gacha bo'lishi kerak");
    }
  }

  factory Period.fromDate(DateTime d) => Period(d.year, d.month);

  /// `"2026-11"` ko'rinishidagi matndan.
  factory Period.parse(String s) {
    final parts = s.split('-');
    if (parts.length != 2) throw FormatException("Noto'g'ri davr: $s");
    return Period(int.parse(parts[0]), int.parse(parts[1]));
  }

  int get _index => year * 12 + (month - 1);

  Period addMonths(int n) {
    final i = _index + n;
    return Period(i ~/ 12, i % 12 + 1);
  }

  Period get next => addMonths(1);
  Period get previous => addMonths(-1);

  /// [other] dan shu davrgacha necha oy o'tgan.
  int monthsSince(Period other) => _index - other._index;

  bool isBefore(Period other) => _index < other._index;
  bool isAfter(Period other) => _index > other._index;

  @override
  int compareTo(Period other) => _index.compareTo(other._index);

  @override
  bool operator ==(Object other) => other is Period && other._index == _index;

  @override
  int get hashCode => _index.hashCode;

  @override
  String toString() => '$year-${month.toString().padLeft(2, '0')}';
}

/// Tadbirkor, investor va vositachi o'rtasidagi bitim.
class Deal {
  final String id;
  final String entrepreneurId;
  final String investorId;

  /// Tadbirkor va investorni tanishtirgan platforma mijozi.
  final String introducerId;

  /// Vositachi ulushi, basis point'da. 1% = 100.
  final int introducerBps;

  /// Platforma ulushi, basis point'da. 0.5% = 50.
  final int platformBps;

  /// Ulush hisoblanadigan birinchi oy.
  final Period firstPeriod;

  /// Necha oy davomida ulush to'lanadi. `null` — muddatsiz.
  final int? termMonths;

  /// Vositachiga jami to'lanadigan eng katta summa. `null` — chegarasiz.
  final Money? introducerCap;

  Deal({
    required this.id,
    required this.entrepreneurId,
    required this.investorId,
    required this.introducerId,
    required this.firstPeriod,
    this.introducerBps = 100,
    this.platformBps = 0,
    this.termMonths,
    this.introducerCap,
  }) {
    if (introducerBps < 0 || platformBps < 0) {
      throw ArgumentError("Ulush manfiy bo'lishi mumkin emas");
    }
    if (introducerBps + platformBps > Money.basisPointsInWhole) {
      throw ArgumentError("Ulushlar yig'indisi 100% dan oshmasligi kerak");
    }
    if (termMonths != null && termMonths! <= 0) {
      throw ArgumentError.value(termMonths, 'termMonths', "Muddat musbat bo'lishi kerak");
    }
    if (introducerCap != null && introducerCap!.isNegative) {
      throw ArgumentError.value(introducerCap, 'introducerCap', "Chegara manfiy bo'lishi mumkin emas");
    }
    if (introducerId == entrepreneurId || introducerId == investorId) {
      throw ArgumentError("Vositachi bitimning o'zi tadbirkor yoki investor bo'la olmaydi");
    }
  }

  /// Ulush to'lanadigan oxirgi oy (`null` — muddatsiz).
  Period? get lastPeriod => termMonths == null ? null : firstPeriod.addMonths(termMonths! - 1);

  /// Shu oy uchun ulush hisoblanadimi?
  bool coversPeriod(Period p) {
    if (p.isBefore(firstPeriod)) return false;
    final last = lastPeriod;
    return last == null || !p.isAfter(last);
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'entrepreneurId': entrepreneurId,
        'investorId': investorId,
        'introducerId': introducerId,
        'introducerBps': introducerBps,
        'platformBps': platformBps,
        'firstPeriod': firstPeriod.toString(),
        'termMonths': termMonths,
        'introducerCapTiyin': introducerCap?.tiyin,
      };

  factory Deal.fromJson(Map<String, dynamic> j) => Deal(
        id: j['id'] as String,
        entrepreneurId: j['entrepreneurId'] as String,
        investorId: j['investorId'] as String,
        introducerId: j['introducerId'] as String,
        introducerBps: (j['introducerBps'] as num?)?.toInt() ?? 100,
        platformBps: (j['platformBps'] as num?)?.toInt() ?? 0,
        firstPeriod: Period.parse(j['firstPeriod'] as String),
        termMonths: (j['termMonths'] as num?)?.toInt(),
        introducerCap: j['introducerCapTiyin'] == null ? null : Money((j['introducerCapTiyin'] as num).toInt()),
      );
}

enum ReportStatus { submitted, verified, rejected }

/// Tadbirkorning oylik tushum hisoboti.
class MonthlyReport {
  final String dealId;
  final Period period;

  /// Yalpi tushum (xarajatlar ayirilmagan).
  final Money grossRevenue;
  final ReportStatus status;

  /// Hisobot tuzatilgan bo'lsa, versiya oshadi (1, 2, 3...).
  final int version;

  MonthlyReport({
    required this.dealId,
    required this.period,
    required this.grossRevenue,
    this.status = ReportStatus.submitted,
    this.version = 1,
  }) {
    if (grossRevenue.isNegative) {
      throw ArgumentError.value(grossRevenue, 'grossRevenue', "Tushum manfiy bo'lishi mumkin emas");
    }
  }

  MonthlyReport copyWith({Money? grossRevenue, ReportStatus? status, int? version}) => MonthlyReport(
        dealId: dealId,
        period: period,
        grossRevenue: grossRevenue ?? this.grossRevenue,
        status: status ?? this.status,
        version: version ?? this.version,
      );

  Map<String, dynamic> toJson() => {
        'dealId': dealId,
        'period': period.toString(),
        'grossRevenueTiyin': grossRevenue.tiyin,
        'status': status.name,
        'version': version,
      };

  factory MonthlyReport.fromJson(Map<String, dynamic> j) => MonthlyReport(
        dealId: j['dealId'] as String,
        period: Period.parse(j['period'] as String),
        grossRevenue: Money((j['grossRevenueTiyin'] as num).toInt()),
        status: ReportStatus.values.byName(j['status'] as String),
        version: (j['version'] as num?)?.toInt() ?? 1,
      );
}

enum PayoutRole { introducer, platform }

enum EntryType {
  /// Oddiy oylik hisob.
  regular,

  /// Hisobot tuzatilganda farq (musbat yoki manfiy).
  adjustment,
}

/// Hisob daftari (ledger) yozuvi. Yozuvlar **hech qachon o'zgartirilmaydi**:
/// tuzatish kerak bo'lsa, yangi `adjustment` yozuvi qo'shiladi.
class LedgerEntry {
  final String id;
  final String dealId;
  final Period period;
  final PayoutRole role;
  final String recipientId;
  final Money amount;
  final EntryType type;

  /// Qaysi hisobot versiyasi asosida yaratilgan.
  final int reportVersion;

  /// Hisoblangan tushum (tekshirish uchun).
  final Money baseRevenue;
  final DateTime createdAt;

  const LedgerEntry({
    required this.id,
    required this.dealId,
    required this.period,
    required this.role,
    required this.recipientId,
    required this.amount,
    required this.type,
    required this.reportVersion,
    required this.baseRevenue,
    required this.createdAt,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'dealId': dealId,
        'period': period.toString(),
        'role': role.name,
        'recipientId': recipientId,
        'amountTiyin': amount.tiyin,
        'type': type.name,
        'reportVersion': reportVersion,
        'baseRevenueTiyin': baseRevenue.tiyin,
        'createdAt': createdAt.toUtc().toIso8601String(),
      };

  factory LedgerEntry.fromJson(Map<String, dynamic> j) => LedgerEntry(
        id: j['id'] as String,
        dealId: j['dealId'] as String,
        period: Period.parse(j['period'] as String),
        role: PayoutRole.values.byName(j['role'] as String),
        recipientId: j['recipientId'] as String,
        amount: Money((j['amountTiyin'] as num).toInt()),
        type: EntryType.values.byName(j['type'] as String),
        reportVersion: (j['reportVersion'] as num).toInt(),
        baseRevenue: Money((j['baseRevenueTiyin'] as num).toInt()),
        createdAt: DateTime.parse(j['createdAt'] as String),
      );

  @override
  String toString() => 'LedgerEntry($id, $period, ${role.name}, $amount, ${type.name})';
}
