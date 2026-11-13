import assert from "node:assert/strict";
import { buildSupplierMessage, distinctSupplierIds, itemsForSupplier, whatsappPhoneDigits, whatsappUrl } from "../src/utils/supplierWhatsapp.ts";
import {
  MAX_WIDTH_SEGMENTS, coveredWidth, parseSegments, serializeSegments, stripSegmentsMarker, totalWidth, validateSegments,
  type SegmentedWidth,
} from "../src/utils/segmentedWidth.ts";
import { calculate } from "../src/constants/measurementConstants.ts";

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log("  ok  " + name); };

// ---------- Tedarikçi WhatsApp ----------
const items = [
  { id: "1", product_type: "stor", width_cm: 120, height_cm: 200, qty: 2, supplier_id: "A", unit_price: 999, supplier_unit_cost: 321,
    note: "ICNOT-GIZLI musteri evde degil", product_options: { model_name: "Lina", color_name: "Krem", product_code: "LN-12", supplier_note: "Zincir sağ" } },
  { id: "2", product_type: "zebra", width_cm: 90, height_cm: 150, qty: 1, supplier_id: "B", product_options: { field_info: { model_name: "Z1", color_name: "Gri" } } },
  { id: "3", product_type: "tul", width_cm: 300, height_cm: 250, qty: 1, supplier_id: "A", product_options: {} },
];

t("iki tedarikçi ayrışır", () => assert.deepEqual(distinctSupplierIds(items), ["A", "B"]));
t("her mesaj yalnızca kendi kalemlerini içerir", () => {
  const msgFor = (sid: string) => buildSupplierMessage({ orderNo: "AB12CD34", supplierName: sid, items: itemsForSupplier(items, sid).map(i => ({ ...i, productLabel: i.product_type })) });
  const a = msgFor("A"); const b = msgFor("B");
  assert.match(a, /Sipariş No: #AB12CD34/);
  assert.match(a, /stor - Lina/); assert.match(a, /Renk: Krem/); assert.match(a, /Ürün kodu: LN-12/);
  assert.match(a, /120 × 200 cm/); assert.match(a, /Adet: 2/); assert.match(a, /Not: Zincir sağ/);
  assert.match(a, /tul/); assert.doesNotMatch(a, /zebra/);
  assert.match(b, /zebra - Z1/); assert.doesNotMatch(b, /stor|tul|Lina/);
});
t("müşteri/fiyat/iç not mesajda yok", () => {
  const m = buildSupplierMessage({ orderNo: "X", supplierName: "A", items: [{ ...items[0], productLabel: "Stor" }] });
  assert.doesNotMatch(m, /ICNOT|999|321|musteri/i);
});
t("telefon doğrulama", () => {
  assert.equal(whatsappPhoneDigits("0532 123 45 67"), "905321234567");
  assert.equal(whatsappPhoneDigits("+90 532 123 45 67"), "905321234567");
  assert.equal(whatsappPhoneDigits("5321234567"), "905321234567");
  assert.equal(whatsappPhoneDigits(""), null);
  assert.equal(whatsappPhoneDigits(null), null);
  assert.equal(whatsappPhoneDigits("12345"), null);
  assert.equal(whatsappPhoneDigits("0212 123 45 67"), null); // sabit hat WhatsApp değil
  assert.equal(whatsappPhoneDigits("abc"), null);
});
t("wa.me URL kodlanır", () => {
  const u = whatsappUrl("905321234567", "a b\nç");
  assert.equal(u, "https://wa.me/905321234567?text=a%20b%0A%C3%A7");
});
t("paylaşım saf: girdi kalemleri değişmez", () => {
  const before = JSON.stringify(items);
  buildSupplierMessage({ orderNo: "X", supplierName: "A", items: items.map(i => ({ ...i, productLabel: "x" })) });
  assert.equal(JSON.stringify(items), before);
});

// ---------- Parçalı En ----------
const mk = (cms: number[], names: string[] = []): SegmentedWidth => ({
  segments: cms.map((cm, i) => ({ id: `s${i}`, name: names[i] ?? `P${i}`, cm })), selectedIds: [],
});
const five = mk([40, 180, 30, 75, 75], ["Sol duvar", "Pencere", "Sağ duvar", "Sürgülü kapı sol", "Sürgülü kapı sağ"]);

t("5 parça = 400 cm", () => { assert.equal(totalWidth(five.segments), 400); assert.equal(coveredWidth(five), 400); assert.equal(validateSegments(five), null); });
t("yalnızca pencere seçilince 180 cm", () => {
  const sel = { ...five, selectedIds: ["s1"] };
  assert.equal(coveredWidth(sel), 180);
  assert.equal(totalWidth(sel.segments), 400);
});
t("birden çok parça seçimi toplanır", () => assert.equal(coveredWidth({ ...five, selectedIds: ["s0", "s1"] }), 220));
t("serialize/parse gidiş-dönüş: ad, sıra, ölçü ve seçim aynen", () => {
  const sel = { ...five, selectedIds: ["s1"] };
  const note = `Not\n[Grup: g1]\n${serializeSegments(sel)}`;
  const back = parseSegments(note)!;
  assert.deepEqual(back.segments.map(s => [s.name, s.cm]), five.segments.map(s => [s.name, s.cm]));
  assert.equal(coveredWidth(back), 180);
  assert.equal(totalWidth(back.segments), 400);
  assert.equal(stripSegmentsMarker(note), "Not\n[Grup: g1]");
});
t("eski kayıt (işaret yok) null döner", () => { assert.equal(parseSegments("Not\n[Grup: g]"), null); assert.equal(parseSegments(null), null); });
t("bozuk işaret güvenle yok sayılır", () => { assert.equal(parseSegments("[Parcalar: {bozuk}]"), null); });
t("6 parça reddedilir", () => assert.ok(validateSegments(mk([1, 1, 1, 1, 1, 1]))));
t("sıfır / negatif / NaN reddedilir", () => {
  assert.ok(validateSegments(mk([40, 0])));
  assert.ok(validateSegments(mk([40, -5])));
  assert.ok(validateSegments(mk([40, NaN])));
  assert.ok(validateSegments(mk([])));
  assert.equal(serializeSegments(mk([40, 0])), "");
  assert.equal(MAX_WIDTH_SEGMENTS, 5);
});
t("pencere 180 cm mevcut kurallara girer (stor: ceil10, min 100x200)", () => {
  const r = calculate("stor", coveredWidth({ ...five, selectedIds: ["s1"] }), 210, 1, 100);
  assert.equal(r.roundedWidth, 180); assert.equal(r.roundedHeight, 210);
  assert.equal(r.areaM2, 1.8 * 2.1);
  const small = calculate("stor", coveredWidth({ ...mk([40]), selectedIds: [] }), 150, 1, 100);
  assert.equal(small.roundedWidth, 100); assert.equal(small.roundedHeight, 200); // min ölçü kuralı sürer
  const tul = calculate("tul", 180, 250, 1, 100, "2");
  assert.equal(tul.fabricWidthCm, 380); // 180*2+20
});
t("eski tek-ölçülü kayıt: hesap değişmez", () => {
  const r = calculate("stor", 123, 201, 2, 50);
  assert.equal(r.roundedWidth, 130); assert.equal(r.roundedHeight, 210);
});

console.log(`\n${n} test gecti`);
