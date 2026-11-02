/// Pul summasi **tiyinda** saqlanadi (1 so'm = 100 tiyin).
///
/// `double` ishlatilmaydi, chunki u yaxlitlash xatolariga olib keladi
/// (masalan, 0.1 + 0.2 != 0.3). Barcha hisob-kitoblar butun sonlarda.
class Money implements Comparable<Money> {
  /// Summa tiyinda.
  final int tiyin;

  const Money(this.tiyin);

  const Money.zero() : tiyin = 0;

  /// So'mdan yaratish: `Money.som(1500.50)` → 150050 tiyin.
  factory Money.som(num som) => Money((som * 100).round());

  static const int basisPointsInWhole = 10000; // 100% = 10 000 bps

  bool get isZero => tiyin == 0;
  bool get isNegative => tiyin < 0;

  Money operator +(Money other) => Money(tiyin + other.tiyin);
  Money operator -(Money other) => Money(tiyin - other.tiyin);
  Money operator -() => Money(-tiyin);
  bool operator <(Money other) => tiyin < other.tiyin;
  bool operator >(Money other) => tiyin > other.tiyin;
  bool operator <=(Money other) => tiyin <= other.tiyin;
  bool operator >=(Money other) => tiyin >= other.tiyin;

  static Money min(Money a, Money b) => a <= b ? a : b;
  static Money max(Money a, Money b) => a >= b ? a : b;

  /// Summaning [bps] ulushi (1% = 100 bps, 0.5% = 50 bps).
  ///
  /// Natija tiyingacha **nolga qarab** yaxlitlanadi (ya'ni musbat summada
  /// pastga). Shunda hech qachon tushumdan ko'p pul taqsimlanmaydi.
  /// BigInt ishlatiladi: Flutter Web'da `int` 2^53 dan katta sonlarda
  /// aniqligini yo'qotadi.
  Money percentBps(int bps) {
    final product = BigInt.from(tiyin) * BigInt.from(bps);
    final result = product ~/ BigInt.from(basisPointsInWhole); // nolga qarab
    return Money(result.toInt());
  }

  /// `1 234 567,89 so'm` ko'rinishida.
  String format({bool withCurrency = true}) {
    final negative = tiyin < 0;
    final abs = tiyin.abs();
    final whole = (abs ~/ 100).toString();
    final frac = (abs % 100).toString().padLeft(2, '0');
    final buf = StringBuffer();
    for (var i = 0; i < whole.length; i++) {
      if (i > 0 && (whole.length - i) % 3 == 0) buf.write(' ');
      buf.write(whole[i]);
    }
    final text = '${negative ? '-' : ''}$buf,$frac';
    return withCurrency ? "$text so'm" : text;
  }

  @override
  int compareTo(Money other) => tiyin.compareTo(other.tiyin);

  @override
  bool operator ==(Object other) => other is Money && other.tiyin == tiyin;

  @override
  int get hashCode => tiyin.hashCode;

  @override
  String toString() => format();
}
