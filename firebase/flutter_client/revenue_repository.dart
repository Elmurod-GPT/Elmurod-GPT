// Flutter ilova uchun: Firebase backend bilan ishlash.
//
// pubspec.yaml:
//   dependencies:
//     cloud_firestore: ^5.0.0
//     cloud_functions: ^5.0.0
//     firebase_auth: ^5.0.0
//     revenue_share:
//       path: ../revenue_share
//
// Muhim: ilova hech qachon ledger/earnings'ga o'zi yozmaydi (qoidalar ruxsat bermaydi).
// Barcha o'zgarishlar Cloud Functions orqali.

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:revenue_share/revenue_share.dart';

class RevenueRepository {
  RevenueRepository({FirebaseFirestore? db, FirebaseFunctions? functions, FirebaseAuth? auth})
      : _db = db ?? FirebaseFirestore.instance,
        _fn = functions ?? FirebaseFunctions.instanceFor(region: 'europe-west1'),
        _auth = auth ?? FirebaseAuth.instance;

  final FirebaseFirestore _db;
  final FirebaseFunctions _fn;
  final FirebaseAuth _auth;

  String get _uid {
    final u = _auth.currentUser;
    if (u == null) throw StateError('Tizimga kirilmagan');
    return u.uid;
  }

  // ---------- O'qish ----------

  /// Foydalanuvchi ishtirok etgan bitimlar.
  Stream<List<Deal>> watchMyDeals() => _db
      .collection('deals')
      .where('participants', arrayContains: _uid) // qoidalar shu filtrni talab qiladi
      .orderBy('createdAt', descending: true)
      .snapshots()
      .map((s) => s.docs.map((d) => Deal.fromJson({...d.data(), 'id': d.id})).toList());

  /// Bitim hisobotlari.
  Stream<List<MonthlyReport>> watchReports(String dealId) => _db
      .collection('deals/$dealId/reports')
      .snapshots()
      .map((s) => s.docs.map((d) => MonthlyReport.fromJson(d.data())).toList()
        ..sort((a, b) => b.period.compareTo(a.period)));

  /// Mening ledger yozuvlarim (vositachi daromadi tarixi).
  Stream<List<LedgerEntry>> watchMyLedger() => _db
      .collection('ledger')
      .where('recipientId', isEqualTo: _uid) // qoidalar shu filtrni talab qiladi
      .orderBy('period', descending: true)
      .snapshots()
      .map((s) => s.docs.map((d) => LedgerEntry.fromJson(d.data())).toList());

  /// Jami daromad (server hisoblagan).
  Stream<Money> watchMyTotal() => _db
      .doc('earnings/$_uid')
      .snapshots()
      .map((s) => Money(((s.data()?['totalTiyin']) as num?)?.toInt() ?? 0));

  // ---------- Amallar (Cloud Functions) ----------

  /// Tadbirkor oylik tushumni topshiradi. Qaytaradi: hisobot versiyasi.
  Future<int> submitReport({
    required String dealId,
    required Period period,
    required Money grossRevenue,
    String? attachmentPath, // Firebase Storage'dagi kassa/bank hujjati yo'li
  }) async {
    final res = await _call('submitReport', {
      'dealId': dealId,
      'period': period.toString(),
      'grossRevenueTiyin': grossRevenue.tiyin,
      'attachmentPath': attachmentPath,
    });
    return (res['version'] as num).toInt();
  }

  /// Admin: hisobotni tasdiqlash yoki rad etish.
  Future<void> reviewReport({
    required String dealId,
    required Period period,
    required bool approve,
    required int expectedVersion,
    String? note,
  }) =>
      _call('reviewReport', {
        'dealId': dealId,
        'period': period.toString(),
        'approve': approve,
        'expectedVersion': expectedVersion,
        'note': note,
      });

  /// Admin: yangi bitim.
  Future<String> createDeal({
    required String entrepreneurId,
    required String investorId,
    required String introducerId,
    required Period firstPeriod,
    int introducerBps = 100,
    int platformBps = 50,
    int? termMonths = 36,
    Money? introducerCap,
  }) async {
    final res = await _call('createDeal', {
      'entrepreneurId': entrepreneurId,
      'investorId': investorId,
      'introducerId': introducerId,
      'firstPeriod': firstPeriod.toString(),
      'introducerBps': introducerBps,
      'platformBps': platformBps,
      'termMonths': termMonths,
      'introducerCapTiyin': introducerCap?.tiyin,
    });
    return res['dealId'] as String;
  }

  Future<Map<String, dynamic>> _call(String name, Map<String, dynamic> data) async {
    try {
      final r = await _fn.httpsCallable(name).call<Map<String, dynamic>>(data);
      return Map<String, dynamic>.from(r.data);
    } on FirebaseFunctionsException catch (e) {
      throw RevenueException(e.code, e.message ?? 'Xatolik');
    }
  }
}

class RevenueException implements Exception {
  RevenueException(this.code, this.message);
  final String code; // permission-denied, invalid-argument, aborted ...
  final String message; // serverdan o'zbekcha xabar
  @override
  String toString() => message;
}

// ---------- Misol: vositachi daromadi ekrani ----------

class IntroducerEarningsScreen extends StatelessWidget {
  const IntroducerEarningsScreen({super.key, required this.repo});
  final RevenueRepository repo;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Mening daromadim')),
      body: Column(
        children: [
          StreamBuilder<Money>(
            stream: repo.watchMyTotal(),
            builder: (_, s) => Card(
              margin: const EdgeInsets.all(16),
              child: ListTile(
                title: const Text('Jami daromad'),
                subtitle: Text(
                  s.data?.format() ?? '...',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
              ),
            ),
          ),
          Expanded(
            child: StreamBuilder<List<LedgerEntry>>(
              stream: repo.watchMyLedger(),
              builder: (_, s) {
                if (s.hasError) return Center(child: Text('Xatolik: ${s.error}'));
                final items = s.data;
                if (items == null) return const Center(child: CircularProgressIndicator());
                if (items.isEmpty) return const Center(child: Text("Hozircha daromad yo'q"));
                return ListView.builder(
                  itemCount: items.length,
                  itemBuilder: (_, i) {
                    final e = items[i];
                    return ListTile(
                      leading: Icon(e.type == EntryType.adjustment ? Icons.edit_note : Icons.payments),
                      title: Text('${e.period} — ${e.amount.format()}'),
                      subtitle: Text(
                        'Tushum: ${e.baseRevenue.format()}'
                        '${e.type == EntryType.adjustment ? ' (tuzatish)' : ''}',
                      ),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
