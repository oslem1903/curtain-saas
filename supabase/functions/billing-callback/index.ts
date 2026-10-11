// iyzico odeme sayfasindan donus (tarayici POST eder). DAGITILMADI. Dagitim: --no-verify-jwt
// Donus sayfasi ERISIM ACMAZ: sonuc iyzico'dan sunucuda token ile sorgulanir; ayni dogrulama yolu webhook ile ortaktir.
import { createClient } from "npm:@supabase/supabase-js@2";
import { CHECKOUT_DETAIL_PATH, iyzicoPost, type IyzicoConfig } from "../_shared/iyzico.ts";
import { verifyAndApply } from "../_shared/iyzico_webhook.ts";

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const intentId = u.searchParams.get("intent") ?? "";
  const appUrl = Deno.env.get("APP_PUBLIC_URL") ?? "";
  const back = (status: string) => Response.redirect(`${appUrl}/#/subscription?payment=${status}`, 303);

  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  const cfg: IyzicoConfig = {
    apiKey: Deno.env.get("IYZICO_API_KEY") ?? "",
    secretKey: Deno.env.get("IYZICO_SECRET_KEY") ?? "",
    baseUrl: Deno.env.get("IYZICO_BASE_URL") ?? "",
  };
  if (!token || !intentId || !appUrl || !cfg.apiKey || !cfg.baseUrl) return back("error");

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const out = await verifyAndApply(
      {
        retrieveDetail: async (t) => { const r = await iyzicoPost(cfg, CHECKOUT_DETAIL_PATH, { token: t, locale: "tr" }); return r.ok ? r.json : null; },
        getIntent: async (id) => { const { data } = await sb.rpc("billing_get_intent", { p_intent_id: id }); return (Array.isArray(data) ? data[0] : data) ?? null; },
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
      token,
      intentId,
    );
    if (out.status === "applied" || out.status === "duplicate") return back("success");
    if (out.reason === "payment_failed") return back("failed");
    return back("pending"); // dogrulama bekleniyor; webhook tamamlar
  } catch {
    return back("error");
  }
});
