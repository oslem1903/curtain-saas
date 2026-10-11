// iyzico yardimcilari — TEK SEFERLIK odeme (Checkout Form). Otomatik yenilenen abonelik KULLANILMAZ.
// Deno ve Node 20+ ile calisir (yalnizca Web Crypto). Kaynak: docs.iyzico.com
//  - Kimlik dogrulama: IYZWSv2 (HMAC-SHA256: randomKey + uri.path + body)
//  - Webhook imzasi X-IYZ-SIGNATURE-V3 (HPP): HMAC-SHA256(secretKey; secretKey+iyziEventType+iyziPaymentId+token+paymentConversationId+status)
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

export type IyzicoHppWebhook = {
  iyziEventType?: string;
  iyziPaymentId?: string | number;
  token?: string;
  paymentConversationId?: string;
  status?: string;
  merchantId?: string;
  iyziReferenceCode?: string;
};

export async function verifyHppWebhookSignature(secretKey: string, body: IyzicoHppWebhook, headerValue: string | null): Promise<boolean> {
  if (!headerValue || !secretKey) return false;
  const message = secretKey + (body.iyziEventType ?? "") + String(body.iyziPaymentId ?? "") + (body.token ?? "") +
    (body.paymentConversationId ?? "") + (body.status ?? "");
  const expected = await hmacSha256Hex(secretKey, message);
  return timingSafeEqual(expected, headerValue.trim().toLowerCase());
}

export async function iyzicoAuthHeaders(apiKey: string, secretKey: string, uriPath: string, body: string, randomKey?: string) {
  const rnd = randomKey ?? `${Date.now()}${Math.floor(Math.random() * 1e9)}`;
  const signature = await hmacSha256Hex(secretKey, rnd + uriPath + body);
  const auth = btoa(`apiKey:${apiKey}&randomKey:${rnd}&signature:${signature}`);
  return { Authorization: `IYZWSv2 ${auth}`, "x-iyzi-rnd": rnd, "Content-Type": "application/json" } as Record<string, string>;
}

/** baseUrl ZORUNLUDUR (varsayilan yok): sandbox/canli secimi bilincli yapilir. */
export type IyzicoConfig = { apiKey: string; secretKey: string; baseUrl: string };

export async function iyzicoPost(cfg: IyzicoConfig, path: string, body: unknown) {
  const raw = JSON.stringify(body);
  const headers = await iyzicoAuthHeaders(cfg.apiKey, cfg.secretKey, path, raw);
  const res = await fetch(cfg.baseUrl + path, { method: "POST", headers, body: raw });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export const CHECKOUT_INIT_PATH = "/payment/iyzipos/checkoutform/initialize/auth/ecom";
export const CHECKOUT_DETAIL_PATH = "/payment/iyzipos/checkoutform/auth/ecom/detail";

export type CheckoutDetail = {
  status?: string;
  paymentStatus?: string;
  paymentId?: string | number;
  paidPrice?: number | string;
  currency?: string;
  basketId?: string;
  conversationId?: string;
  fraudStatus?: number | string;
  token?: string;
};

/** Tutari kurus (minor) birimine cevirir; hatali deger NaN. */
export function toMinorUnits(price: number | string | undefined): number {
  const n = typeof price === "string" ? Number(price.replace(",", ".")) : Number(price);
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
}

/** Odeme gercekten basarili mi? (status success + paymentStatus SUCCESS + fraudStatus onayli). */
export function isVerifiedSuccess(d: CheckoutDetail | null | undefined): boolean {
  if (!d) return false;
  return String(d.status).toLowerCase() === "success" &&
    String(d.paymentStatus).toUpperCase() === "SUCCESS" &&
    String(d.fraudStatus) === "1" &&
    d.paymentId != null && String(d.paymentId) !== "";
}
