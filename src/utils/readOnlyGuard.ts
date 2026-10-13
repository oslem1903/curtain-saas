// Salt okunur (deneme/abonelik suresi dolmus) modda istemci tarafi yazma korumasi.
// Urun karari: sure bitince goruntuleme ve disa aktarma ACIK; yeni kayit, duzenleme, silme KAPALI.
// PostgREST RPC'leri ve Storage imzalama/listeleme POST ile gider; bunlar OKUMA oldugu icin engellenmemeli.
// Sunucu (tetikleyici/RLS) asil zorlayicidir; bu yalnizca kullaniciya erken ve temiz geri bildirimdir.

const BLOCKED_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

// Oturum/davet/erisim akisi: salt okunur hesap bile girebilmeli.
const ACCESS_RPCS = [
  "get_current_auth_context", "register_device_and_touch_login", "complete_pending_invite_for_current_user",
  "claim_pending_invites_for_current_user", "accept_invite_code_for_current_user", "accept_invite_for_current_user",
  "get_invite_by_token", "get_invite_by_email_code",
];

// Veri DEGISTIRMEYEN, ekran/PDF icin gereken okuma RPC'leri (abonelik kapisi yok, yazma yok).
const READ_RPCS = ["get_supplier_ledger", "get_branch_stats"];

const ALLOWED_RPC = new RegExp(`/rest/v1/rpc/(${[...ACCESS_RPCS, ...READ_RPCS].join("|")})$`);
// Gorsel/dosya GORUNTULEME: imzali adres uretme ve klasor listeleme (yukleme/silme degil).
const ALLOWED_STORAGE_READ = /\/storage\/v1\/object\/(sign|list)\//;

export function isReadOnlyBlocked(method: string | undefined, urlOrPath: string, base = "http://localhost"): boolean {
  if (!method || !BLOCKED_METHODS.has(method.toUpperCase())) return false;
  let pathname: string;
  try { pathname = new URL(urlOrPath, base).pathname; } catch { pathname = urlOrPath; }
  if (pathname.includes("/auth/v1/")) return false;
  if (ALLOWED_RPC.test(pathname)) return false;
  if (ALLOWED_STORAGE_READ.test(pathname)) return false;
  return true;
}
