// Saf is mantigi (bagimliliklar disaridan verilir; birim testlenebilir).
// callback (tarayici) ve webhook (sunucu) AYNI dogrulama yolundan gecer: erisim yalnizca sunucuda dogrulanmis odemeyle acilir.
import { type CheckoutDetail, type IyzicoHppWebhook, isVerifiedSuccess, toMinorUnits, verifyHppWebhookSignature } from "./iyzico.ts";

export type Intent = { id: string; company_id: string; plan_code: string; amount_minor: number; currency: string; status: string };

export type VerifyDeps = {
  /** iyzico'dan odeme sonucunu token ile SUNUCU tarafinda sorgular. */
  retrieveDetail: (token: string) => Promise<CheckoutDetail | null>;
  getIntent: (intentId: string) => Promise<Intent | null>;
  applyCharge: (a: { eventId: string; intent: Intent; paymentId: string; amountMinor: number; currency: string; payload: unknown }) => Promise<{ status: string; reason?: string }>;
  markIntent: (intentId: string, status: "paid" | "failed") => Promise<void>;
};

export type Outcome = { status: "applied" | "duplicate" | "rejected" | "not_verified" | "unknown_intent"; reason?: string };

/** token -> sunucuda dogrula -> niyetle (fiyat/firma/plan) esle -> uygula. Istemci/webhook govdesindeki tutar kullanilmaz. */
export async function verifyAndApply(deps: VerifyDeps, token: string, expectedIntentId?: string): Promise<Outcome> {
  if (!token) return { status: "not_verified", reason: "no_token" };
  const detail = await deps.retrieveDetail(token);
  if (!detail) return { status: "not_verified", reason: "provider_unreachable" };

  const intentId = String(detail.conversationId ?? "");
  if (!intentId || (expectedIntentId && expectedIntentId !== intentId)) return { status: "unknown_intent", reason: "conversation_mismatch" };
  const intent = await deps.getIntent(intentId);
  if (!intent) return { status: "unknown_intent" };

  if (!isVerifiedSuccess(detail)) {
    const failed = String(detail.status).toLowerCase() === "failure" || String(detail.paymentStatus).toUpperCase() === "FAILURE";
    if (failed) await deps.markIntent(intent.id, "failed");
    // Bekleyen/belirsiz: erisim ACILMAZ; webhook yeniden denemesi bekler.
    return { status: "not_verified", reason: failed ? "payment_failed" : "pending" };
  }

  const paid = toMinorUnits(detail.paidPrice);
  if (!Number.isFinite(paid) || paid !== intent.amount_minor || String(detail.currency ?? "").toUpperCase() !== intent.currency.toUpperCase()) {
    return { status: "rejected", reason: "amount_mismatch" };
  }
  const paymentId = String(detail.paymentId);
  const r = await deps.applyCharge({
    eventId: `payment:${paymentId}`, intent, paymentId, amountMinor: paid, currency: intent.currency, payload: { paymentId, intentId: intent.id },
  });
  if (r.status === "applied") await deps.markIntent(intent.id, "paid");
  return { status: r.status as Outcome["status"], reason: r.reason };
}

export type WebhookResult = { http: number; body: Record<string, unknown> };

export async function handleIyzicoWebhook(
  deps: VerifyDeps & { secretKey: string },
  headerSignature: string | null,
  body: IyzicoHppWebhook,
): Promise<WebhookResult> {
  if (!(await verifyHppWebhookSignature(deps.secretKey, body, headerSignature))) return { http: 401, body: { error: "invalid_signature" } };
  const type = String(body.iyziEventType ?? "");
  if (type !== "CHECKOUT_FORM_AUTH" && type !== "PWI_TKN_AUTH") return { http: 200, body: { status: "ignored", type } };
  const token = String(body.token ?? "");
  if (!token) return { http: 400, body: { error: "missing_token" } };

  const out = await verifyAndApply(deps, token, body.paymentConversationId ? String(body.paymentConversationId) : undefined);
  // Dogrulanamadi/bekliyor: 503 -> iyzico 15 dk arayla yeniden dener (erisim acilmaz).
  if (out.status === "not_verified" && out.reason !== "payment_failed") return { http: 503, body: out };
  return { http: 200, body: out };
}
