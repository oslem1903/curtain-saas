// iyzico yardimcilari (Deno ve Node 20+ ile calisir: yalnizca Web Crypto kullanir).
// Kaynaklar: docs.iyzico.com (IYZWSv2 kimlik dogrulama, abonelik webhook imzasi X-IYZ-SIGNATURE-V3).
const enc = new TextEncoder();

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type IyzicoSubscriptionWebhook = {
  iyziEventType?: string;
  subscriptionReferenceCode?: string;
  orderReferenceCode?: string;
  customerReferenceCode?: string;
  iyziReferenceCode?: string;
};

/** Abonelik webhook imzasi: HMAC-SHA256(secretKey; merchantId+secretKey+eventType+subscriptionRef+orderRef+customerRef). */
export async function verifySubscriptionWebhookSignature(
  merchantId: string,
  secretKey: string,
  body: IyzicoSubscriptionWebhook,
  headerValue: string | null,
): Promise<boolean> {
  if (!headerValue || !merchantId || !secretKey) return false;
  const message =
    merchantId + secretKey + (body.iyziEventType ?? "") + (body.subscriptionReferenceCode ?? "") +
    (body.orderReferenceCode ?? "") + (body.customerReferenceCode ?? "");
  const expected = await hmacSha256Hex(secretKey, message);
  return timingSafeEqual(expected, headerValue.trim().toLowerCase());
}

/** IYZWSv2 Authorization basliklari: base64("apiKey:..&randomKey:..&signature:..") */
export async function iyzicoAuthHeaders(apiKey: string, secretKey: string, uriPath: string, body: string, randomKey?: string) {
  const rnd = randomKey ?? `${Date.now()}${Math.floor(Math.random() * 1e9)}`;
  const signature = await hmacSha256Hex(secretKey, rnd + uriPath + body);
  const auth = btoa(`apiKey:${apiKey}&randomKey:${rnd}&signature:${signature}`);
  return { Authorization: `IYZWSv2 ${auth}`, "x-iyzi-rnd": rnd, "Content-Type": "application/json" } as Record<string, string>;
}

export type IyzicoConfig = { apiKey: string; secretKey: string; merchantId: string; baseUrl: string };

export async function iyzicoRequest(cfg: IyzicoConfig, method: "GET" | "POST", path: string, body?: unknown) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  // Imzaya yalnizca yol girer (sorgu dizesi imzaya dahil degildir; docs: uri.path).
  const uriPath = path.split("?")[0];
  const headers = await iyzicoAuthHeaders(cfg.apiKey, cfg.secretKey, uriPath, raw);
  const res = await fetch(cfg.baseUrl + path, { method, headers, body: method === "GET" ? undefined : raw });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export type IyzicoOrder = {
  referenceCode?: string;
  price?: number | string;
  currencyCode?: string;
  orderStatus?: string;
  paymentAttempts?: Array<{ paymentStatus?: string; paymentId?: string | number }>;
};

/** Siparis (donem) icin BASARILI odeme denemesinin paymentId'si; yoksa null. */
export function successfulPaymentId(order: IyzicoOrder | undefined): string | null {
  if (!order || String(order.orderStatus).toUpperCase() !== "SUCCESS") return null;
  const ok = (order.paymentAttempts ?? []).find((a) => String(a.paymentStatus).toUpperCase() === "SUCCESS" && a.paymentId != null);
  return ok ? String(ok.paymentId) : null;
}

/** TL tutari kurus (minor) birimine cevirir; hatali deger NaN doner (RPC reddeder). */
export function toMinorUnits(price: number | string | undefined): number {
  const n = typeof price === "string" ? Number(price.replace(",", ".")) : Number(price);
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
}
