// Firebase emulyatorida to'liq zanjirni tekshiradi:
//   npx firebase-tools emulators:exec --project demo-revenue --only auth,firestore,functions \
//       "node functions/test/emulator.integration.mjs"
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT = process.env.GCLOUD_PROJECT || "demo-revenue";
const FN = `http://127.0.0.1:5001/${PROJECT}/europe-west1`;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;

initializeApp({ projectId: PROJECT });
const auth = getAuth();
const db = getFirestore();

async function user(uid, claims) {
  await auth.createUser({ uid, email: `${uid}@test.uz`, password: "parol123" }).catch(() => {});
  if (claims) await auth.setCustomUserClaims(uid, claims);
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${uid}@test.uz`, password: "parol123", returnSecureToken: true }),
  });
  return (await r.json()).idToken;
}

async function call(name, token, data) {
  const r = await fetch(`${FN}/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  const j = await r.json();
  if (j.error) { const e = new Error(j.error.message); e.status = j.error.status; throw e; }
  return j.result;
}

async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("Kutish vaqti tugadi");
    await new Promise((r) => setTimeout(r, 300));
  }
}

const admin = await user("admin", { admin: true });
const ali = await user("ali");
const sardor = await user("sardor");
await user("vali");

// 1. Bitim
await assert.rejects(call("createDeal", ali, {}), (e) => e.status === "PERMISSION_DENIED");
const { dealId } = await call("createDeal", admin, {
  entrepreneurId: "ali", investorId: "vali", introducerId: "sardor",
  firstPeriod: "2026-01", introducerBps: 100, platformBps: 50, termMonths: 36,
});
console.log("✓ bitim yaratildi:", dealId);

// 2. Faqat tadbirkor hisobot topshiradi
await assert.rejects(
  call("submitReport", sardor, { dealId, period: "2026-01", grossRevenueTiyin: 1 }),
  (e) => e.status === "PERMISSION_DENIED",
);
await assert.rejects(
  call("submitReport", ali, { dealId, period: "2026-01", grossRevenueTiyin: 10.5 }),
  (e) => e.status === "INVALID_ARGUMENT",
);
const v1 = await call("submitReport", ali, { dealId, period: "2026-01", grossRevenueTiyin: 8_000_000_000 }); // 80 mln so'm
assert.equal(v1.version, 1);
console.log("✓ hisobot topshirildi, tekshiruvlar ishladi");

// 3. Tasdiqlashdan oldin ledger bo'sh
await new Promise((r) => setTimeout(r, 1500));
assert.equal((await db.collection("ledger").where("dealId", "==", dealId).get()).size, 0);

await call("reviewReport", admin, { dealId, period: "2026-01", approve: true, expectedVersion: 1 });
const earnings1 = await waitFor(async () => (await db.doc("earnings/sardor").get()).data());
assert.equal(earnings1.totalTiyin, 80_000_000); // 800 000 so'm = 1%
assert.equal(earnings1.byDeal[dealId], 80_000_000);
assert.equal((await db.doc("earnings/platform").get()).data().totalTiyin, 40_000_000);
console.log("✓ tasdiqlandi → vositachiga 800 000 so'm, platformaga 400 000 so'm");

// 4. Tuzatish: 90 mln
const v2 = await call("submitReport", ali, { dealId, period: "2026-01", grossRevenueTiyin: 9_000_000_000 });
assert.equal(v2.version, 2);
await assert.rejects(
  call("reviewReport", admin, { dealId, period: "2026-01", approve: true, expectedVersion: 1 }),
  (e) => e.status === "ABORTED",
);
await call("reviewReport", admin, { dealId, period: "2026-01", approve: true, expectedVersion: 2 });
await waitFor(async () => (await db.doc("earnings/sardor").get()).data().totalTiyin === 90_000_000);
const ledger = await db.collection("ledger").where("dealId", "==", dealId).get();
const intro = ledger.docs.map((d) => d.data()).filter((e) => e.role === "introducer").sort((a, b) => a.id.localeCompare(b.id));
assert.deepEqual(intro.map((e) => [e.type, e.amountTiyin]), [["regular", 80_000_000], ["adjustment", 10_000_000]]);
console.log("✓ tuzatish → +100 000 so'm adjustment, jami 900 000 so'm");

// 5. Idempotentlik: triggerni qayta ishga tushirish (hujjatni "tegib" chiqamiz)
await db.doc(`deals/${dealId}/reports/2026-01`).update({ touchedAt: Date.now() });
await new Promise((r) => setTimeout(r, 2500));
assert.equal((await db.collection("ledger").where("dealId", "==", dealId).get()).size, 4);
assert.equal((await db.doc("earnings/sardor").get()).data().totalTiyin, 90_000_000);
console.log("✓ takroriy trigger pulni ikki marta yozmadi");

// 6. Eslatma
const notes = await db.collection("notifications/sardor/items").get();
assert.equal(notes.size, 2);
console.log("✓ vositachiga", notes.size, "ta bildirishnoma");

console.log("\nHAMMASI O'TDI ✅");
process.exit(0);
