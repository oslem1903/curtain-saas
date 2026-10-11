import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CreditCard, Loader2, ShieldCheck } from "lucide-react";

import { supabase } from "../supabaseClient";
import { useAuth } from "../context/AuthContext";
import { formatTrialDateTR, getTrialDisplayInfo, isSpecialAccessActive } from "../utils/trialLicense";
import { isNativeApp } from "../utils/nativeRuntime";

type Plan = { code: string; name: string; period: "month" | "year"; price_minor: number; currency: string; package_code: string };
type Payment = { id: string; created_at: string; amount_minor: number; currency: string; status: string; period_end: string | null; channel: string };
type Sub = { status: string; plan_code: string | null; current_period_end: string | null; cancel_at_period_end: boolean; channel: string };

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(minor / 100);

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
  const native = isNativeApp();
  const canPurchase = !native && memberRole === "admin";
  const paymentParam = params.get("payment");

  const load = useCallback(async () => {
    if (!company?.id) return;
    setLoading(true);
    try {
      const [p, s, h] = await Promise.all([
        supabase.from("billing_plans").select("code,name,period,price_minor,currency,package_code").order("price_minor"),
        supabase.from("billing_subscriptions").select("status,plan_code,current_period_end,cancel_at_period_end,channel").eq("company_id", company.id)
          .in("status", ["pending", "active", "past_due"]).maybeSingle(),
        supabase.from("billing_payments").select("id,created_at,amount_minor,currency,status,period_end,channel").eq("company_id", company.id)
          .order("created_at", { ascending: false }).limit(12),
      ]);
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
      const { data, error: fnError } = await supabase.functions.invoke("billing-checkout", { body: { company_id: company.id, plan_code: code } });
      if (fnError || !data?.checkoutFormContent) {
        setError("Ödeme sayfası şu anda başlatılamadı. Lütfen daha sonra tekrar deneyin.");
        return;
      }
      const w = window.open("", "_blank");
      if (!w) { setError("Açılır pencere engellendi. İzin verip tekrar deneyin."); return; }
      w.document.open();
      w.document.write(`<!doctype html><meta charset="utf-8"><title>Ödeme</title><div id="iyzipay-checkout-form" class="responsive">${data.checkoutFormContent}</div>`);
      w.document.close();
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
          <div><dt className="text-slate-500">Durum</dt><dd className="font-bold">{sub?.status ?? (trial.isExpired ? "süresi dolmuş" : planStatus || "-")}</dd></div>
          <div>
            <dt className="text-slate-500">Bitiş</dt>
            <dd className="font-bold">
              {special && !company?.pilot_until ? "Süresiz" : formatTrialDateTR(sub?.current_period_end ?? company?.license_expires_at ?? company?.trial_ends_at ?? null, { withTime: true })}
            </dd>
          </div>
          <div><dt className="text-slate-500">Yenileme</dt><dd className="font-bold">{sub ? (sub.cancel_at_period_end ? "İptal edildi" : "Otomatik") : "-"}</dd></div>
        </dl>
        {trial.isExpired && !special && planStatus !== "active" && (
          <p className="mt-3 text-sm text-slate-600">Verilerinizi görüntüleyebilir ve dışa aktarabilirsiniz; yeni kayıt ve değişiklikler abonelik açılana kadar kapalıdır.</p>
        )}
      </section>

      {canPurchase ? (
        <section className="grid gap-3 sm:grid-cols-2">
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          ) : plans.length === 0 ? (
            <p className="text-sm text-slate-500">Şu anda satın alınabilir plan bulunmuyor.</p>
          ) : (
            plans.map((p) => (
              <div key={p.code} className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <div className="text-sm font-bold text-slate-500">{p.period === "year" ? "Yıllık" : "Aylık"}</div>
                <div className="mt-1 text-xl font-black">{p.name}</div>
                <div className="mt-2 text-2xl font-black">{money(p.price_minor, p.currency)}</div>
                <button
                  type="button"
                  disabled={Boolean(busyPlan)}
                  onClick={() => void startCheckout(p.code)}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {busyPlan === p.code ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                  Ödemeye geç
                </button>
                <p className="mt-2 text-xs text-slate-500">Ödeme, onayınızla ve sağlayıcının güvenli sayfasında yapılır; kart bilgisi PerdePRO'da saklanmaz.</p>
              </div>
            ))
          )}
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
