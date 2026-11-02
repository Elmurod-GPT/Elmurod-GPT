/**
 * Cloud Functions (2-avlod): 1% ulush tizimi.
 *
 * Firestore tuzilmasi:
 *   deals/{dealId}                      — bitim (faqat admin yaratadi)
 *   deals/{dealId}/reports/{YYYY-MM}    — oylik tushum hisoboti
 *   ledger/{entryId}                    — hisob daftari (faqat server yozadi, o'zgartirilmaydi)
 *   earnings/{uid}                      — har bir oluvchining jami daromadi
 *   notifications/{uid}/items/{id}      — eslatmalar
 *
 * Klient hech qaysi hujjatga bevosita yoza olmaydi (firestore.rules) —
 * barcha o'zgarishlar shu funksiyalar orqali tekshirilib o'tadi.
 */
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import {
  calculate,
  coversPeriod,
  currentPeriod,
  Deal,
  dealFromDoc,
  formatSom,
  LedgerEntry,
  missingPeriods,
  MonthlyReport,
  periodIndex,
  ValidationError,
  validateDeal,
} from "./revenueShare";

initializeApp();
const db = getFirestore();
setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

// ---------- yordamchilar ----------

function requireAuth(req: CallableRequest): string {
  if (!req.auth) throw new HttpsError("unauthenticated", "Tizimga kiring");
  return req.auth.uid;
}

function requireAdmin(req: CallableRequest): string {
  const uid = requireAuth(req);
  if (req.auth?.token.admin !== true) throw new HttpsError("permission-denied", "Faqat administrator uchun");
  return uid;
}

function asHttps(e: unknown): never {
  if (e instanceof HttpsError) throw e;
  if (e instanceof ValidationError) throw new HttpsError("invalid-argument", e.message);
  logger.error(e);
  throw new HttpsError("internal", "Ichki xatolik");
}

const reportRef = (dealId: string, period: string) => db.doc(`deals/${dealId}/reports/${period}`);

// ---------- 1. Bitim yaratish (admin) ----------

export const createDeal = onCall(async (req) => {
  requireAdmin(req);
  try {
    const d = req.data ?? {};
    const ref = db.collection("deals").doc();
    const deal: Deal = {
      id: ref.id,
      entrepreneurId: String(d.entrepreneurId ?? ""),
      investorId: String(d.investorId ?? ""),
      introducerId: String(d.introducerId ?? ""),
      introducerBps: d.introducerBps ?? 100,
      platformBps: d.platformBps ?? 0,
      firstPeriod: String(d.firstPeriod ?? ""),
      termMonths: d.termMonths ?? null,
      introducerCapTiyin: d.introducerCapTiyin ?? null,
    };
    validateDeal(deal);
    const { id, ...fields } = deal;
    await ref.create({
      ...fields,
      participants: [deal.entrepreneurId, deal.investorId, deal.introducerId],
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
    });
    return { dealId: id };
  } catch (e) {
    asHttps(e);
  }
});

// ---------- 2. Tadbirkor oylik hisobot topshiradi ----------

export const submitReport = onCall(async (req) => {
  const uid = requireAuth(req);
  try {
    const { dealId, period, grossRevenueTiyin, attachmentPath } = req.data ?? {};
    if (typeof dealId !== "string" || typeof period !== "string") {
      throw new ValidationError("dealId va period kerak");
    }
    if (!Number.isSafeInteger(grossRevenueTiyin) || grossRevenueTiyin < 0) {
      throw new ValidationError("grossRevenueTiyin manfiy bo'lmagan butun son bo'lishi kerak");
    }
    return await db.runTransaction(async (tx) => {
      const dealSnap = await tx.get(db.doc(`deals/${dealId}`));
      if (!dealSnap.exists) throw new HttpsError("not-found", "Bitim topilmadi");
      const deal = dealFromDoc(dealId, dealSnap.data()!);
      if (deal.entrepreneurId !== uid) throw new HttpsError("permission-denied", "Faqat tadbirkor hisobot topshiradi");
      if (!coversPeriod(deal, period)) throw new ValidationError("Bu oy bitim muddatiga kirmaydi");
      if (periodIndex(period) >= periodIndex(currentPeriod())) {
        throw new ValidationError("Faqat tugagan oy uchun hisobot topshirish mumkin");
      }
      const ref = reportRef(dealId, period);
      const prev = await tx.get(ref);
      const version = prev.exists ? Number(prev.data()!.version ?? 1) + 1 : 1;
      tx.set(ref, {
        dealId,
        period,
        grossRevenueTiyin,
        status: "submitted",
        version,
        attachmentPath: typeof attachmentPath === "string" ? attachmentPath : null,
        submittedBy: uid,
        submittedAt: FieldValue.serverTimestamp(),
        reviewedBy: null,
        reviewNote: null,
      });
      return { version };
    });
  } catch (e) {
    asHttps(e);
  }
});

// ---------- 3. Admin hisobotni tasdiqlaydi yoki rad etadi ----------

export const reviewReport = onCall(async (req) => {
  const adminUid = requireAdmin(req);
  try {
    const { dealId, period, approve, note, expectedVersion } = req.data ?? {};
    if (typeof dealId !== "string" || typeof period !== "string" || typeof approve !== "boolean") {
      throw new ValidationError("dealId, period va approve kerak");
    }
    await db.runTransaction(async (tx) => {
      const ref = reportRef(dealId, period);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("not-found", "Hisobot topilmadi");
      const r = snap.data()!;
      if (r.status !== "submitted") throw new HttpsError("failed-precondition", "Hisobot ko'rib chiqish holatida emas");
      // Admin ko'rgan versiyadan keyin tadbirkor yangisini yuborgan bo'lsa — eski versiya tasdiqlanmasin
      if (expectedVersion != null && r.version !== expectedVersion) {
        throw new HttpsError("aborted", "Hisobot yangilangan, qaytadan ko'rib chiqing");
      }
      tx.update(ref, {
        status: approve ? "verified" : "rejected",
        reviewedBy: adminUid,
        reviewedAt: FieldValue.serverTimestamp(),
        reviewNote: typeof note === "string" ? note : null,
      });
    });
    return { ok: true };
  } catch (e) {
    asHttps(e);
  }
});

// ---------- 4. Tasdiqlangan hisobot → ledger (avtomatik) ----------

/**
 * Trigger kamida bir marta (at-least-once) ishlaydi, ya'ni takrorlanishi mumkin.
 * Hisob idempotent va tranzaksiya ichida, shuning uchun pul ikki marta yozilmaydi.
 */
export async function applyReport(dealId: string, period: string): Promise<LedgerEntry[]> {
  return db.runTransaction(async (tx) => {
    const repSnap = await tx.get(reportRef(dealId, period));
    if (!repSnap.exists) return [];
    const r = repSnap.data()!;
    if (r.status !== "verified") return [];

    const dealSnap = await tx.get(db.doc(`deals/${dealId}`));
    if (!dealSnap.exists) throw new Error(`Bitim topilmadi: ${dealId}`);
    const deal = dealFromDoc(dealId, dealSnap.data()!);

    const ledgerSnap = await tx.get(db.collection("ledger").where("dealId", "==", dealId));
    const ledger = ledgerSnap.docs.map((d) => d.data() as LedgerEntry);

    const report: MonthlyReport = {
      dealId,
      period,
      grossRevenueTiyin: Number(r.grossRevenueTiyin),
      status: "verified",
      version: Number(r.version ?? 1),
    };
    const entries = calculate(deal, report, ledger);

    for (const e of entries) {
      tx.create(db.collection("ledger").doc(e.id), { ...e, createdAt: FieldValue.serverTimestamp() });
      tx.set(
        db.doc(`earnings/${e.recipientId}`),
        {
          totalTiyin: FieldValue.increment(e.amountTiyin),
          byDeal: { [dealId]: FieldValue.increment(e.amountTiyin) },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      if (e.role === "introducer") {
        tx.create(db.collection(`notifications/${e.recipientId}/items`).doc(`ledger_${e.id}`), {
          title: e.amountTiyin >= 0 ? "Yangi daromad" : "Hisob tuzatildi",
          body: `${period} uchun ${formatSom(e.amountTiyin)}`,
          dealId,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    }
    return entries;
  });
}

export const onReportWritten = onDocumentWritten("deals/{dealId}/reports/{period}", async (event) => {
  const after = event.data?.after;
  if (!after?.exists || after.data()?.status !== "verified") return;
  const { dealId, period } = event.params;
  const entries = await applyReport(dealId, period);
  if (entries.length) logger.info("Ledger yozuvlari qo'shildi", { dealId, period, ids: entries.map((e) => e.id) });
});

// ---------- 5. Har oy 5-sanada: hisobot topshirmaganlarga eslatma ----------

export const remindMissingReports = onSchedule(
  { schedule: "17 9 5 * *", timeZone: "Asia/Tashkent" },
  async () => {
    const current = currentPeriod();
    const deals = await db.collection("deals").where("status", "==", "active").get();
    for (const doc of deals.docs) {
      try {
        const deal = dealFromDoc(doc.id, doc.data());
        const reports = await doc.ref.collection("reports").where("status", "==", "verified").get();
        const missing = missingPeriods(deal, new Set(reports.docs.map((r) => r.id)), current);
        if (!missing.length) continue;
        await db.doc(`notifications/${deal.entrepreneurId}/items/missing_${deal.id}_${current}`).set({
          title: "Oylik hisobot kutilmoqda",
          body: `Quyidagi oylar uchun tushum hisobotini topshiring: ${missing.join(", ")}`,
          dealId: deal.id,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (e) {
        logger.error("Eslatma yuborilmadi", { dealId: doc.id, error: String(e) });
      }
    }
  },
);
