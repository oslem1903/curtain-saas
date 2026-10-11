// Saf is mantigi: bagimliliklar (iyzico sorgusu, veritabani RPC'leri) disaridan verilir; boylece birim testlenebilir.
import {
  type IyzicoOrder,
  type IyzicoSubscriptionWebhook,
  successfulPaymentId,
  toMinorUnits,
  verifySubscriptionWebhookSignature,
} from "./iyzico.ts";

export type WebhookDeps = {
  merchantId: string;
  secretKey: string;
  /** iyzico'dan abonelik detayini sunucu tarafinda geri sorgular (webhook govdesine guvenilmez). */
  getSubscription: (subscriptionRef: string) => Promise<{ orders?: IyzicoOrder[] } | null>;
  lookupSubscription: (subscriptionRef: string) => Promise<{ company_id: string; plan_code: string; status: string } | null>;
  applyCharge: (a: {
    eventId: string; companyId: string; planCode: string; paymentId: string; amountMinor: number; currency: string; subscriptionRef: string; payload: unknown;
  }) => Promise<{ status: string; reason?: string }>;
  recordFailure: (a: { eventId: string; companyId: string; reason: string; payload: unknown }) => Promise<{ status: string }>;
};

export type WebhookResult = { http: number; body: Record<string, unknown> };

export async function handleIyzicoSubscriptionWebhook(
  deps: WebhookDeps,
  headerSignature: string | null,
  body: IyzicoSubscriptionWebhook,
): Promise<WebhookResult> {
  const valid = await verifySubscriptionWebhookSignature(deps.merchantId, deps.secretKey, body, headerSignature);
  if (!valid) return { http: 401, body: { error: "invalid_signature" } };

  const type = String(body.iyziEventType ?? "");
  const subRef = String(body.subscriptionReferenceCode ?? "");
  const orderRef = String(body.orderReferenceCode ?? "");
  if (!subRef || !orderRef) return { http: 400, body: { error: "missing_reference" } };
  if (type !== "subscription.order.success" && type !== "subscription.order.failure") {
    // Taninmayan olay: 200 doner (yeniden deneme yagmuru olmasin), islem yapilmaz.
    return { http: 200, body: { status: "ignored", type } };
  }

  const local = await deps.lookupSubscription(subRef);
  if (!local) return { http: 200, body: { status: "ignored", reason: "unknown_subscription" } };
  const eventId = `${type}:${orderRef}`;

  if (type === "subscription.order.failure") {
    const r = await deps.recordFailure({ eventId, companyId: local.company_id, reason: "order_failure", payload: body });
    return { http: 200, body: { status: r.status } };
  }

  // Basari: tutar/durum iyzico'dan geri sorgulanir; istemci/webhook govdesi tutar belirleyemez.
  const detail = await deps.getSubscription(subRef);
  const order = detail?.orders?.find((o) => o.referenceCode === orderRef);
  const paymentId = successfulPaymentId(order);
  if (!order || !paymentId) {
    // Henuz dogrulanamadi: 5xx -> iyzico yeniden dener (erisim ACILMAZ).
    return { http: 503, body: { status: "not_verified" } };
  }
  const amountMinor = toMinorUnits(order.price);
  if (!Number.isFinite(amountMinor)) return { http: 200, body: { status: "rejected", reason: "bad_amount" } };
  const r = await deps.applyCharge({
    eventId, companyId: local.company_id, planCode: local.plan_code, paymentId, amountMinor,
    currency: String(order.currencyCode ?? "TRY"), subscriptionRef: subRef, payload: body,
  });
  return { http: 200, body: { status: r.status, reason: r.reason } };
}
