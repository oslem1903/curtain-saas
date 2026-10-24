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
  // Abonelik durumunu yoklayan RPC'ler POST ile gider; engellenirse uygulama kendi durum kontrolunu
  // yapamaz ve her engelleme satin alma ekranini tetikler.
  "company_subscription_access_allowed", "company_subscription_access_snapshot",
  "create_support_ticket_as_locked_user", "attach_support_ticket_screenshot",
];

// Arka plan telemetrisi / denetim kaydi (kullanicinin yazma girisimi DEGIL). Sunucuda bu tablolar
// 024'te BILEREK abonelik korumasi disindadir. Engellenirse her sayfa yuklemesinde satin alma ekrani
// acilir ve icerik gorunmez olur.
const TELEMETRY_RPCS = ["record_login", "record_user_activity", "report_client_error"];
const TELEMETRY_TABLES = ["app_devices", "audit_logs", "activity_logs", "user_activity", "error_logs"];

// Veri DEGISTIRMEYEN, ekran/PDF icin gereken okuma RPC'leri (abonelik kapisi yok, yazma yok).
const READ_RPCS = ["get_supplier_ledger", "get_branch_stats", "list_company_team"];

const ALLOWED_RPC = new RegExp(`/rest/v1/rpc/(${[...ACCESS_RPCS, ...READ_RPCS, ...TELEMETRY_RPCS].join("|")})$`);
// Destek: sure bitince de destek talebi acilabilmeli (024: "destek talebi acabilmeli"). Sunucuda
// support_tickets tetikleyicisiz, support-attachments Storage politikasinda istisnadir.
const SUPPORT_TABLES = ["support_tickets"];
const ALLOWED_TABLE = new RegExp(`/rest/v1/(${[...TELEMETRY_TABLES, ...SUPPORT_TABLES].join("|")})$`);
// Satin alma baslatma (Edge Function): sure bitince tam da bu islem gerekir. Veri yazmaz; lisansi yalniz
// sunucuda dogrulanmis odeme bildirimi acar.
const ALLOWED_FUNCTION = /\/functions\/v1\/billing-checkout$/;
const ALLOWED_SUPPORT_UPLOAD = /\/storage\/v1\/object\/support-attachments\//;
// Gorsel/dosya GORUNTULEME: imzali adres uretme ve klasor listeleme (yukleme/silme degil).
const ALLOWED_STORAGE_READ = /\/storage\/v1\/object\/(sign|list)\//;

export function isReadOnlyBlocked(method: string | undefined, urlOrPath: string, base = "http://localhost"): boolean {
  if (!method || !BLOCKED_METHODS.has(method.toUpperCase())) return false;
  let pathname: string;
  try { pathname = new URL(urlOrPath, base).pathname; } catch { pathname = urlOrPath; }
  if (pathname.includes("/auth/v1/")) return false;
  if (ALLOWED_RPC.test(pathname)) return false;
  if (ALLOWED_TABLE.test(pathname)) return false;
  if (ALLOWED_FUNCTION.test(pathname)) return false;
  if (ALLOWED_STORAGE_READ.test(pathname)) return false;
  if (ALLOWED_SUPPORT_UPLOAD.test(pathname)) return false;
  return true;
}
