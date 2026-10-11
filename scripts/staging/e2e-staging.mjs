// TEST ortami uctan uca dogrulama: 7 gun kilidi + (iyzico SANDBOX) tek seferlik odeme sonrasi erisim acilmasi.
// YALNIZCA test projesine karsi calisir; uretim ref'i gorulurse durur. Otomatik yenileme/kart saklama YOKTUR.
// Ortam degiskenleri (kendi terminalinizde): STAGING_URL, STAGING_ANON_KEY, STAGING_SERVICE_KEY
// Calistirma (PowerShell):  node scripts/staging/e2e-staging.mjs
import crypto from "node:crypto";

const PROD_REF = "ffhmzlcsgsgjonqqhgqq";
const URL_ = (process.env.STAGING_URL || "").replace(/\/$/, "");
const ANON = process.env.STAGING_ANON_KEY || "";
const SERVICE = process.env.STAGING_SERVICE_KEY || "";
if (!URL_ || !ANON || !SERVICE) { console.error("STAGING_URL, STAGING_ANON_KEY ve STAGING_SERVICE_KEY gerekli."); process.exit(2); }
if (URL_.includes(PROD_REF)) { console.error("Bu adres URETIM projesi; test iptal."); process.exit(2); }

const results = [];
const rec = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " - " + extra : ""}`); };
const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", Prefer: "return=representation" };
const rest = (p, init = {}) => fetch(`${URL_}/rest/v1/${p}`, { ...init, headers: { ...svc, ...(init.headers || {}) } });
const tag = "e2e" + Date.now().toString(36);
const password = "Qa!" + crypto.randomBytes(9).toString("base64url");
const email = `${tag}@example.test`;
let userId = null, companyId = null;

async function userToken() {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  return (await r.json()).access_token;
}
const asUser = (tok, p, init = {}) => fetch(`${URL_}/rest/v1/${p}`, { ...init, headers: { apikey: ANON, Authorization: `Bearer ${tok}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) } });
const company = async () => (await (await rest(`companies?id=eq.${companyId}&select=plan_status,license_expires_at,trial_ends_at,is_pilot`)).json())[0];
const checkout = (tok, body) => fetch(`${URL_}/functions/v1/billing-checkout`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });

try {
  const u = await (await fetch(`${URL_}/auth/v1/admin/users`, { method: "POST", headers: svc, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  userId = u.id;
  const c = await (await rest("companies", { method: "POST", body: JSON.stringify({
    name: `E2E ${tag}`, owner_id: userId, plan_status: "trial", subscription_status: "trial",
    trial_started_at: new Date().toISOString(), trial_ends_at: new Date(Date.now() + 7 * 864e5).toISOString(), is_active: true, read_only: false,
  }) })).json();
  companyId = c[0].id;
  await rest("profiles", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ user_id: userId, email, full_name: "E2E", role: "admin", is_active: true }) });
  await rest("company_members", { method: "POST", body: JSON.stringify({ company_id: companyId, user_id: userId, role: "admin", is_active: true }) });
  const days = (new Date(c[0].trial_ends_at) - new Date(c[0].trial_started_at)) / 864e5;
  rec("deneme suresi sunucuda 7 gun kaydedildi", Math.round(days) === 7, `${days.toFixed(2)} gun`);

  let tok = await userToken();
  const ins = await asUser(tok, "customers", { method: "POST", body: JSON.stringify({ company_id: companyId, name: "Deneme icinde" }) });
  rec("sure dolmadan: yazma acik", ins.ok, `HTTP ${ins.status}`);

  await rest(`companies?id=eq.${companyId}`, { method: "PATCH", body: JSON.stringify({ trial_ends_at: new Date(Date.now() - 1000).toISOString() }) });
  tok = await userToken();
  const blocked = await asUser(tok, "customers", { method: "POST", body: JSON.stringify({ company_id: companyId, name: "Sure sonrasi" }) });
  rec("sure bitti: dogrudan API yazmasi reddedildi", !blocked.ok, `HTTP ${blocked.status}`);
  const read = await (await asUser(tok, `customers?company_id=eq.${companyId}&select=name`)).json();
  rec("sure bitti: mevcut veri okunuyor", Array.isArray(read) && read.length === 1);
  await asUser(tok, `companies?id=eq.${companyId}`, { method: "PATCH", body: JSON.stringify({ trial_ends_at: new Date(Date.now() + 30 * 864e5).toISOString(), is_pilot: true }) });
  const after = await company();
  rec("kullanici kendine sure/ozel erisim veremedi", new Date(after.trial_ends_at) < new Date() && after.is_pilot === false);

  const fake = await fetch(`${URL_}/functions/v1/billing-webhook-iyzico`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ iyziEventType: "CHECKOUT_FORM_AUTH", iyziPaymentId: 1, token: "x", paymentConversationId: "y", status: "SUCCESS" }) });
  rec("imzasiz webhook reddedildi (401/503)", fake.status === 401 || fake.status === 503, `HTTP ${fake.status}`);

  const noConsent = await checkout(tok, { company_id: companyId, plan_code: "solo_monthly" });
  rec("acik onay olmadan odeme baslatilmadi", !noConsent.ok, `HTTP ${noConsent.status}`);
  const co = await checkout(tok, { company_id: companyId, plan_code: "solo_monthly", accepted_terms: true });
  const coj = await co.json().catch(() => ({}));
  rec("odeme sayfasi adresi sunucudan alindi", co.ok && !!coj.paymentPageUrl, `HTTP ${co.status} ${coj.error || ""}`);
  if (co.ok && coj.paymentPageUrl) {
    console.log(`\n>>> SANDBOX test kartiyla odemeyi tamamlayin (iyzico belgelerindeki test kartlari):\n>>> ${coj.paymentPageUrl}\n>>> En fazla 10 dk beklenir...\n`);
    let opened = false;
    for (let i = 0; i < 120 && !opened; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const cur = await company();
      opened = cur.plan_status === "active" && cur.license_expires_at && new Date(cur.license_expires_at) > new Date();
    }
    rec("dogrulanmis odeme sonrasi firma erisimi acildi (cikis-giris olmadan)", opened);
    if (opened) {
      const t2 = await userToken();
      const w = await asUser(t2, "customers", { method: "POST", body: JSON.stringify({ company_id: companyId, name: "Odeme sonrasi" }) });
      rec("odeme sonrasi: yazma yeniden acik", w.ok, `HTTP ${w.status}`);
      const pays = await (await rest(`billing_payments?company_id=eq.${companyId}&select=id`)).json();
      rec("tek odeme kaydi olustu", Array.isArray(pays) && pays.length === 1, `${pays.length} kayit`);
      const subs = await (await rest(`billing_subscriptions?company_id=eq.${companyId}&select=status`)).json();
      rec("tek canli abonelik kaydi", Array.isArray(subs) && subs.filter((s) => s.status === "active").length === 1);
    }
  }
} catch (e) {
  rec("BETIK HATASI", false, String(e).slice(0, 200));
} finally {
  try {
    if (companyId) await rest(`companies?id=eq.${companyId}`, { method: "DELETE" });
    if (userId) await fetch(`${URL_}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: svc });
  } catch { /* temizlik en iyi caba */ }
  const failed = results.filter((x) => !x).length;
  console.log(`\nOZET: ${results.length - failed}/${results.length} gecti, ${failed} basarisiz`);
  process.exitCode = failed ? 1 : 0;
}
