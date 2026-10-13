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
import { oidToIntentId, verifyPaytrCallbackHash } from '../_shared/paytr.ts';

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
