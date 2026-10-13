/**
 * paytr-callback — PayTR "Bildirim URL" (sunucudan sunucuya).
 * Dağıtım: supabase functions deploy paytr-callback --no-verify-jwt
 * PayTR mağaza panelinde Bildirim URL: https://<REF>.supabase.co/functions/v1/paytr-callback
 *
 * - hash = base64(HMAC_SHA256(merchant_key, merchant_oid + merchant_salt + status + total_amount));
 *   geçersizse işlem YOK ve "OK" dönülmez.
 * - Yalnız "PRD" önekli (PerdePRO) siparişler işlenir; başka ürünün siparişi için "OK" dönülür, hiçbir şey yazılmaz.
 * - İşlem kalıcı yazılmadan "OK" dönülmez (PayTR yeniden dener); aynı ödeme ikinci kez süre uzatmaz
 *   (billing_apply_charge olay + ödeme benzersizliği).
 * - Başarı/dönüş sayfası lisans açmaz; yalnız bu doğrulanmış bildirim açar.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
// --- _shared/paytr.ts ile ayni kod, panelden tek dosya olarak dagitilabilsin diye satir ici ---
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


const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return text('method not allowed', 405);
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const key = Deno.env.get('PAYTR_MERCHANT_KEY');
  const salt = Deno.env.get('PAYTR_MERCHANT_SALT');
  if (!url || !serviceKey || !key || !salt) return text('not configured', 503); // "OK" değil: PayTR tekrar dener

  const form = await req.formData().catch(() => null);
  if (!form) return text('bad request', 400);
  const p = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  if (!(await verifyPaytrCallbackHash(p, key, salt))) return text('invalid hash', 400);

  const intentId = oidToIntentId(p.merchant_oid);
  if (!intentId) return text('OK'); // başka ürün/bilinmeyen sipariş: işlenecek bir şey yok

  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const totalMinor = Number(p.total_amount);
  if (!Number.isFinite(totalMinor)) return text('bad amount', 400);

  const { data: intents } = await sb.rpc('billing_get_intent', { p_intent_id: intentId });
  const intent = Array.isArray(intents) ? intents[0] : intents;
  if (!intent) return text('OK');

  if (p.status !== 'success') {
    await sb.rpc('billing_record_failure', {
      p_channel: 'paytr', p_event_id: `${p.merchant_oid}:failed`, p_company_id: intent.company_id,
      p_reason: String(p.failed_reason_msg ?? p.failed_reason_code ?? 'failed').slice(0, 200),
    });
    await sb.rpc('billing_mark_intent', { p_intent_id: intentId, p_status: 'failed' });
    return text('OK');
  }

  const currency = String(p.currency ?? 'TL').toUpperCase();
  const { data, error } = await sb.rpc('billing_apply_charge', {
    p_channel: 'paytr', p_event_id: p.merchant_oid, p_company_id: intent.company_id, p_plan_code: intent.plan_code,
    p_provider_payment_id: p.merchant_oid, p_amount_minor: Math.round(totalMinor),
    p_currency: currency === 'TL' ? 'TRY' : currency,
    p_provider_subscription_ref: null,
    p_payload: { payment_type: p.payment_type ?? null, test_mode: p.test_mode ?? null },
    p_test_mode: p.test_mode === '1',
  });
  if (error) {
    console.error('paytr-callback: işleme hatası', error.message);
    return text('processing error', 500); // OK değil: PayTR yeniden dener
  }
  if (data?.status === 'applied' || data?.status === 'duplicate') {
    await sb.rpc('billing_mark_intent', { p_intent_id: intentId, p_status: 'paid' });
  }
  console.info('paytr-callback:', JSON.stringify({ result: data?.status }));
  return text('OK');
});
