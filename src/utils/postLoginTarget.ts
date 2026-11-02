/**
 * Giris yapmamis kullanici siteden "Kampanyadan Yararlan" ile /subscription adresine geldiginde
 * giris sonrasi ayni ekrana donmesi icin. YALNIZ /subscription (beyaz liste) saklanir; baska adres tutulmaz.
 */
const KEY = "perdepro_post_login_target";
const ALLOWED = /^\/subscription(\?plan=[a-z_]{1,32})?$/;

export function rememberPostLoginTarget(pathname: string, search: string): void {
  try {
    const target = `${pathname}${search}`;
    if (ALLOWED.test(target)) sessionStorage.setItem(KEY, target);
  } catch { /* depolama kapali olabilir */ }
}

/** Saklanan hedefi bir kez dondurur ve siler. */
export function consumePostLoginTarget(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return v && ALLOWED.test(v) ? v : null;
  } catch {
    return null;
  }
}
