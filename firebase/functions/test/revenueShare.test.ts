import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addMonths,
  calculate,
  coversPeriod,
  currentPeriod,
  Deal,
  formatSom,
  LedgerEntry,
  missingPeriods,
  MonthlyReport,
  percentBps,
  validateDeal,
} from "../src/revenueShare";

const som = (n: number) => Math.round(n * 100);

const deal = (over: Partial<Deal> = {}): Deal => ({
  id: "deal1",
  entrepreneurId: "tadbirkor",
  investorId: "investor",
  introducerId: "vositachi",
  introducerBps: 100,
  platformBps: 50,
  firstPeriod: "2026-01",
  termMonths: null,
  introducerCapTiyin: null,
  ...over,
});

const report = (period: string, revenueSom: number, over: Partial<MonthlyReport> = {}): MonthlyReport => ({
  dealId: "deal1",
  period,
  grossRevenueTiyin: som(revenueSom),
  status: "verified",
  version: 1,
  ...over,
});

const pick = (es: LedgerEntry[], role: string) => es.find((e) => e.role === role);

describe("pul", () => {
  it("1%", () => assert.equal(percentBps(som(100_000_000), 100), som(1_000_000)));
  it("pastga yaxlitlash", () => assert.equal(percentBps(12345, 100), 123));
  it("katta summa toshmaydi", () => assert.equal(percentBps(som(5_000_000_000_000), 100), som(50_000_000_000)));
  it("format", () => {
    assert.equal(formatSom(123456789), "1 234 567,89 so'm");
    assert.equal(formatSom(-5), "-0,05 so'm");
  });
});

describe("davr va bitim", () => {
  it("oy qo'shish", () => {
    assert.equal(addMonths("2026-11", 3), "2027-02");
    assert.equal(addMonths("2026-01", -1), "2025-12");
  });
  it("muddat", () => {
    const d = deal({ termMonths: 36 });
    assert.equal(coversPeriod(d, "2025-12"), false);
    assert.equal(coversPeriod(d, "2028-12"), true);
    assert.equal(coversPeriod(d, "2029-01"), false);
  });
  it("validatsiya", () => {
    assert.throws(() => validateDeal(deal({ introducerBps: 9000, platformBps: 2000 })));
    assert.throws(() => validateDeal(deal({ introducerId: "tadbirkor" })));
    assert.throws(() => validateDeal(deal({ firstPeriod: "2026-13" })));
    assert.throws(() => validateDeal(deal({ introducerBps: 1.5 })));
  });
  it("Toshkent vaqti bo'yicha joriy oy", () => {
    // 31-dekabr 20:00 UTC = 1-yanvar 01:00 Toshkent
    assert.equal(currentPeriod(new Date("2026-12-31T20:00:00Z")), "2027-01");
  });
});

describe("calculate", () => {
  it("vositachi 1%, platforma 0.5%", () => {
    const es = calculate(deal(), report("2026-03", 100_000_000), []);
    assert.equal(pick(es, "introducer")!.amountTiyin, som(1_000_000));
    assert.equal(pick(es, "introducer")!.recipientId, "vositachi");
    assert.equal(pick(es, "platform")!.amountTiyin, som(500_000));
    assert.equal(pick(es, "platform")!.type, "regular");
  });
  it("tasdiqlanmagan hisobot rad etiladi", () => {
    assert.throws(() => calculate(deal(), report("2026-03", 1, { status: "submitted" }), []));
  });
  it("kasr tiyin rad etiladi", () => {
    assert.throws(() => calculate(deal(), { ...report("2026-03", 1), grossRevenueTiyin: 10.5 }, []));
  });
  it("muddatdan tashqari", () => {
    assert.deepEqual(calculate(deal({ termMonths: 12 }), report("2027-01", 100), []), []);
  });
  it("idempotent", () => {
    const r = report("2026-03", 100_000_000);
    const first = calculate(deal(), r, []);
    assert.deepEqual(calculate(deal(), r, first), []);
  });
  it("tuzatish: +/-", () => {
    const l1 = calculate(deal(), report("2026-03", 100_000_000), []);
    const up = calculate(deal(), report("2026-03", 120_000_000, { version: 2 }), l1);
    assert.equal(pick(up, "introducer")!.amountTiyin, som(200_000));
    assert.equal(pick(up, "introducer")!.type, "adjustment");
    assert.ok(pick(up, "introducer")!.id.endsWith("_2"));
    const down = calculate(deal(), report("2026-03", 50_000_000, { version: 3 }), [...l1, ...up]);
    assert.equal(pick(down, "introducer")!.amountTiyin, som(-700_000));
    assert.ok(pick(down, "introducer")!.id.endsWith("_3"));
  });
  it("chegara", () => {
    const d = deal({ introducerCapTiyin: som(1_500_000) });
    const m1 = calculate(d, report("2026-01", 100_000_000), []);
    const m2 = calculate(d, report("2026-02", 100_000_000), m1);
    const m3 = calculate(d, report("2026-03", 100_000_000), [...m1, ...m2]);
    assert.equal(pick(m2, "introducer")!.amountTiyin, som(500_000));
    assert.equal(pick(m3, "introducer"), undefined);
    assert.equal(pick(m3, "platform")!.amountTiyin, som(500_000));
  });
});

describe("missingPeriods", () => {
  it("topshirilmagan oylar", () => {
    const got = missingPeriods(deal(), new Set(["2026-01", "2026-03"]), "2026-06");
    assert.deepEqual(got, ["2026-02", "2026-04", "2026-05"]);
  });
  it("muddat tugagach to'xtaydi", () => {
    assert.deepEqual(missingPeriods(deal({ termMonths: 2 }), new Set(), "2026-10"), ["2026-01", "2026-02"]);
  });
});
