// iyzico odeme formu sonrasi donus adresi (tarayici POST eder). ERISIM ACMAZ: yalnizca bekleyen abonelik kaydi tutar.
// Erisim yalnizca dogrulanmis webhook (billing-webhook-iyzico) ile acilir. Dagitim: --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2";
import { iyzicoRequest, type IyzicoConfig } from "../_shared/iyzico.ts";

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const companyId = u.searchParams.get("company_id") ?? "";
  const planCode = u.searchParams.get("plan_code") ?? "";
  const appUrl = Deno.env.get("APP_PUBLIC_URL") ?? "";
  const back = (status: string) => Response.redirect(`${appUrl}/#/subscription?payment=${status}`, 303);

  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  if (!token || !companyId || !planCode || !appUrl) return back("error");

  const cfg: IyzicoConfig = {
    apiKey: Deno.env.get("IYZICO_API_KEY") ?? "",
    secretKey: Deno.env.get("IYZICO_SECRET_KEY") ?? "",
    merchantId: Deno.env.get("IYZICO_MERCHANT_ID") ?? "",
    baseUrl: Deno.env.get("IYZICO_BASE_URL") ?? "https://sandbox-api.iyzipay.com",
  };
  const r = await iyzicoRequest(cfg, "GET", `/v2/subscription/checkoutform/${encodeURIComponent(token)}`);
  const ref = r.json?.data?.referenceCode;
  if (!r.ok || !ref) return back("failed");

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { error } = await sb.rpc("billing_register_pending", {
    p_channel: "iyzico", p_company_id: companyId, p_plan_code: planCode, p_provider_subscription_ref: String(ref),
  });
  return back(error ? "error" : "pending");
});
