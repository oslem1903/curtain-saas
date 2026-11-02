// npx tsx scripts/check-locked-native.ts
// Native (iOS/Android) kilit ekrani metinleri ve destek talebi: satın alma / fiyat / ödeme / lisans alma dili YOK.
// Web ve Windows metinleri değişmemiş olmalı.
import { buildSupportTicket, getLockedContent, retryCheckMessage, supportButtonLabel, supportSuccessMessage } from "../src/utils/lockedContent";

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} ${m}`); };

const REASONS = ["inactive_user", "inactive_member", "inactive_company", "expired_trial", "read_only", "device_limit", "unknown", "bilinmeyen_sebep", null];
const FORBIDDEN = /satın|satin|fiyat|ödeme|odeme|\bTL\b|abonelik|paket|yenile|lisans\s*al|kampanya|indirim|payment|checkout|paytr|wa\.me|whatsapp/i;

for (const r of REASONS) {
  const c = getLockedContent(r, true);
  ok(!FORBIDDEN.test(`${c.title} ${c.text}`), `native metin satın alma dili içermez (${r})`);
}
ok(!FORBIDDEN.test(supportButtonLabel(true, false)) && supportButtonLabel(true, false) === "Destek", "native düğme yalnızca 'Destek'");
ok(supportButtonLabel(true, true) === "Talep gonderiliyor...", "native gönderiliyor etiketi");
ok(!FORBIDDEN.test(retryCheckMessage(true)), "native 'tekrar dene' mesajı temiz");
ok(!FORBIDDEN.test(supportSuccessMessage(true)), "native destek başarı mesajı temiz");

for (const r of REASONS) {
  const t = buildSupportTicket({ companyId: "c1", companyName: "Demo Perde", lockReason: r as string, deviceId: "d1", pageUrl: "https://app/#/locked", userAgent: "UA", deviceName: "iPhone / tr" }, true);
  const blob = JSON.stringify([t.p_title, t.p_description, t.p_support_metadata.kind]);
  ok(!FORBIDDEN.test(blob), `native destek talebi içeriği temiz (${r}): ${t.p_title}`);
  ok(t.p_category === "request", `native kategori 'request' (${r})`);
}
const dl = buildSupportTicket({ companyId: "c1", companyName: "X", lockReason: "device_limit", deviceId: "d", pageUrl: "u", userAgent: "ua", deviceName: "n" }, true);
ok(dl.p_support_metadata.kind === "device_limit" && dl.p_priority === "high", "native cihaz limiti talebi süper admin ayrımını korur (kind=device_limit, high)");
const nm = buildSupportTicket({ companyId: "c1", companyName: "X", lockReason: "expired_trial", deviceId: "d", pageUrl: "u", userAgent: "ua", deviceName: "n" }, true);
ok(nm.p_title === "Destek talebi" && nm.p_support_metadata.kind === "support" && nm.p_company_id === "c1", "native normal destek talebi: başlık 'Destek talebi', kind=support, firma bilgisi korunur");

// Web/Windows aynen
ok(getLockedContent("expired_trial", false).text.includes("lisans satın aldığınızda"), "web: deneme bitti metni değişmedi");
ok(getLockedContent("read_only", false).text.includes("lisansınızı yenileyin"), "web: salt okunur metni değişmedi");
ok(supportButtonLabel(false, false) === "Destek / Lisans Al", "web: düğme 'Destek / Lisans Al'");
const wt = buildSupportTicket({ companyId: "c1", companyName: "X", lockReason: "expired_trial", deviceId: "d", pageUrl: "u", userAgent: "ua", deviceName: "n" }, false);
ok(wt.p_title === "Lisans / destek talebi" && wt.p_support_metadata.kind === "license_support" && wt.p_category === "request", "web: talep başlığı/kind/kategori değişmedi");
const wd = buildSupportTicket({ companyId: "c1", companyName: "X", lockReason: "device_limit", deviceId: "d", pageUrl: "u", userAgent: "ua", deviceName: "n" }, false);
ok(wd.p_category === "payment" && wd.p_title === "Cihaz limiti talebi", "web: cihaz limiti talebi eski davranış (kategori payment)");

console.log(fail ? `\n${fail} KONTROL BASARISIZ` : "\nTUM KONTROLLER GECTI");
process.exit(fail ? 1 : 0);
