/**
 * billing-checkout — Solo/PerdePRO tek seferlik dönem satın alma (PayTR iFrame API).
 *
 * Girdi : { company_id, plan_code, accepted_terms: true }   (JWT'li)
 * Çıktı : { intent_id, paymentPageUrl }
 *
 * GÜVENLİK
 *   - Fiyat/plan SUNUCUDAKİ billing_plans'tan okunur; istemci yalnız kod gönderir.
 *   - Çağıran, hedef firmanın aktif admin üyesi olmalı (RLS'li kullanıcı istemcisiyle doğrulanır).
 *   - Erişim BURADA açılmaz: yalnız paytr-callback'in doğrulanmış bildirimi lisans uzatır.
 *   - merchant_key / merchant_salt yalnız ortam değişkenindedir; loglanmaz.
 *   - PAYTR_TEST_MODE=1 iken yalnız billing_test_companies'teki firmalar ödeme başlatabilir.
 * Gerekli ortam: BILLING_ENABLED=1, PAYTR_MERCHANT_ID, PAYTR_MERCHANT_KEY, PAYTR_MERCHANT_SALT,
 *   APP_PUBLIC_URL (https://<web-adresi>), isteğe bağlı PAYTR_TEST_MODE=1, ALLOWED_ORIGINS.
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


const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const corsFor = (origin: string | null) => ({
  'Access-Control-Allow-Origin':
    origin && (ALLOWED_ORIGINS.includes(origin) || origin === 'null' || /^https?:\/\/localhost(:\d+)?$/.test(origin))
      ? origin
      : (ALLOWED_ORIGINS[0] ?? ''),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
});

Deno.serve(async (req) => {
  const cors = corsFor(req.headers.get('Origin'));
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (Deno.env.get('BILLING_ENABLED') !== '1') return json({ error: 'billing_disabled' }, 503);

  const url = Deno.env.get('SUPABASE_URL')!;
  const merchantId = Deno.env.get('PAYTR_MERCHANT_ID');
  const merchantKey = Deno.env.get('PAYTR_MERCHANT_KEY');
  const merchantSalt = Deno.env.get('PAYTR_MERCHANT_SALT');
  const appUrl = (Deno.env.get('APP_PUBLIC_URL') ?? '').replace(/\/+$/, '');
  if (!merchantId || !merchantKey || !merchantSalt || !appUrl) return json({ error: 'provider_not_configured' }, 503);
  const testMode: 0 | 1 = Deno.env.get('PAYTR_TEST_MODE') === '1' ? 1 : 0;

  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return json({ error: 'unauthorized' }, 401);

  const { company_id, plan_code, accepted_terms } = await req.json().catch(() => ({}));
  if (!company_id || !plan_code) return json({ error: 'bad_request' }, 400);
  if (accepted_terms !== true) return json({ error: 'consent_required' }, 400);

  const { data: mem } = await userClient
    .from('company_members').select('role,is_active')
    .eq('company_id', company_id).eq('user_id', u.user.id).maybeSingle();
  if (!mem || mem.is_active === false || mem.role !== 'admin') return json({ error: 'forbidden' }, 403);

  const sb = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  if (testMode === 1) {
    // Test modunda müşteriye ödeme ekranı açılmaz: yalnız işaretli test firmaları.
    const { data: isTest } = await sb.rpc('billing_is_test_company', { p_company_id: company_id });
    if (isTest !== true) return json({ error: 'billing_disabled' }, 503);
  }

  const { data: intent, error: ie } = await sb.rpc('billing_create_intent', {
    p_channel: 'paytr', p_company_id: company_id, p_plan_code: plan_code, p_created_by: u.user.id,
  });
  if (ie || !intent?.intent_id) return json({ error: 'plan_unavailable' }, 400);

  const [{ data: co }, { data: prof }] = await Promise.all([
    sb.from('companies').select('name,phone,address').eq('id', company_id).maybeSingle(),
    sb.from('profiles').select('full_name').eq('user_id', u.user.id).maybeSingle(),
  ]);
  const merchantOid = intentIdToOid(intent.intent_id);
  const amountMinor = Number(intent.amount_minor);
  const basket = buildBasketB64([
    { name: String(intent.plan_name ?? 'PerdePRO').slice(0, 80), unitPrice: amountMinor / 100, qty: 1 },
  ]);
  const email = paytrSafeEmail(u.user.email ?? '');
  const userIp = firstIp(req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip'));
  const paytrToken = await computePaytrToken({
    merchantId, merchantKey, merchantSalt, userIp, merchantOid, email,
    paymentAmountMinor: amountMinor, userBasketB64: basket,
    noInstallment: 1, maxInstallment: 0, currency: 'TL', testMode,
  });

  const form = new URLSearchParams({
    merchant_id: merchantId, user_ip: userIp, merchant_oid: merchantOid, email,
    payment_amount: String(amountMinor), paytr_token: paytrToken, user_basket: basket,
    debug_on: Deno.env.get('PAYTR_DEBUG') === '1' ? '1' : '0',
    no_installment: '1', max_installment: '0',
    user_name: String(prof?.full_name || co?.name || 'Firma Yöneticisi').slice(0, 60),
    user_address: String(co?.address || 'Türkiye').slice(0, 400),
    user_phone: String(co?.phone || '05000000000').slice(0, 20),
    // Dönüş sayfası LİSANS AÇMAZ; yalnız durumu gösterir. Lisans paytr-callback bildirimiyle açılır.
    merchant_ok_url: `${appUrl}/#/subscription?payment=pending`,
    merchant_fail_url: `${appUrl}/#/subscription?payment=failed`,
    timeout_limit: '30', currency: 'TL', test_mode: String(testMode), lang: 'tr',
  });

  let iframeToken = '';
  let reason = '';
  try {
    const r = await fetch('https://www.paytr.com/odeme/api/get-token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
    });
    const j = await r.json().catch(() => ({}));
    if (j?.status === 'success' && j?.token) iframeToken = String(j.token);
    else reason = String(j?.reason ?? `HTTP ${r.status}`).slice(0, 200);
  } catch (e) {
    reason = `bağlantı hatası: ${e instanceof Error ? e.message.slice(0, 80) : 'bilinmiyor'}`;
  }
  if (!iframeToken) {
    console.error('billing-checkout: paytr token alınamadı', reason);
    await sb.rpc('billing_mark_intent', { p_intent_id: intent.intent_id, p_status: 'failed' });
    return json({ error: 'provider_error' }, 502);
  }
  await sb.rpc('billing_set_intent_token', { p_intent_id: intent.intent_id, p_token: iframeToken });
  return json({
    intent_id: intent.intent_id,
    paymentPageUrl: `https://www.paytr.com/odeme/guvenli/${iframeToken}`,
    test_mode: testMode === 1,
  });
});
