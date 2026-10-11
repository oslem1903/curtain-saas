// Tek seferlik donem satin alma baslatir (otomatik yenileme YOK). DAGITILMADI. Dagitim: `supabase functions deploy billing-checkout`
// Girdi: { company_id, plan_code }. Yalnizca o firmanin aktif yoneticisi baslatabilir; fiyat/plan sunucuda belirlenir.
import { createClient } from "npm:@supabase/supabase-js@2";
import { CHECKOUT_INIT_PATH, iyzicoPost, type IyzicoConfig } from "../_shared/iyzico.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (Deno.env.get("BILLING_ENABLED") !== "1") return json({ error: "billing_disabled" }, 503);

  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return json({ error: "unauthorized" }, 401);

  const { company_id, plan_code, accepted_terms } = await req.json().catch(() => ({}));
  if (!company_id || !plan_code) return json({ error: "bad_request" }, 400);
  // Acik onay: kullanici tek seferlik tahsilati ve tutari onaylamadan odeme baslatilmaz.
  if (accepted_terms !== true) return json({ error: "consent_required" }, 400);

  const { data: mem } = await userClient.from("company_members").select("role,is_active").eq("company_id", company_id).eq("user_id", u.user.id).maybeSingle();
  if (!mem || mem.is_active === false || mem.role !== "admin") return json({ error: "forbidden" }, 403);

  const cfg: IyzicoConfig = {
    apiKey: Deno.env.get("IYZICO_API_KEY") ?? "",
    secretKey: Deno.env.get("IYZICO_SECRET_KEY") ?? "",
    baseUrl: Deno.env.get("IYZICO_BASE_URL") ?? "",
  };
  if (!cfg.apiKey || !cfg.secretKey || !cfg.baseUrl) return json({ error: "provider_not_configured" }, 503);

  const sb = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: intent, error: ie } = await sb.rpc("billing_create_intent", {
    p_channel: "iyzico", p_company_id: company_id, p_plan_code: plan_code, p_created_by: u.user.id,
  });
  if (ie || !intent?.intent_id) return json({ error: "plan_unavailable" }, 400);

  const { data: co } = await sb.from("companies").select("name,phone,address,tax_no").eq("id", company_id).maybeSingle();
  const price = (intent.amount_minor / 100).toFixed(2);
  const callbackUrl = `${url}/functions/v1/billing-callback?intent=${encodeURIComponent(intent.intent_id)}`;
  const name = (co?.name ?? "PerdePRO").slice(0, 60);
  const r = await iyzicoPost(cfg, CHECKOUT_INIT_PATH, {
    locale: "tr",
    conversationId: intent.intent_id,
    price, paidPrice: price, currency: intent.currency,
    basketId: intent.intent_id,
    paymentGroup: "PRODUCT",
    callbackUrl,
    enabledInstallments: [1],
    buyer: {
      id: String(company_id), name, surname: "Firma", email: u.user.email,
      gsmNumber: co?.phone || "+905000000000",
      // Kimlik/vergi numarasi: firma kaydindaki vergi no; yoksa saglayici zorunlu alani icin bos birakilamaz (canlida firma bilgisi toplanmali).
      identityNumber: String(co?.tax_no || "11111111111"),
      registrationAddress: co?.address || "Adres", city: "Istanbul", country: "Turkey",
    },
    billingAddress: { address: co?.address || "Adres", contactName: name, city: "Istanbul", country: "Turkey" },
    basketItems: [{ id: plan_code, name: `PerdePRO ${plan_code}`.slice(0, 60), category1: "Yazilim", itemType: "VIRTUAL", price }],
  });
  if (!r.ok || r.json?.status !== "success" || !r.json?.token) return json({ error: "provider_error" }, 502);

  await sb.rpc("billing_set_intent_token", { p_intent_id: intent.intent_id, p_token: r.json.token });
  return json({ intent_id: intent.intent_id, paymentPageUrl: r.json.paymentPageUrl ?? null });
});
