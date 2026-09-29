// Şirket adı + logosu için TEK kaynak: PDF/yazdırma ve Excel çıktıları buradan okur.
// Ayarlar'da ad/logo değişince COMPANY_PROFILE_UPDATED olayıyla önbellek temizlenir.

import { getEffectiveTenantContext, supabase } from "../supabaseClient";
import { resolveStorageSrc } from "./storageUrl";

export const COMPANY_PROFILE_UPDATED_EVENT = "company-profile-updated";

export type CompanyBranding = {
  name: string;
  /** data: URL (PNG/JPEG) — yazdırma iframe'inde ve Excel'e gömmede güvenle kullanılır. */
  logoDataUrl: string | null;
};

let cache: { companyId: string; value: CompanyBranding } | null = null;

if (typeof window !== "undefined") {
  window.addEventListener(COMPANY_PROFILE_UPDATED_EVENT, () => {
    cache = null;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("logo okunamadı"));
    reader.readAsDataURL(blob);
  });
}

async function logoToDataUrl(logo: string | null | undefined): Promise<string | null> {
  const raw = String(logo ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("data:image/")) return raw;
  try {
    const src = await resolveStorageSrc(raw);
    const res = await fetch(src, { cache: "no-store" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

export async function getCompanyBranding(): Promise<CompanyBranding | null> {
  try {
    const ctx = await getEffectiveTenantContext();
    if (!ctx.company_id) return null;
    if (cache && cache.companyId === ctx.company_id) return cache.value;

    const { data } = await supabase
      .from("companies")
      .select("name, logo_url")
      .eq("id", ctx.company_id)
      .maybeSingle();
    if (!data) return null;

    const value: CompanyBranding = {
      name: String(data.name || "").trim(),
      logoDataUrl: await logoToDataUrl(data.logo_url),
    };
    cache = { companyId: ctx.company_id, value };
    return value;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Yazdırma/PDF belgelerinin başına eklenen marka şeridi (logo + şirket adı). */
export function brandingHeaderHtml(branding: CompanyBranding | null): string {
  if (!branding || (!branding.name && !branding.logoDataUrl)) return "";
  const logo = branding.logoDataUrl
    ? `<img src="${branding.logoDataUrl}" alt="" style="height:44px;max-width:120px;object-fit:contain;margin-right:12px;" />`
    : "";
  const name = branding.name
    ? `<span style="font:700 18px Arial,sans-serif;color:#0f172a;">${escapeHtml(branding.name)}</span>`
    : "";
  return `<div class="pp-brand" style="display:flex;align-items:center;padding:0 0 10px 0;margin:0 0 12px 0;border-bottom:1px solid #e2e8f0;">${logo}${name}</div>`;
}
