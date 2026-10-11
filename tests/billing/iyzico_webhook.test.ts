// npx tsx --test tests/billing/iyzico_webhook.test.ts
// Yalnizca IS MANTIGI birim testleri (sahte bagimliliklarla). iyzico sandbox/canli akis testi DEGILDIR.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { iyzicoAuthHeaders, isVerifiedSuccess, toMinorUnits, verifyHppWebhookSignature } from "../../supabase/functions/_shared/iyzico.ts";
import { handleIyzicoWebhook, verifyAndApply, type Intent, type VerifyDeps } from "../../supabase/functions/_shared/iyzico_webhook.ts";

const SECRET = "secret-test-key";
const hpp = { iyziEventType: "CHECKOUT_FORM_AUTH", iyziPaymentId: 777, token: "tok-1", paymentConversationId: "intent-1", status: "SUCCESS" };
const sign = (b: typeof hpp) =>
  createHmac("sha256", SECRET).update(SECRET + b.iyziEventType + String(b.iyziPaymentId) + b.token + b.paymentConversationId + b.status).digest("hex");

const intent: Intent = { id: "intent-1", company_id: "co-1", plan_code: "solo_monthly", amount_minor: 99900, currency: "TRY", status: "created" };
const goodDetail = { status: "success", paymentStatus: "SUCCESS", paymentId: 777, paidPrice: "999.0", currency: "TRY", conversationId: "intent-1", fraudStatus: 1, token: "tok-1" };

function deps(over: Partial<VerifyDeps> = {}) {
  const calls = { applied: [] as unknown[], marked: [] as string[] };
  const d: VerifyDeps & { secretKey: string } = {
    secretKey: SECRET,
    retrieveDetail: async () => ({ ...goodDetail }),
    getIntent: async (id) => (id === "intent-1" ? intent : null),
    applyCharge: async (a) => { calls.applied.push(a); return { status: "applied" }; },
    markIntent: async (_id, s) => { calls.marked.push(s); },
    ...over,
  };
  return { d, calls };
}

test("HPP imzasi: gecerli kabul, yanlis/eksik/oynanmis red", async () => {
  assert.equal(await verifyHppWebhookSignature(SECRET, hpp, sign(hpp)), true);
  assert.equal(await verifyHppWebhookSignature(SECRET, hpp, sign(hpp).toUpperCase()), true);
  assert.equal(await verifyHppWebhookSignature(SECRET, hpp, "deadbeef"), false);
  assert.equal(await verifyHppWebhookSignature(SECRET, hpp, null), false);
  assert.equal(await verifyHppWebhookSignature(SECRET, { ...hpp, iyziPaymentId: 1 }, sign(hpp)), false);
});

test("imzasiz webhook 401; hicbir islem yapilmaz", async () => {
  const { d, calls } = deps();
  const r = await handleIyzicoWebhook(d, null, hpp);
  assert.equal(r.http, 401);
  assert.equal(calls.applied.length, 0);
});

test("dogrulanmis odeme: tutar iyzico'dan alinip niyetle eslesince uygulanir ve niyet 'paid' olur", async () => {
  const { d, calls } = deps();
  const r = await handleIyzicoWebhook(d, sign(hpp), hpp);
  assert.equal(r.http, 200);
  assert.equal(calls.applied.length, 1);
  const a = calls.applied[0] as { amountMinor: number; paymentId: string; eventId: string; intent: Intent };
  assert.equal(a.amountMinor, 99900);
  assert.equal(a.paymentId, "777");
  assert.equal(a.eventId, "payment:777");
  assert.equal(a.intent.company_id, "co-1");
  assert.deepEqual(calls.marked, ["paid"]);
});

test("tutar niyetle uyusmazsa REDDEDILIR, erisim acilmaz", async () => {
  const { d, calls } = deps({ retrieveDetail: async () => ({ ...goodDetail, paidPrice: "1.00" }) });
  const out = await verifyAndApply(d, "tok-1", "intent-1");
  assert.equal(out.status, "rejected");
  assert.equal(calls.applied.length, 0);
});

test("para birimi uyusmazsa reddedilir", async () => {
  const { d, calls } = deps({ retrieveDetail: async () => ({ ...goodDetail, currency: "USD" }) });
  const out = await verifyAndApply(d, "tok-1");
  assert.equal(out.status, "rejected");
  assert.equal(calls.applied.length, 0);
});

test("fraudStatus onaysiz veya paymentStatus basarisiz ise erisim acilmaz", async () => {
  for (const patch of [{ fraudStatus: 0 }, { fraudStatus: -1 }, { paymentStatus: "FAILURE", status: "failure" }]) {
    const { d, calls } = deps({ retrieveDetail: async () => ({ ...goodDetail, ...patch }) });
    const out = await verifyAndApply(d, "tok-1");
    assert.equal(out.status, "not_verified");
    assert.equal(calls.applied.length, 0);
  }
});

test("dogrulanamayan odeme webhook'ta 503 (yeniden denenir); acik basarisizlik 200", async () => {
  const pending = deps({ retrieveDetail: async () => ({ ...goodDetail, fraudStatus: 0 }) });
  assert.equal((await handleIyzicoWebhook(pending.d, sign(hpp), hpp)).http, 503);
  const failed = deps({ retrieveDetail: async () => ({ ...goodDetail, status: "failure", paymentStatus: "FAILURE" }) });
  const r = await handleIyzicoWebhook(failed.d, sign(hpp), hpp);
  assert.equal(r.http, 200);
  assert.deepEqual(failed.calls.marked, ["failed"]);
});

test("baska niyetin tokeni veya bilinmeyen niyet uygulanamaz", async () => {
  const { d, calls } = deps({ retrieveDetail: async () => ({ ...goodDetail, conversationId: "intent-OTHER" }) });
  const mismatch = await verifyAndApply(d, "tok-1", "intent-1");
  assert.equal(mismatch.status, "unknown_intent");
  const unknown = await verifyAndApply(deps().d, "tok-1", undefined);
  assert.equal(unknown.status, "applied"); // intent-1 gercek
  const { d: d2 } = deps({ retrieveDetail: async () => ({ ...goodDetail, conversationId: "yok" }) });
  assert.equal((await verifyAndApply(d2, "tok-1")).status, "unknown_intent");
  assert.equal(calls.applied.length, 0);
});

test("tekrar bildirim: ayni odeme icin RPC 'duplicate' donerse yeniden uzatma yapilmaz (niyet paid isaretlenmez)", async () => {
  const { d, calls } = deps({ applyCharge: async () => ({ status: "duplicate" }) });
  const out = await verifyAndApply(d, "tok-1");
  assert.equal(out.status, "duplicate");
  assert.deepEqual(calls.marked, []);
});

test("yardimcilar: kurus cevirme, dogrulanmis basari, IYZWSv2 imza bicimi", async () => {
  assert.equal(toMinorUnits("999.90"), 99990);
  assert.ok(Number.isNaN(toMinorUnits("abc")));
  assert.equal(isVerifiedSuccess(goodDetail), true);
  assert.equal(isVerifiedSuccess({ ...goodDetail, paymentId: undefined }), false);
  const h = await iyzicoAuthHeaders("api", "sec", "/p", '{"a":1}', "rnd1");
  const sig = createHmac("sha256", "sec").update('rnd1/p{"a":1}').digest("hex");
  assert.equal(h.Authorization, "IYZWSv2 " + Buffer.from(`apiKey:api&randomKey:rnd1&signature:${sig}`).toString("base64"));
});
