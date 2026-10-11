// iyzico abonelik webhook'u. Dagitim: `supabase functions deploy billing-webhook-iyzico --no-verify-jwt`
// Gerekli gizli degerler (supabase secrets set ...): IYZICO_API_KEY, IYZICO_SECRET_KEY, IYZICO_MERCHANT_ID, IYZICO_BASE_URL
// (SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY platform tarafindan verilir). Hicbiri istemciye veya depoya girmez.
import { createClient } from "npm:@supabase/supabase-js@2";
import { iyzicoRequest, type IyzicoConfig } from "../_shared/iyzico.ts";
import { handleIyzicoSubscriptionWebhook } from "../_shared/iyzico_webhook.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const cfg: IyzicoConfig = {
    apiKey: Deno.env.get("IYZICO_API_KEY") ?? "",
    secretKey: Deno.env.get("IYZICO_SECRET_KEY") ?? "",
    merchantId: Deno.env.get("IYZICO_MERCHANT_ID") ?? "",
    // Varsayilan SANDBOX; canli adres yalnizca bilincli olarak IYZICO_BASE_URL ile verilir.
    baseUrl: Deno.env.get("IYZICO_BASE_URL") ?? "https://sandbox-api.iyzipay.com",
  };
  if (!cfg.apiKey || !cfg.secretKey || !cfg.merchantId) return new Response("not configured", { status: 503 });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));

  const result = await handleIyzicoSubscriptionWebhook(
    {
      merchantId: cfg.merchantId,
      secretKey: cfg.secretKey,
      getSubscription: async (ref) => {
        const r = await iyzicoRequest(cfg, "GET", `/v2/subscription/subscriptions/${encodeURIComponent(ref)}`);
        const item = r.ok ? r.json?.data?.items?.[0] ?? r.json?.data : null;
        return item ?? null;
      },
      lookupSubscription: async (ref) => {
        const { data } = await sb.rpc("billing_lookup_subscription", { p_channel: "iyzico", p_provider_subscription_ref: ref });
        const row = Array.isArray(data) ? data[0] : data;
        return row ?? null;
      },
      applyCharge: async (a) => {
        const { data, error } = await sb.rpc("billing_apply_charge", {
          p_channel: "iyzico", p_event_id: a.eventId, p_company_id: a.companyId, p_plan_code: a.planCode,
          p_provider_payment_id: a.paymentId, p_amount_minor: a.amountMinor, p_currency: a.currency,
          p_provider_subscription_ref: a.subscriptionRef, p_payload: a.payload,
        });
        if (error) throw error;
        return data;
      },
      recordFailure: async (a) => {
        const { data, error } = await sb.rpc("billing_record_failure", {
          p_channel: "iyzico", p_event_id: a.eventId, p_company_id: a.companyId, p_reason: a.reason, p_payload: a.payload,
        });
        if (error) throw error;
        return data;
      },
    },
    req.headers.get("x-iyz-signature-v3"),
    body,
  );
  return new Response(JSON.stringify(result.body), { status: result.http, headers: { "Content-Type": "application/json" } });
});
