// Odeme formu baslatir. Kullanici JWT'si ile cagrilir (verify_jwt acik). Dagitim: `supabase functions deploy billing-checkout`
// Girdi: { company_id, plan_code }. Yalnizca o firmanin yoneticisi baslatabilir; fiyat/plan sunucuda belirlenir.
import { createClient } from "npm:@supabase/supabase-js@2";
import { iyzicoRequest, type IyzicoConfig } from "../_shared/iyzico.ts";

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
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return json({ error: "unauthorized" }, 401);

  const { company_id, plan_code } = await req.json().catch(() => ({}));
  if (!company_id || !plan_code) return json({ error: "bad_request" }, 400);

  // Yetki: kullanici bu firmanin AKTIF YONETICISI olmali (RLS ile kendi uyeligi okunur).
  const { data: mem } = await userClient.from("company_members").select("role,is_active").eq("company_id", company_id).eq("user_id", u.user.id).maybeSingle();
  if (!mem || mem.is_active === false || mem.role !== "admin") return json({ error: "forbidden" }, 403);

  const sb = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: plan } = await sb.from("billing_plans").select("code,iyzico_plan_ref,is_active").eq("code", plan_code).maybeSingle();
  if (!plan || !plan.is_active || !plan.iyzico_plan_ref) return json({ error: "plan_unavailable" }, 400);

  const cfg: IyzicoConfig = {
    apiKey: Deno.env.get("IYZICO_API_KEY") ?? "",
    secretKey: Deno.env.get("IYZICO_SECRET_KEY") ?? "",
    merchantId: Deno.env.get("IYZICO_MERCHANT_ID") ?? "",
    baseUrl: Deno.env.get("IYZICO_BASE_URL") ?? "https://sandbox-api.iyzipay.com",
  };
  if (!cfg.apiKey || !cfg.secretKey) return json({ error: "provider_not_configured" }, 503);

  const { data: company } = await sb.from("companies").select("name,email,phone,address").eq("id", company_id).maybeSingle();
  const callbackUrl = `${url}/functions/v1/billing-callback?company_id=${encodeURIComponent(company_id)}&plan_code=${encodeURIComponent(plan_code)}`;
  const r = await iyzicoRequest(cfg, "POST", "/v2/subscription/checkoutform/initialize", {
    callbackUrl,
    pricingPlanReferenceCode: plan.iyzico_plan_ref,
    subscriptionInitialStatus: "ACTIVE",
    conversationId: crypto.randomUUID(),
    locale: "tr",
    customer: {
      name: (company?.name ?? "PerdePRO").slice(0, 40), surname: "Firma", email: u.user.email,
      gsmNumber: company?.phone || "+905000000000", identityNumber: "11111111111",
      billingAddress: { address: company?.address || "Adres", contactName: company?.name ?? "PerdePRO", city: "Istanbul", country: "Turkey" },
    },
  });
  if (!r.ok || r.json?.status !== "success") return json({ error: "provider_error" }, 502);
  return json({ token: r.json.token, checkoutFormContent: r.json.checkoutFormContent, tokenExpireTime: r.json.tokenExpireTime });
});
