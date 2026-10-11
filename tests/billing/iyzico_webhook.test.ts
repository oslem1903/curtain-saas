// node --import tsx --test tests/billing/iyzico_webhook.test.ts   (veya: npx tsx --test ...)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { iyzicoAuthHeaders, successfulPaymentId, toMinorUnits, verifySubscriptionWebhookSignature } from "../../supabase/functions/_shared/iyzico.ts";
import { handleIyzicoSubscriptionWebhook, type WebhookDeps } from "../../supabase/functions/_shared/iyzico_webhook.ts";

const MERCHANT = "merchant-test";
const SECRET = "secret-test-key";
const sign = (b: Record<string, string>) =>
  createHmac("sha256", SECRET).update(MERCHANT + SECRET + b.iyziEventType + b.subscriptionReferenceCode + b.orderReferenceCode + b.customerReferenceCode).digest("hex");

const okBody = { iyziEventType: "subscription.order.success", subscriptionReferenceCode: "sub-1", orderReferenceCode: "ord-1", customerReferenceCode: "cus-1" };

function deps(over: Partial<WebhookDeps> = {}) {
  const calls: { applied: unknown[]; failed: unknown[] } = { applied: [], failed: [] };
  const d: WebhookDeps = {
    merchantId: MERCHANT,
    secretKey: SECRET,
    getSubscription: async () => ({ orders: [{ referenceCode: "ord-1", price: "999.00", currencyCode: "TRY", orderStatus: "SUCCESS", paymentAttempts: [{ paymentStatus: "SUCCESS", paymentId: 777 }] }] }),
    lookupSubscription: async () => ({ company_id: "co-1", plan_code: "solo_monthly", status: "pending" }),
    applyCharge: async (a) => { calls.applied.push(a); return { status: "applied" }; },
    recordFailure: async (a) => { calls.failed.push(a); return { status: "recorded" }; },
    ...over,
  };
  return { d, calls };
}

test("gecerli imza dogrulanir, yanlis/eksik imza reddedilir", async () => {
  assert.equal(await verifySubscriptionWebhookSignature(MERCHANT, SECRET, okBody, sign(okBody)), true);
  assert.equal(await verifySubscriptionWebhookSignature(MERCHANT, SECRET, okBody, sign(okBody).toUpperCase()), true);
  assert.equal(await verifySubscriptionWebhookSignature(MERCHANT, SECRET, okBody, "deadbeef"), false);
  assert.equal(await verifySubscriptionWebhookSignature(MERCHANT, SECRET, okBody, null), false);
  assert.equal(await verifySubscriptionWebhookSignature(MERCHANT, SECRET, { ...okBody, orderReferenceCode: "x" }, sign(okBody)), false);
});

test("imzasiz webhook 401 doner ve hicbir islem yapmaz", async () => {
  const { d, calls } = deps();
  const r = await handleIyzicoSubscriptionWebhook(d, null, okBody);
  assert.equal(r.http, 401);
  assert.equal(calls.applied.length + calls.failed.length, 0);
});

test("dogrulanmis basari: tutar iyzico'dan geri sorgulanip kurus olarak uygulanir", async () => {
  const { d, calls } = deps();
  const r = await handleIyzicoSubscriptionWebhook(d, sign(okBody), okBody);
  assert.equal(r.http, 200);
  assert.equal(calls.applied.length, 1);
  const a = calls.applied[0] as Record<string, unknown>;
  assert.equal(a.amountMinor, 99900);
  assert.equal(a.paymentId, "777");
  assert.equal(a.companyId, "co-1");
  assert.equal(a.eventId, "subscription.order.success:ord-1");
});

test("webhook govdesinde tutar/firma gonderilse bile kullanilmaz (yalnizca sunucu verisi)", async () => {
  const { d, calls } = deps();
  const evil = { ...okBody, price: "0.01", companyId: "other-company" } as typeof okBody;
  await handleIyzicoSubscriptionWebhook(d, sign(evil), evil);
  const a = calls.applied[0] as Record<string, unknown>;
  assert.equal(a.amountMinor, 99900);
  assert.equal(a.companyId, "co-1");
});

test("odeme iyzico'da dogrulanamazsa 503 (yeniden denenir) ve erisim acilmaz", async () => {
  const { d, calls } = deps({ getSubscription: async () => ({ orders: [{ referenceCode: "ord-1", orderStatus: "WAITING", paymentAttempts: [] }] }) });
  const r = await handleIyzicoSubscriptionWebhook(d, sign(okBody), okBody);
  assert.equal(r.http, 503);
  assert.equal(calls.applied.length, 0);
});

test("basarisiz siparis olayi yalnizca kaydedilir, uygulanmaz", async () => {
  const body = { ...okBody, iyziEventType: "subscription.order.failure" };
  const { d, calls } = deps();
  const r = await handleIyzicoSubscriptionWebhook(d, sign(body), body);
  assert.equal(r.http, 200);
  assert.equal(calls.failed.length, 1);
  assert.equal(calls.applied.length, 0);
});

test("bilinmeyen abonelik veya olay turu 200 ile yok sayilir", async () => {
  const unknown = deps({ lookupSubscription: async () => null });
  const r1 = await handleIyzicoSubscriptionWebhook(unknown.d, sign(okBody), okBody);
  assert.equal(r1.http, 200); assert.equal(unknown.calls.applied.length, 0);
  const other = { ...okBody, iyziEventType: "subscription.something" };
  const r2 = await handleIyzicoSubscriptionWebhook(deps().d, sign(other), other);
  assert.equal(r2.http, 200); assert.equal((r2.body as { status: string }).status, "ignored");
});

test("yardimcilar: paymentId secimi, kurus cevirme, IYZWSv2 imza bicimi", async () => {
  assert.equal(successfulPaymentId({ orderStatus: "SUCCESS", paymentAttempts: [{ paymentStatus: "FAILED" }, { paymentStatus: "SUCCESS", paymentId: "p1" }] }), "p1");
  assert.equal(successfulPaymentId({ orderStatus: "FAILED", paymentAttempts: [{ paymentStatus: "SUCCESS", paymentId: "p1" }] }), null);
  assert.equal(toMinorUnits("999.90"), 99990);
  assert.ok(Number.isNaN(toMinorUnits("abc")));
  const h = await iyzicoAuthHeaders("api", "sec", "/v2/x", '{"a":1}', "rnd1");
  const expectedSig = createHmac("sha256", "sec").update('rnd1/v2/x{"a":1}').digest("hex");
  assert.equal(h.Authorization, "IYZWSv2 " + Buffer.from(`apiKey:api&randomKey:rnd1&signature:${expectedSig}`).toString("base64"));
  assert.equal(h["x-iyzi-rnd"], "rnd1");
});
