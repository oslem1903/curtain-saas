import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CreditCard, Loader2, ShieldCheck } from "lucide-react";

import { supabase } from "../supabaseClient";
import { useAuth } from "../context/AuthContext";
import { formatTrialDateTR, getTrialDisplayInfo, isSpecialAccessActive } from "../utils/trialLicense";
import { isNativeApp } from "../utils/nativeRuntime";

type Plan = { code: string; name: string; period: "month" | "year"; price_minor: number; currency: string; package_code: string; is_purchasable: boolean; sort_order: number };
type Payment = { id: string; created_at: string; amount_minor: number; currency: string; status: string; period_end: string | null; channel: string };
type Sub = { status: string; plan_code: string | null; current_period_end: string | null; cancel_at_period_end: boolean; channel: string };

/** Sunucudaki durum kodlarini kullaniciya Turkce goster ("trial" -> "Deneme"). */
const STATUS_LABELS: Record<string, string> = {
  trial: "Deneme",
  active: "Aktif",
  pending: "Ödeme bekleniyor",
  past_due: "Ödeme gecikmiş",
  canceled: "İptal edildi",
  cancelled: "İptal edildi",
  expired: "Süresi dolmuş",
  refunded: "İade edildi",
  suspended: "Askıda",
  lifetime: "Süresiz",
  starter: "Deneme",
};
const statusLabel = (s: string | null | undefined) => {
  const key = String(s ?? "").trim().toLowerCase();
  return STATUS_LABELS[key] ?? (key ? key : "—");
};

const money = (minor: number, currency: string) => {
  if (currency === "TRY") {
    const tl = minor / 100;
    const digits = Number.isInteger(tl) ? 0 : 2;
    return `${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(tl)} TL`;
  }
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(minor / 100);
};

/** Satin alma YALNIZCA web/Windows'ta sunulur; mobil mağaza paketlerinde yalnizca durum gosterilir. */
export default function Subscription() {
  const { company, memberRole, refreshAuth } = useAuth();
  const [params] = useSearchParams();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [sub, setSub] = useState<Sub | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [available, setAvailable] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [isTestCompany, setIsTestCompany] = useState(false);
  const native = isNativeApp();
  const canPurchase = !native && memberRole === "admin";
  const paymentParam = params.get("payment");

  const load = useCallback(async () => {
    if (!company?.id) return;
    setLoading(true);
    try {
      const [p, s, h] = await Promise.all([
        supabase.from("billing_plans").select("code,name,period,price_minor,currency,package_code,is_purchasable,sort_order").order("sort_order"),
        supabase.from("billing_subscriptions").select("status,plan_code,current_period_end,cancel_at_period_end,channel").eq("company_id", company.id)
          .in("status", ["pending", "active", "past_due"]).maybeSingle(),
        supabase.from("billing_payments").select("id,created_at,amount_minor,currency,status,period_end,channel").eq("company_id", company.id)
          .order("created_at", { ascending: false }).limit(12),
      ]);
      // Test firmasi mi? (yalniz sunucuda isaretlenen QA firmalari; herkese acik satin almayi ACMAZ)
      const t = await supabase.from("billing_test_companies").select("company_id").eq("company_id", company.id).maybeSingle();
      setIsTestCompany(Boolean(t.data?.company_id));
      // Tablolar henuz kurulu degilse (migration uygulanmamis) ekran "kullanilamiyor" gosterir.
      if (p.error && /relation|does not exist|schema cache/i.test(p.error.message)) { setAvailable(false); return; }
      setPlans((p.data ?? []) as Plan[]);
      setSub((s.data ?? null) as Sub | null);
      setPayments((h.data ?? []) as Payment[]);
    } finally {
      setLoading(false);
    }
  }, [company?.id]);

  useEffect(() => { void load(); }, [load]);

  // Odeme baska pencerede (tarayici) tamamlanabilir: uygulamaya donuldugunde durumu yenile.
  useEffect(() => {
    const onFocus = () => { void refreshAuth(); void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshAuth, load]);

  // Odeme formundan donuste sunucu webhook'unu bekle: erisim yalnizca sunucu dogrulamasiyla acilir.
  useEffect(() => {
    if (paymentParam !== "pending") return;
    let tries = 0;
    const timer = window.setInterval(async () => {
      tries += 1;
      await refreshAuth();
      await load();
      if (tries >= 12) window.clearInterval(timer);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [paymentParam, refreshAuth, load]);

  const trial = useMemo(() => getTrialDisplayInfo(company as never), [company]);
  const special = company ? isSpecialAccessActive(company as never) : false;
  const planStatus = String(company?.plan_status ?? "").toLowerCase();

  async function startCheckout(code: string) {
    if (!company?.id || busyPlan) return;
    setBusyPlan(code);
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("billing-checkout", {
        body: { company_id: company.id, plan_code: code, accepted_terms: accepted },
      });
      const pageUrl = typeof data?.paymentPageUrl === "string" && /^https:\/\//.test(data.paymentPageUrl) ? data.paymentPageUrl : "";
      if (fnError || !pageUrl) {
        setError("Ödeme sayfası şu anda başlatılamadı. Lütfen daha sonra tekrar deneyin.");
        return;
      }
      window.open(pageUrl, "_blank", "noopener");
    } finally {
      setBusyPlan(null);
    }
  }

  if (!available) {
    return <div className="mx-auto max-w-3xl p-6 text-sm text-slate-600">Abonelik ve ödeme özelliği henüz etkin değil.</div>;
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 sm:p-6">
      <h1 className="text-2xl font-black text-slate-900 dark:text-white">Abonelik</h1>

      {paymentParam === "pending" && (
        <div role="status" className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm font-semibold text-sky-900">
          Ödemeniz alındı; bankadan/sağlayıcıdan doğrulama bekleniyor. Erişiminiz doğrulama sonrası otomatik açılır, çıkış yapmanız gerekmez.
        </div>
      )}
      {(paymentParam === "failed" || paymentParam === "error") && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">
          Ödeme tamamlanamadı. Hesabınızdan ücret alınmadıysa tekrar deneyebilirsiniz.
        </div>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-emerald-600" />
          <div>
            <div className="text-sm text-slate-500">{company?.name}</div>
            <div className="text-lg font-black">
              {special ? "Özel erişim" : planStatus === "active" ? "Aktif abonelik" : trial.isExpired ? "Deneme süresi doldu" : "Deneme süreci"}
            </div>
          </div>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-slate-500">Durum</dt><dd className="font-bold">{statusLabel(sub?.status ?? (trial.isExpired ? "expired" : planStatus || "trial"))}</dd></div>
          <div>
            <dt className="text-slate-500">Bitiş</dt>
            <dd className="font-bold">
              {special && !company?.pilot_until ? "Süresiz" : formatTrialDateTR(sub?.current_period_end ?? company?.license_expires_at ?? company?.trial_ends_at ?? null, { withTime: true })}
            </dd>
          </div>
          <div><dt className="text-slate-500">Yenileme</dt><dd className="font-bold">Otomatik yenileme yok</dd></div>
        </dl>
        {!native && planStatus === "active" && (
          <p className="mt-3 text-sm text-slate-600">Ödemeniz doğrulandı. Aynı firma ve verilerinizle devam edebilirsiniz; hesabınız tüm cihazlarınızda aynı lisansı kullanır.</p>
        )}
        {trial.isExpired && !special && planStatus !== "active" && (
          <p className="mt-3 text-sm text-slate-600">Verilerinizi görüntüleyebilir ve dışa aktarabilirsiniz; yeni kayıt ve değişiklikler abonelik açılana kadar kapalıdır.</p>
        )}
      </section>

      {!native ? (
        <section aria-labelledby="launch-prices" className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <h2 id="launch-prices" className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Açılışa Özel Fiyatlar</h2>
            <p className="max-w-3xl text-sm leading-6 text-slate-700 dark:text-slate-200">
              PerdePRO Solo · KDV dahil · tek seferlik dönem satın alma, otomatik yenileme yok. 7 gün ücretsiz deneme, kredi kartı gerekmez.
              Windows, iOS ve Android aynı firma lisansını kullanır; cihaz sınırları geçerlidir.
            </p>
          </div>

          {canPurchase && plans.some((p) => p.is_purchasable || isTestCompany) ? (
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 p-4 text-sm leading-6 transition-colors ${
                accepted
                  ? "border-emerald-500 bg-emerald-50 text-slate-900 dark:border-emerald-600 dark:bg-emerald-950/30 dark:text-slate-100"
                  : "border-amber-400 bg-amber-50 text-slate-900 dark:border-amber-500 dark:bg-amber-950/30 dark:text-slate-100"
              }`}
            >
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0 accent-blue-600"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                aria-describedby="consent-help"
              />
              <span>
                Seçtiğim dönem için <b>tek seferlik</b> ödeme yapmayı onaylıyorum. Aboneliğim <b>otomatik yenilenmez</b>, kartım kaydedilmez;
                süre dolmadan yeniden satın alabilirim.
                <span id="consent-help" className="mt-1 block text-xs font-bold text-slate-700 dark:text-slate-200">
                  {accepted ? "Onay verildi; ödeme düğmeleri etkin." : "Ödeme düğmeleri, bu kutuyu işaretleyene kadar pasiftir."}
                </span>
              </span>
            </label>
          ) : null}

          <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2">
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            ) : plans.length === 0 ? (
              <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 md:col-span-2">
                Paket bilgileri şu anda yüklenemedi. Süreniz dolduysa verilerinizi görüntüleyebilir ve dışa aktarabilirsiniz.
              </p>
            ) : (
              plans.map((p) => {
                const canPay = p.is_purchasable || isTestCompany;
                return (
                  <div
                    key={p.code}
                    className="flex h-full min-w-0 flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                      {p.period === "year" ? "1 yıllık kullanım" : "1 aylık kullanım"}
                    </div>
                    <div className="mt-3 flex items-baseline gap-2">
                      <span className="text-4xl font-black leading-none text-slate-900 dark:text-white">{money(p.price_minor, p.currency)}</span>
                      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">KDV dahil</span>
                    </div>
                    {/* Etiket alani iki kartta da ayni yuksekliktedir (hiza bozulmaz) */}
                    <div className="mt-3 min-h-[2rem]">
                      {p.period === "year" ? (
                        <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
                          Aylık ödemeye göre 2 ay avantajlı
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                          Tek seferlik · otomatik yenileme yok
                        </span>
                      )}
                    </div>
                    {canPurchase ? (
                      <div className="mt-auto pt-6">
                        {canPay ? (
                          <>
                            <button
                              type="button"
                              disabled={Boolean(busyPlan) || !accepted}
                              onClick={() => void startCheckout(p.code)}
                              aria-describedby="consent-help"
                              className="inline-flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-slate-700 dark:disabled:text-slate-300"
                            >
                              {busyPlan === p.code ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                              {p.is_purchasable ? "Ödemeye geç" : "Test ödemesine geç"}
                            </button>
                            <p className="mt-2 min-h-[1.25rem] text-xs font-semibold text-slate-700 dark:text-slate-200">
                              {!accepted ? "Önce yukarıdaki onay kutusunu işaretleyin." : "\u00A0"}
                            </p>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="inline-flex min-h-[3rem] w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl bg-slate-300 px-4 py-3 text-sm font-black text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                          >
                            Ödeme yakında açılacak
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
          {canPurchase && plans.length > 0 && !isTestCompany && !plans.some((p) => p.is_purchasable) ? (
            <p className="text-xs text-slate-700 dark:text-slate-200">Çevrimiçi ödeme doğrulama aşamasındadır; açıldığında bu ekrandan satın alabilirsiniz.</p>
          ) : null}
          {!canPurchase ? (
            <p className="text-xs text-slate-700 dark:text-slate-200">Satın alma işlemini firma yöneticisi yapabilir.</p>
          ) : null}
        </section>
      ) : null}

      {error ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</div> : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-black uppercase tracking-wider text-slate-500">Ödeme geçmişi</h2>
        {payments.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Kayıtlı ödeme yok.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <span>{formatTrialDateTR(p.created_at)} · {p.status === "succeeded" ? "Başarılı" : p.status === "refunded" ? "İade" : "Başarısız"}</span>
                <span className="font-bold">{money(p.amount_minor, p.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
