/**
 * 1% ulush hisoblash mantiqi — Dart `revenue_share` modulining TypeScript nusxasi.
 * Firebase'ga bog'liq emas (toza funksiyalar), shuning uchun alohida test qilinadi.
 *
 * Pul TIYINDA butun son sifatida saqlanadi (1 so'm = 100 tiyin).
 * Ulushlar basis point'da: 1% = 100 bps, 0.5% = 50 bps.
 */

export const BPS_WHOLE = 10_000;
export const PLATFORM_RECIPIENT_ID = "platform";

export type PayoutRole = "introducer" | "platform";
export type ReportStatus = "submitted" | "verified" | "rejected";
export type EntryType = "regular" | "adjustment";

export interface Deal {
  id: string;
  entrepreneurId: string;
  investorId: string;
  introducerId: string;
  introducerBps: number;
  platformBps: number;
  /** "YYYY-MM" */
  firstPeriod: string;
  termMonths: number | null;
  introducerCapTiyin: number | null;
}

export interface MonthlyReport {
  dealId: string;
  /** "YYYY-MM" */
  period: string;
  grossRevenueTiyin: number;
  status: ReportStatus;
  version: number;
}

export interface LedgerEntry {
  id: string;
  dealId: string;
  period: string;
  role: PayoutRole;
  recipientId: string;
  amountTiyin: number;
  type: EntryType;
  reportVersion: number;
  baseRevenueTiyin: number;
}

export class ValidationError extends Error {}

// ---------- Davr (oy) ----------

const PERIOD_RE = /^(\d{4})-(\d{2})$/;

export function periodIndex(p: string): number {
  const m = PERIOD_RE.exec(p);
  if (!m) throw new ValidationError(`Noto'g'ri davr: ${p} (kutilgan: YYYY-MM)`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new ValidationError(`Noto'g'ri oy: ${p}`);
  return year * 12 + (month - 1);
}

export function periodFromIndex(i: number): string {
  const year = Math.floor(i / 12);
  const month = (i % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export const addMonths = (p: string, n: number): string => periodFromIndex(periodIndex(p) + n);

/** Toshkent vaqti bo'yicha joriy oy. */
export function currentPeriod(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit" })
    .formatToParts(now);
  const y = parts.find((x) => x.type === "year")!.value;
  const m = parts.find((x) => x.type === "month")!.value;
  return `${y}-${m}`;
}

// ---------- Pul ----------

function assertTiyin(v: unknown, name: string): asserts v is number {
  if (typeof v !== "number" || !Number.isSafeInteger(v)) {
    throw new ValidationError(`${name} butun son (tiyin) bo'lishi kerak`);
  }
}

/** Summaning bps ulushi, tiyingacha nolga qarab yaxlitlanadi. BigInt — toshib ketmaslik uchun. */
export function percentBps(tiyin: number, bps: number): number {
  assertTiyin(tiyin, "summa");
  return Number((BigInt(tiyin) * BigInt(bps)) / BigInt(BPS_WHOLE));
}

/** 123456789 tiyin → "1 234 567,89 so'm" */
export function formatSom(tiyin: number): string {
  const neg = tiyin < 0;
  const abs = Math.abs(tiyin);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const frac = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}${whole},${frac} so'm`;
}

// ---------- Bitim ----------

export function validateDeal(d: Deal): void {
  if (!d.id || !d.entrepreneurId || !d.investorId || !d.introducerId) {
    throw new ValidationError("Bitim ishtirokchilari to'liq ko'rsatilmagan");
  }
  for (const [name, v] of [["introducerBps", d.introducerBps], ["platformBps", d.platformBps]] as const) {
    if (!Number.isInteger(v) || v < 0) throw new ValidationError(`${name} manfiy bo'lmagan butun son bo'lishi kerak`);
  }
  if (d.introducerBps + d.platformBps > BPS_WHOLE) throw new ValidationError("Ulushlar yig'indisi 100% dan oshmasligi kerak");
  periodIndex(d.firstPeriod);
  if (d.termMonths !== null && (!Number.isInteger(d.termMonths) || d.termMonths <= 0)) {
    throw new ValidationError("Muddat musbat butun son bo'lishi kerak");
  }
  if (d.introducerCapTiyin !== null) {
    assertTiyin(d.introducerCapTiyin, "introducerCapTiyin");
    if (d.introducerCapTiyin < 0) throw new ValidationError("Chegara manfiy bo'lishi mumkin emas");
  }
  if (d.introducerId === d.entrepreneurId || d.introducerId === d.investorId) {
    throw new ValidationError("Vositachi bitimning o'zi tadbirkor yoki investor bo'la olmaydi");
  }
}

export function lastPeriod(d: Deal): string | null {
  return d.termMonths === null ? null : addMonths(d.firstPeriod, d.termMonths - 1);
}

export function coversPeriod(d: Deal, p: string): boolean {
  const i = periodIndex(p);
  if (i < periodIndex(d.firstPeriod)) return false;
  const last = lastPeriod(d);
  return last === null || i <= periodIndex(last);
}

// ---------- Hisoblash ----------

const sum = (xs: Iterable<LedgerEntry>): number => {
  let s = 0;
  for (const x of xs) s += x.amountTiyin;
  return s;
};

/**
 * Hisobot bo'yicha qo'shilishi kerak bo'lgan YANGI ledger yozuvlari.
 * Idempotent: bir xil hisobotni qayta hisoblash bo'sh ro'yxat qaytaradi.
 * Tuzatilgan hisobotda faqat farq ("adjustment") yoziladi.
 */
export function calculate(deal: Deal, report: MonthlyReport, ledger: readonly LedgerEntry[]): LedgerEntry[] {
  if (report.dealId !== deal.id) throw new ValidationError("Hisobot boshqa bitimga tegishli");
  if (report.status !== "verified") throw new ValidationError("Hisobot tasdiqlanmagan");
  assertTiyin(report.grossRevenueTiyin, "grossRevenueTiyin");
  if (report.grossRevenueTiyin < 0) throw new ValidationError("Tushum manfiy bo'lishi mumkin emas");
  if (!coversPeriod(deal, report.period)) return [];

  const dealLedger = ledger.filter((e) => e.dealId === deal.id);
  const result: LedgerEntry[] = [];

  for (const role of ["introducer", "platform"] as const) {
    const bps = role === "introducer" ? deal.introducerBps : deal.platformBps;
    const recipientId = role === "introducer" ? deal.introducerId : PLATFORM_RECIPIENT_ID;
    const roleEntries = dealLedger.filter((e) => e.role === role);
    const samePeriod = roleEntries.filter((e) => e.period === report.period);

    let target = percentBps(report.grossRevenueTiyin, bps);
    if (role === "introducer" && deal.introducerCapTiyin !== null) {
      const paidOther = sum(roleEntries.filter((e) => e.period !== report.period));
      target = Math.min(target, Math.max(0, deal.introducerCapTiyin - paidOther));
    }

    const delta = target - sum(samePeriod);
    if (delta === 0) continue;

    result.push({
      id: `${deal.id}_${report.period}_${role}_${samePeriod.length + 1}`,
      dealId: deal.id,
      period: report.period,
      role,
      recipientId,
      amountTiyin: delta,
      type: samePeriod.length === 0 ? "regular" : "adjustment",
      reportVersion: report.version,
      baseRevenueTiyin: report.grossRevenueTiyin,
    });
  }
  return result;
}

/** Tugagan, lekin tasdiqlangan hisoboti yo'q oylar ([current] oyi hisobga olinmaydi). */
export function missingPeriods(deal: Deal, verifiedPeriods: ReadonlySet<string>, current: string): string[] {
  const out: string[] = [];
  const end = periodIndex(current);
  for (let i = periodIndex(deal.firstPeriod); i < end; i++) {
    const p = periodFromIndex(i);
    if (!coversPeriod(deal, p)) break;
    if (!verifiedPeriods.has(p)) out.push(p);
  }
  return out;
}

/** Firestore hujjatidan Deal (noma'lum maydonlar e'tiborsiz). */
export function dealFromDoc(id: string, data: Record<string, unknown>): Deal {
  const deal: Deal = {
    id,
    entrepreneurId: String(data.entrepreneurId ?? ""),
    investorId: String(data.investorId ?? ""),
    introducerId: String(data.introducerId ?? ""),
    introducerBps: Number(data.introducerBps ?? 100),
    platformBps: Number(data.platformBps ?? 0),
    firstPeriod: String(data.firstPeriod ?? ""),
    termMonths: data.termMonths == null ? null : Number(data.termMonths),
    introducerCapTiyin: data.introducerCapTiyin == null ? null : Number(data.introducerCapTiyin),
  };
  validateDeal(deal);
  return deal;
}
