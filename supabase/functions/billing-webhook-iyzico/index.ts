// iyzico webhook (Checkout Form / tek seferlik odeme). Dagitim: `supabase functions deploy billing-webhook-iyzico --no-verify-jwt`
// DAGITILMADI. Gizli degerler (supabase secrets set): IYZICO_API_KEY, IYZICO_SECRET_KEY, IYZICO_BASE_URL (zorunlu, varsayilan yok).
// Webhook imza ozelligi iyzico hesabinda (entegrasyon@iyzico.com) etkinlestirilmis olmalidir.
import { createClient } from "npm:@supabase/supabase-js@2";
import { CHECKOUT_DETAIL_PATH, iyzicoPost, type IyzicoConfig } from "../_shared/iyzico.ts";
import { handleIyzicoWebhook } from "../_shared/iyzico_webhook.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const cfg: IyzicoConfig = {
    apiKey: Deno.env.get("IYZICO_API_KEY") ?? "",
    secretKey: Deno.env.get("IYZICO_SECRET_KEY") ?? "",
    baseUrl: Deno.env.get("IYZICO_BASE_URL") ?? "",
  };
  if (!cfg.apiKey || !cfg.secretKey || !cfg.baseUrl) return new Response("not configured", { status: 503 });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));

  const result = await handleIyzicoWebhook(
    {
      secretKey: cfg.secretKey,
      retrieveDetail: async (token) => {
        const r = await iyzicoPost(cfg, CHECKOUT_DETAIL_PATH, { token, locale: "tr" });
        return r.ok ? r.json : null;
      },
      getIntent: async (id) => {
        const { data } = await sb.rpc("billing_get_intent", { p_intent_id: id });
        return (Array.isArray(data) ? data[0] : data) ?? null;
      },
      applyCharge: async (a) => {
        const { data, error } = await sb.rpc("billing_apply_charge", {
          p_channel: "iyzico", p_event_id: a.eventId, p_company_id: a.intent.company_id, p_plan_code: a.intent.plan_code,
          p_provider_payment_id: a.paymentId, p_amount_minor: a.amountMinor, p_currency: a.currency, p_payload: a.payload,
        });
        if (error) throw error;
        return data;
      },
      markIntent: async (id, status) => { await sb.rpc("billing_mark_intent", { p_intent_id: id, p_status: status }); },
    },
    req.headers.get("x-iyz-signature-v3"),
    body,
  );
  return new Response(JSON.stringify(result.body), { status: result.http, headers: { "Content-Type": "application/json" } });
});
