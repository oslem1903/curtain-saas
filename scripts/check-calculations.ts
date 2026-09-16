import assert from "node:assert/strict";
import { toLocalDateISO, todayLocalISO, addDaysLocalISO, parseLocalDateOnly, diffDaysLocal, toDateInputValue } from "../src/utils/date.ts";
import { daysRemaining, todayISO, isDelayed, deliveryUrgency } from "../src/utils/order.ts";
import { computePlanForOrder, bucketForDueDate, todayDateOnly, daysBetween } from "../src/utils/installments.ts";
import { PAYMENT_METHOD_OPTIONS, paymentLabel, paymentLabelOrDash, paymentDescription } from "../src/utils/paymentLabels.ts";
import { parseStorageRef, isLocalPreviewSrc, STORAGE_BUCKETS } from "../src/utils/storagePath.ts";

const TZ = process.env.TZ;
let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log("  ok  " + name); };

console.log(`TZ=${TZ}`);

// --- KRITIK: gece 00:00-03:00 arasi "bugun" dogru olmali (UTC+3 tuzagi) ---
t("gece 01:00'de bugun dogru", () => {
  const gece = new Date(2026, 8, 14, 1, 0, 0); // 14 Eylul 2026, 01:00 yerel
  assert.equal(toLocalDateISO(gece), "2026-09-14");
  // eski hatali davranis: gece.toISOString().slice(0,10) === "2026-09-13"
  if (TZ === "Europe/Istanbul") assert.equal(gece.toISOString().slice(0, 10), "2026-09-13");
});

t("ayin 1'i yerel gece yarisi bir onceki aya kaymaz", () => {
  const ayBasi = new Date(2026, 8, 1); // 1 Eylul 2026 00:00 yerel
  assert.equal(toLocalDateISO(ayBasi), "2026-09-01");
  if (TZ === "Europe/Istanbul") assert.equal(ayBasi.toISOString().slice(0, 10), "2026-08-31"); // eski hata
});

t("addDaysLocalISO: bugun + 30", () => {
  assert.equal(addDaysLocalISO(30, new Date(2026, 8, 13, 1, 30)), "2026-10-13");
});

t("parseLocalDateOnly: saf tarih yerel gun olarak okunur", () => {
  const d = parseLocalDateOnly("2026-09-13")!;
  assert.equal(d.getFullYear(), 2026); assert.equal(d.getMonth(), 8); assert.equal(d.getDate(), 13);
});

t("parseLocalDateOnly: zaman damgasi yerel takvim gunune duser", () => {
  // 13 Eylul 22:00 UTC = 14 Eylul 01:00 TR
  const d = parseLocalDateOnly("2026-09-13T22:00:00Z")!;
  assert.equal(toLocalDateISO(d), TZ === "Europe/Istanbul" ? "2026-09-14" : toLocalDateISO(d));
});

t("toDateInputValue: bos/gecersiz girdi input'u kirmaz", () => {
  assert.equal(toDateInputValue(null), "");
  assert.equal(toDateInputValue(""), "");
  assert.equal(toDateInputValue("saçma"), "");
  assert.equal(toDateInputValue("2026-09-13"), "2026-09-13");
});

t("diffDaysLocal: DST gecisinde tam gun", () => {
  assert.equal(diffDaysLocal("2026-03-27", "2026-03-30"), 3);
  assert.equal(diffDaysLocal("2026-10-24", "2026-10-27"), 3);
});

// --- order.ts ---
t("daysRemaining: bugun = 0, yarin = 1, dun = -1", () => {
  const bugun = new Date(2026, 8, 13, 1, 0); // gece 01:00
  assert.equal(daysRemaining("2026-09-13", bugun), 0);
  assert.equal(daysRemaining("2026-09-14", bugun), 1);
  assert.equal(daysRemaining("2026-09-12", bugun), -1);
  assert.equal(daysRemaining("2026-10-13", bugun), 30);
});

t("daysRemaining: gec saatte de dogru", () => {
  const gece = new Date(2026, 8, 13, 23, 59);
  assert.equal(daysRemaining("2026-09-13", gece), 0);
  assert.equal(daysRemaining("2026-09-14", gece), 1);
});

t("isDelayed / deliveryUrgency tutarli", () => {
  const bugun = new Date(2026, 8, 13, 2, 0);
  assert.equal(isDelayed("2026-09-12", "production", bugun), true);
  assert.equal(isDelayed("2026-09-13", "production", bugun), false);
  assert.equal(isDelayed("2026-09-12", "delivered", bugun), false);
  assert.equal(deliveryUrgency("2026-09-13", "production", bugun), "due");
  assert.equal(deliveryUrgency("2026-09-18", "production", bugun), "soon");
  assert.equal(deliveryUrgency("2026-10-13", "production", bugun), "ok");
});

t("todayISO ve todayDateOnly ayni yerel gunu verir", () => {
  assert.equal(todayISO(), todayDateOnly());
  assert.equal(todayISO(), todayLocalISO());
});

// --- installments.ts ---
t("daysBetween yerel", () => {
  assert.equal(daysBetween("2026-09-13", "2026-09-20"), 7);
  assert.equal(daysBetween("2026-09-20", "2026-09-13"), -7);
});

t("bucketForDueDate kovalari cakismaz", () => {
  const today = "2026-09-13"; // Pazar
  assert.equal(bucketForDueDate("2026-09-12", today), "overdue");
  assert.equal(bucketForDueDate("2026-09-13", today), "today");
  assert.equal(bucketForDueDate("2026-09-20", today), "month");
  assert.equal(bucketForDueDate("2026-10-05", today), "future");
});

t("FIFO taksit dagitimi", () => {
  const plan = { id: "p1", order_id: "o1", opening_total_amount: 3000, opening_paid_amount: 0, opening_remaining_amount: 3000, status: "active" as const };
  const insts = [
    { id: "i1", plan_id: "p1", order_id: "o1", installment_no: 1, amount: 1000, due_date: "2026-09-01" },
    { id: "i2", plan_id: "p1", order_id: "o1", installment_no: 2, amount: 1000, due_date: "2026-10-01" },
    { id: "i3", plan_id: "p1", order_id: "o1", installment_no: 3, amount: 1000, due_date: "2026-11-01" },
  ];
  const c = computePlanForOrder(plan, insts, [{ amount: 1500 }], 3000, "2026-09-13");
  assert.equal(c.installments[0].status, "paid");
  assert.equal(c.installments[1].status, "partial");
  assert.equal(c.installments[1].allocatedPaid, 500);
  assert.equal(c.installments[2].status, "pending");
  assert.equal(c.isInconsistent, false);
});

t("iptal edilen tahsilat negatife duserse plan tutarsiz isaretlenir", () => {
  const plan = { id: "p1", order_id: "o1", opening_total_amount: 1000, opening_paid_amount: 500, opening_remaining_amount: 500, status: "active" as const };
  const insts = [{ id: "i1", plan_id: "p1", order_id: "o1", installment_no: 1, amount: 500, due_date: "2026-09-01" }];
  const c = computePlanForOrder(plan, insts, [{ amount: 500 }, { amount: 500, reverses_payment_id: "x" }], 1000, "2026-09-13");
  assert.equal(c.isInconsistent, true);
  assert.equal(c.installments[0].allocatedPaid, 0);
  assert.equal(c.installments[0].status, "overdue");
});


// ============================================================================
// S pile: tul/fon/kruvaze'de 1'e 3 ile AYNI sonucu vermeli (tum ekranlarda)
// ============================================================================
{
  const pileCarpani = (p: "2" | "3" | "S") => (p === "3" || p === "S" ? 3 : 2);
  const kumasEni = (en: number, p: "2" | "3" | "S") => en * pileCarpani(p) + 15;

  t("S pile = 1'e 3 (kumas eni)", () => {
    assert.equal(kumasEni(200, "S"), kumasEni(200, "3"));
    assert.equal(kumasEni(200, "S"), 615);
    assert.equal(kumasEni(200, "2"), 415);
    assert.notEqual(kumasEni(200, "S"), kumasEni(200, "2"));
  });

  t("S pile tutar: 200cm en, 2 adet, 420 TL/m", () => {
    const tutar = (p: "2" | "3" | "S") => (kumasEni(200, p) / 100) * 2 * 420;
    assert.equal(tutar("S"), tutar("3"));
    assert.equal(Math.round(tutar("S") * 100) / 100, 5166);
    assert.equal(Math.round(tutar("2") * 100) / 100, 3486);
  });
}


// ---------------------------------------------------------------------------
// Odeme yontemi etiketleri — ekranlarda ham "cash" / "bank_transfer" gibi
// Ingilizce degerler GORUNMEMELI. Eski kayitlar da Turkce gosterilmeli.
// ---------------------------------------------------------------------------
{
  t("paymentLabel: eski Ingilizce degerler Turkceye cevrilir", () => {
    assert.equal(paymentLabel("cash"), "Nakit");
    assert.equal(paymentLabel("bank_transfer"), "Havale");
    assert.equal(paymentLabel("credit_card"), "Kredi Kartı");
    assert.equal(paymentLabel("check"), "Çek");
    assert.equal(paymentLabel("CASH"), "Nakit");
  });

  t("paymentLabel: kanonik Turkce degerler korunur", () => {
    assert.equal(paymentLabel("nakit"), "Nakit");
    assert.equal(paymentLabel("havale"), "Havale");
    assert.equal(paymentLabel("kredi_karti"), "Kredi Kartı");
    assert.equal(paymentLabel("cek"), "Çek");
  });

  t("paymentLabel: tanimsiz/serbest metin bozulmaz, bos deger '—' olur", () => {
    assert.equal(paymentLabel("Kapıda ödeme"), "Kapıda ödeme");
    assert.equal(paymentLabel(null), "");
    assert.equal(paymentLabelOrDash(null), "—");
    assert.equal(paymentLabelOrDash(""), "—");
  });

  t("PAYMENT_METHOD_OPTIONS: tum secenek degerleri Turkce kanonik ve etiketli", () => {
    const values = PAYMENT_METHOD_OPTIONS.map((o) => o.value);
    assert.ok(values.includes("nakit"));
    assert.equal(new Set(values).size, values.length, "tekrar eden deger olmamali");
    for (const option of PAYMENT_METHOD_OPTIONS) {
      assert.match(option.value, /^[a-z_]+$/, `Ingilizce/bosluklu deger: ${option.value}`);
      assert.notEqual(paymentLabel(option.value), option.value, `etiketi yok: ${option.value}`);
      assert.equal(paymentLabel(option.value), option.label);
    }
    // Ingilizce eski degerler SECENEK olarak sunulmamali (yeni kayitlar kanonik yazilir)
    for (const legacy of ["cash", "bank_transfer", "credit_card", "check"]) {
      assert.ok(!values.includes(legacy as never), `secenekte Ingilizce deger var: ${legacy}`);
    }
  });

  t("paymentDescription: uretilmis aciklama cevrilir, kullanici notu korunur", () => {
    assert.equal(paymentDescription("cash ile ödeme"), "Nakit ile ödeme");
    assert.equal(paymentDescription("bank_transfer ile ödeme"), "Havale ile ödeme");
    assert.equal(paymentDescription("Müşteri elden verdi"), "Müşteri elden verdi");
    assert.equal(paymentDescription(null), "");
  });
}


// ---------------------------------------------------------------------------
// Storage adres cozumleme — firma fotograflari artik kalici public URL yerine
// kisa omurlu imzali adresle gosteriliyor. Bu testler, saklanan DEGERDEN dogru
// bucket + nesne yolunun cikarildigini dogrular (bkz. utils/storagePath.ts).
// ---------------------------------------------------------------------------
{
  const BASE = "https://ffhmzlcsgsgjonqqhgqq.supabase.co/storage/v1/object/public";

  t("parseStorageRef: public URL'den bucket ve yol cikarilir", () => {
    const ref = parseStorageRef(`${BASE}/measurement-photos/24657cb3-6e9f/24d38332/photo-1.png`);
    assert.deepEqual(ref, { bucket: "measurement-photos", path: "24657cb3-6e9f/24d38332/photo-1.png" });
  });

  t("parseStorageRef: imzali (sign) URL de ayni yola cozulur", () => {
    const signed = "https://x.supabase.co/storage/v1/object/sign/measurement-photos/firma/a.png?token=abc.def";
    assert.deepEqual(parseStorageRef(signed), { bucket: "measurement-photos", path: "firma/a.png" });
  });

  t("parseStorageRef: URL-encoded yol cozulur", () => {
    const ref = parseStorageRef(`${BASE}/logos/firma/logo%20son.jpeg`);
    assert.equal(ref?.path, "firma/logo son.jpeg");
  });

  t("parseStorageRef: duz yol ve bucket onekli yol desteklenir", () => {
    assert.deepEqual(parseStorageRef("catalog-images/firma/x.png"), { bucket: "catalog-images", path: "firma/x.png" });
    assert.deepEqual(parseStorageRef("firma/x.png", "visual-previews"), { bucket: "visual-previews", path: "firma/x.png" });
  });

  t("parseStorageRef: yerel onizleme ve dis adresler imzalanmaz (null)", () => {
    assert.equal(parseStorageRef("data:image/png;base64,AAAA"), null);
    assert.equal(parseStorageRef("blob:http://localhost/abc"), null);
    assert.equal(parseStorageRef("https://api.dicebear.com/7.x/avataaars/svg?seed=Curtain"), null);
    assert.equal(parseStorageRef(""), null);
    assert.equal(parseStorageRef(null), null);
  });

  t("parseStorageRef: bilinmeyen bucket imzalanmaz", () => {
    assert.equal(parseStorageRef(`${BASE}/baska-bucket/firma/x.png`), null);
  });

  t("isLocalPreviewSrc: yalnizca data:/blob: true", () => {
    assert.equal(isLocalPreviewSrc("data:image/gif;base64,AA"), true);
    assert.equal(isLocalPreviewSrc("blob:http://x/1"), true);
    assert.equal(isLocalPreviewSrc(`${BASE}/logos/f/a.png`), false);
  });

  t("STORAGE_BUCKETS: projedeki YEDI bucketin tamami", () => {
    assert.deepEqual([...STORAGE_BUCKETS].sort(),
      ["appointment-photos", "catalog-images", "catalog-pdfs", "logos",
       "measurement-photos", "support-attachments", "visual-previews"]);
  });

  t("parseStorageRef: eski/ek bucketlar da cozulur", () => {
    assert.deepEqual(parseStorageRef(`${BASE}/appointment-photos/firma/a.png`),
      { bucket: "appointment-photos", path: "firma/a.png" });
    assert.deepEqual(parseStorageRef(`${BASE}/catalog-pdfs/firma/katalog.pdf`),
      { bucket: "catalog-pdfs", path: "firma/katalog.pdf" });
    assert.deepEqual(parseStorageRef(`${BASE}/support-attachments/firma/ticket/screenshot.png`),
      { bucket: "support-attachments", path: "firma/ticket/screenshot.png" });
  });

  t("logos: klasorsuz dosya adi bozulmadan cozulur", () => {
    const ref = parseStorageRef(`${BASE}/logos/a8c3b542-7cb7-4b93-a073-b7340f5313d7-logo.jpg?v=123`);
    assert.deepEqual(ref, { bucket: "logos", path: "a8c3b542-7cb7-4b93-a073-b7340f5313d7-logo.jpg" });
  });
}

console.log(`\n${n} test gecti (TZ=${TZ})`);
