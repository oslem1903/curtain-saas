/**
 * PayTR iFrame API yardimcilari (SAF mantik; Deno ve Node/vitest'te ayni calisir).
 * Kaynak: https://dev.paytr.com/iframe-api (1. adim: token, 2. adim: bildirim).
 *
 * Token  : base64(HMAC_SHA256(merchant_key, merchant_id + user_ip + merchant_oid + email +
 *          payment_amount + user_basket + no_installment + max_installment + currency +
 *          test_mode + merchant_salt))
 * Callback hash: base64(HMAC_SHA256(merchant_key, merchant_oid + merchant_salt + status + total_amount))
 *
 * merchant_key / merchant_salt YALNIZ sunucu ortamindadir; hicbiri istege eklenmez/loglanmaz.
 */
const enc = new TextEncoder();

async function hmacBase64(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
  let s = '';
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export interface PaytrTokenInput {
  merchantId: string;
  merchantKey: string;
  merchantSalt: string;
  userIp: string;
  merchantOid: string;
  email: string;
  paymentAmountMinor: number; // kurus (tutar x 100)
  userBasketB64: string;
  noInstallment: 0 | 1;
  maxInstallment: number;
  currency: string; // 'TL'
  testMode: 0 | 1;
}

/** paytr_token (1. adim) */
export async function computePaytrToken(i: PaytrTokenInput): Promise<string> {
  const hashStr =
    i.merchantId + i.userIp + i.merchantOid + i.email + String(i.paymentAmountMinor) + i.userBasketB64 +
    String(i.noInstallment) + String(i.maxInstallment) + i.currency + String(i.testMode);
  return hmacBase64(i.merchantKey, hashStr + i.merchantSalt);
}

/** user_basket: [[ad, "birim fiyat", adet]] -> base64(JSON). Fiyat ondalik STRING (x100 degil). */
export function buildBasketB64(items: { name: string; unitPrice: number; qty: number }[]): string {
  const json = JSON.stringify(items.map((i) => [i.name, i.unitPrice.toFixed(2), i.qty]));
  // btoa Latin1 ister: UTF-8 baytlari uzerinden
  const bytes = enc.encode(json);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** tutar (TL) -> kurus (tamsayi) */
export function toKurus(amount: number | string): number {
  return Math.round(Number(amount) * 100);
}

/** merchant_oid: yalniz alfanumerik, <=64. Tahmin edilemez, firma/paket bilgisi icermez. */
export function newMerchantOid(): string {
  const u = crypto.randomUUID().replace(/-/g, '');
  return `PRD${u}`; // 35 karakter; PerdePRO oneki
}

/** Bildirim hash dogrulama (2. adim). Sabit sureli karsilastirma. */
export async function verifyPaytrCallbackHash(
  p: { merchant_oid?: string; status?: string; total_amount?: string; hash?: string },
  merchantKey: string,
  merchantSalt: string,
): Promise<boolean> {
  if (!p.merchant_oid || !p.status || p.total_amount === undefined || !p.hash) return false;
  const expected = await hmacBase64(merchantKey, p.merchant_oid + merchantSalt + p.status + p.total_amount);
  return timingSafeEqual(expected, p.hash);
}

/** PayTR e-posta alani Turkce karakter kabul etmez, <=100 */
export function paytrSafeEmail(email: string): string {
  return email.replace(/[^\x20-\x7E]/g, '').slice(0, 100);
}

export function firstIp(xff: string | null | undefined, fallback = '127.0.0.1'): string {
  const ip = (xff ?? '').split(',')[0].trim();
  return /^[0-9a-fA-F:.]{3,39}$/.test(ip) ? ip : fallback;
}

/** merchant_oid <-> billing_intents.id (UUID). Yalniz bu urunun oneki kabul edilir. */
export function intentIdToOid(intentId: string): string {
  return `PRD${intentId.replace(/-/g, '')}`;
}
export function oidToIntentId(oid: string): string | null {
  const m = /^PRD([0-9a-f]{32})$/i.exec(oid);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
