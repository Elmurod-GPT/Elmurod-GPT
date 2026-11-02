# Firebase backend — 1% ulush tizimi

## Tuzilma

| Yo'l | Kim yozadi | Kim o'qiydi |
|---|---|---|
| `deals/{dealId}` | `createDeal` (admin) | ishtirokchilar, admin |
| `deals/{dealId}/reports/{YYYY-MM}` | `submitReport`, `reviewReport` | ishtirokchilar, admin |
| `ledger/{entryId}` | faqat trigger (`onReportWritten`) | oluvchining o'zi, admin |
| `earnings/{uid}` | faqat trigger | egasi, admin |
| `notifications/{uid}/items/{id}` | trigger, `remindMissingReports` | egasi (faqat `read: true` qo'ya oladi) |

Klient hech qaysi hujjatga bevosita yoza olmaydi — `firestore.rules`.

## Jarayon

1. Admin `createDeal` — bitim (vositachi 1%, platforma 0.5%, muddat 36 oy).
2. Tadbirkor `submitReport` — tugagan oy tushumi (tiyinda) va hujjat yo'li.
   Qayta topshirilsa `version` oshadi.
3. Admin `reviewReport` (`expectedVersion` bilan) — tasdiqlaydi yoki rad etadi.
4. `onReportWritten` trigger tranzaksiya ichida `ledger` yozuvlarini yaratadi,
   `earnings` jamini oshiradi va vositachiga bildirishnoma yuboradi.
   Takroriy ishga tushsa ham pul ikki marta yozilmaydi (idempotent).
5. Har oy 5-sanada `remindMissingReports` hisobot topshirmagan tadbirkorlarga eslatadi.

## Admin huquqi

Admin `admin: true` custom claim orqali belgilanadi (bir marta, server/skript orqali):

```js
await getAuth().setCustomUserClaims(uid, { admin: true });
```

## Testlar

```bash
cd functions
npm install
npm test               # mantiq testlari (17 ta)
npm run test:rules     # ruxsat qoidalari (18 ta), emulyatorda
npm run test:emulator  # to'liq zanjir: bitim → hisobot → tasdiq → ledger → daromad
```

## Deploy

```bash
firebase use <loyiha-id>
firebase deploy --only functions,firestore
```

Region: `europe-west1` (`src/index.ts` va Flutter'dagi `FirebaseFunctions.instanceFor(region:)` bir xil bo'lishi kerak).

## Flutter

`flutter_client/revenue_repository.dart` — ilovaga ko'chiring. U `revenue_share` Dart modelidan foydalanadi.
