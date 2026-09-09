// ============================================================================
// Deneme/lisans suresi — TEK dogruluk kaynagi.
//
// Kok neden (Lisans/Deneme Suresi Tutarliligi analizi): companies tablosunda
// iki ayri "deneme bitisi" kolonu var — trial_ends_at (surekli guncellenen,
// TUM saglayici/uzatma RPC'lerinin ve Super Admin panelinin kullandigi
// kolon) ve trial_end (supabase_pilot_saas_hardening.sql'de BIR KEREYE
// MAHSUS backfill edilmis, o tarihten sonra HICBIR yerde guncellenmeyen
// "donuk" kolon). Eskiden bazi yerler (AuthContext.isTrialExpired, Layout
// ust seridi, register_device_and_touch_login RPC'si) trial_end'i ONCELIKLI
// aliyordu — bir firmanin denemesi trial_ends_at uzerinden uzatildiginda
// trial_end donuk kaldigi icin o firma HALA "suresi dolmus" gorunebiliyordu
// (banner "X gun kaldi" derken kullanici /locked ekranina dusebiliyordu).
//
// Karar: trial_ends_at TEK dogruluk kaynagidir. trial_end ARTIK hicbir
// yerde okunmaz (DB'de kalabilir, gelecekte ayrica temizlenebilir).
//
// FAIL-CLOSED karari: trial durumunda VE is_pilot=false olan bir firmada
// trial_ends_at NULL ise, bu "hala aktif" degil "suresi dolmus" sayilir
// (once fail-open'di, yani hep gecerli sayiliyordu — bu ONAYLANMADI ve
// degistirildi). Aktif ucretli firmalar (plan_status active/lifetime) bu
// kontrolden HIC etkilenmez. is_pilot=true firmalar tarih NULL/gecmis olsa
// da MUAF kalir. Ayni kural SQL tarafinda migration 011'deki
// is_company_writable()/register_device_and_touch_login() icinde de
// uygulanir (bkz. supabase_migration_011_trial_ends_at_single_source.sql).
//
// is_pilot=true olan firmalar TUM deneme-suresi kilitlerinden muaftir —
// bu kural burada, AuthContext'te, register_device_and_touch_login RPC'sinde
// ve Layout'un kendi bagimsiz purchase-gate'inde AYNI sekilde uygulanir.
// ============================================================================

const ISTANBUL_TZ = "Europe/Istanbul";

export type TrialCompanyLike = {
  is_pilot?: boolean | null;
  plan_status?: string | null;
  trial_ends_at?: string | null;
};

/**
 * Bir firmanin denemesi (gercekten, engelleyici anlamda) dolmus mu?
 * Bu, GATING karari icin kullanilir — kesin an (timestamptz) karsilastirmasidir,
 * saat dilimi burada ONEMSIZDIR (iki mutlak an karsilastiriliyor).
 *
 * is_pilot=true -> HER ZAMAN false (pilot firmalar, tarih NULL/gecmis olsa
 * da hicbir zaman kilitlenmez).
 * plan_status 'active'/'lifetime' -> false (bu NULL-tarih kontrolunden
 * TAMAMEN etkilenmez).
 * plan_status 'expired' -> true (trial tarihinden bagimsiz).
 * Aksi halde (trial durumunda, pilot degil): trial_ends_at NULL ise ->
 * FAIL-CLOSED, true doner (SQL migration 011 ile ayni karar — bkz.
 * supabase_migration_011_trial_ends_at_single_source.sql). trial_ends_at
 * doluysa gecmis mi diye kesin an karsilastirmasi yapilir.
 */
export function isTrialExpired(company: TrialCompanyLike | null | undefined): boolean {
  if (!company) return false;
  if (company.is_pilot) return false;

  const status = String(company.plan_status ?? "").toLowerCase();
  if (status === "expired") return true;
  if (status === "active" || status === "lifetime") return false;

  if (!company.trial_ends_at) return true;
  return new Date(company.trial_ends_at).getTime() < Date.now();
}

/** İki tarihi Europe/Istanbul TAKVIM gunu olarak karsilastirip tam gun farkini dondurur.
 * Goruntuleme ("kaç gün kaldı") icin kullanilir — GATING karari icin degil (bkz. isTrialExpired,
 * o kesin ana gore calisir). Boylece tarayicinin kendi saat dilimi "kaç gün kaldı" sayisini
 * kaydirmaz; herkes Turkiye takvim gunune gore ayni sayiyi gorur. */
function istanbulDateOnlyStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ISTANBUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function daysBetweenIstanbul(fromDate: Date, toDate: Date): number {
  const [fy, fm, fd] = istanbulDateOnlyStr(fromDate).split("-").map(Number);
  const [ty, tm, td] = istanbulDateOnlyStr(toDate).split("-").map(Number);
  const fromUTC = Date.UTC(fy, fm - 1, fd);
  const toUTC = Date.UTC(ty, tm - 1, td);
  return Math.round((toUTC - fromUTC) / 86400000);
}

export type TrialDisplayInfo = {
  /** plan_status === 'trial' mi (deneme banner'i gosterilmeli mi) */
  isTrialPlan: boolean;
  trialEndsAt: Date | null;
  /** Europe/Istanbul takvim gunune gore kalan tam gun sayisi (negatif olabilir). null = trial_ends_at yok. */
  daysLeft: number | null;
  /** Kesin ana gore (bkz. isTrialExpired) — is_pilot=true ise HER ZAMAN false. */
  isExpired: boolean;
};

/** Dashboard/Layout banner'larinin ORTAK kaynagi. `now` yalnizca test icin opsiyoneldir. */
export function getTrialDisplayInfo(company: TrialCompanyLike | null | undefined, now: Date = new Date()): TrialDisplayInfo {
  if (!company) {
    return { isTrialPlan: false, trialEndsAt: null, daysLeft: null, isExpired: false };
  }
  const status = String(company.plan_status ?? "").toLowerCase();
  const isTrialPlan = status === "trial" || status === "" || status == null;
  if (!isTrialPlan) {
    return { isTrialPlan: false, trialEndsAt: null, daysLeft: null, isExpired: false };
  }
  const trialEndsAt = company.trial_ends_at ? new Date(company.trial_ends_at) : null;
  const daysLeft = trialEndsAt ? daysBetweenIstanbul(now, trialEndsAt) : null;
  return {
    isTrialPlan: true,
    trialEndsAt,
    daysLeft,
    isExpired: isTrialExpired(company),
  };
}

/** Deneme/lisans tarihlerinin goruntulenmesinde kullanilan TEK formatlayici —
 * her zaman Europe/Istanbul saatiyle gosterir (tarayicinin kendi saat dilimine
 * gore kaymaz). Yalniz lisans/deneme baglaminda kullanilir; formatTR() gibi
 * genel amacli (randevu/hatirlatma) formatlayicilar BURADAN etkilenmez. */
export function formatTrialDateTR(d: Date | string | null, opts: { withTime?: boolean } = {}): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (opts.withTime) {
    return new Intl.DateTimeFormat("tr-TR", {
      timeZone: ISTANBUL_TZ,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: ISTANBUL_TZ,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}
