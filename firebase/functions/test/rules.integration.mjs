// Firestore ruxsat qoidalari testi:
//   npx firebase-tools emulators:exec --project demo-revenue --only firestore "node functions/test/rules.integration.mjs"
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "demo-revenue",
  firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 },
});

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "deals/d1"), { entrepreneurId: "ali", investorId: "vali", introducerId: "sardor", participants: ["ali", "vali", "sardor"], status: "active" });
  await setDoc(doc(db, "deals/d1/reports/2026-01"), { grossRevenueTiyin: 100, status: "verified" });
  await setDoc(doc(db, "ledger/e1"), { dealId: "d1", recipientId: "sardor", amountTiyin: 1 });
  await setDoc(doc(db, "ledger/e2"), { dealId: "d1", recipientId: "platform", amountTiyin: 1 });
  await setDoc(doc(db, "earnings/sardor"), { totalTiyin: 1 });
  await setDoc(doc(db, "notifications/sardor/items/n1"), { title: "x", read: false });
});

const sardor = env.authenticatedContext("sardor").firestore();
const ali = env.authenticatedContext("ali").firestore();
const begona = env.authenticatedContext("begona").firestore();
const anon = env.unauthenticatedContext().firestore();
const admin = env.authenticatedContext("admin", { admin: true }).firestore();

const checks = [
  ["ishtirokchi bitimni o'qiydi", assertSucceeds(getDoc(doc(ali, "deals/d1")))],
  ["begona bitimni o'qiy olmaydi", assertFails(getDoc(doc(begona, "deals/d1")))],
  ["mehmon bitimni o'qiy olmaydi", assertFails(getDoc(doc(anon, "deals/d1")))],
  ["o'z bitimlari ro'yxati", assertSucceeds(getDocs(query(collection(ali, "deals"), where("participants", "array-contains", "ali"))))],
  ["ishtirokchi hisobotni o'qiydi", assertSucceeds(getDoc(doc(sardor, "deals/d1/reports/2026-01")))],
  ["tadbirkor hisobotni to'g'ridan-to'g'ri yoza olmaydi", assertFails(setDoc(doc(ali, "deals/d1/reports/2026-02"), { grossRevenueTiyin: 1, status: "verified" }))],
  ["vositachi o'z ledger yozuvini o'qiydi", assertSucceeds(getDoc(doc(sardor, "ledger/e1")))],
  ["boshqaning ledger yozuvi yopiq", assertFails(getDoc(doc(sardor, "ledger/e2")))],
  ["o'z ledger ro'yxati", assertSucceeds(getDocs(query(collection(sardor, "ledger"), where("recipientId", "==", "sardor"))))],
  ["butun ledger ro'yxati yopiq", assertFails(getDocs(collection(sardor, "ledger")))],
  ["ledger'ga yozib bo'lmaydi", assertFails(setDoc(doc(sardor, "ledger/hack"), { recipientId: "sardor", amountTiyin: 999999 }))],
  ["daromadni o'zgartirib bo'lmaydi", assertFails(updateDoc(doc(sardor, "earnings/sardor"), { totalTiyin: 999999 }))],
  ["o'z daromadini o'qiydi", assertSucceeds(getDoc(doc(sardor, "earnings/sardor")))],
  ["boshqaning daromadi yopiq", assertFails(getDoc(doc(ali, "earnings/sardor")))],
  ["bildirishnomani o'qildi deb belgilash", assertSucceeds(updateDoc(doc(sardor, "notifications/sardor/items/n1"), { read: true }))],
  ["bildirishnoma matnini o'zgartirib bo'lmaydi", assertFails(updateDoc(doc(sardor, "notifications/sardor/items/n1"), { title: "y" }))],
  ["admin hamma narsani o'qiydi", assertSucceeds(getDoc(doc(admin, "ledger/e2")))],
  ["admin ham klientdan yoza olmaydi", assertFails(setDoc(doc(admin, "ledger/x"), { a: 1 }))],
];
let failed = 0;
for (const [name, p] of checks) {
  try { await p; console.log("✓", name); } catch (e) { failed++; console.log("✗", name, "-", e.message); }
}
await env.cleanup();
console.log(failed ? `\n${failed} ta XATO` : "\nQOIDALAR TESTI O'TDI ✅");
process.exit(failed ? 1 : 0);
