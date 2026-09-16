import { useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../supabaseClient";
import { useAuth } from "../context/AuthContext";
import { CheckCircle2, Loader2 } from "lucide-react";

type OnboardingWizardProps = {
  companyId: string;
  companyName: string;
  packageCode?: string | null;
  onComplete: () => void;
};

const MODULE_LABELS: Record<string, string> = {
  admin: "Yönetici",
  measurements: "Ölçü",
  orders: "Sipariş",
  customers: "Müşteriler",
  appointments: "Randevular",
  catalogs: "Kartela",
  staff: "Personel",
  suppliers: "Tedarikçi",
  installation: "Montaj",
  accounting: "Muhasebe",
  reports: "Raporlar",
  expenses: "Giderler",
  profit: "Kar",
  vehicles: "Araç Takibi",
  commissions: "Prim Sistemi",
  warehouse: "Depo",
  branches: "Şubeler",
};

const PLAN_MODULES: Record<string, string[]> = {
  starter: ["admin", "measurements", "orders", "customers", "appointments", "catalogs", "staff"],
  solo: ["admin", "measurements", "orders", "customers", "appointments", "suppliers", "installation"],
  pro: ["admin", "measurements", "orders", "customers", "appointments", "suppliers", "installation", "accounting", "staff", "catalogs", "reports", "expenses"],
  enterprise: ["admin", "measurements", "orders", "customers", "appointments", "suppliers", "installation", "accounting", "staff", "catalogs", "reports", "expenses", "profit", "vehicles", "commissions", "warehouse", "branches"],
};

const PLAN_LABELS: Record<string, string> = {
  starter: "Başlangıç (CORE)",
  solo: "Solo Perdeci",
  pro: "Profesyonel (PRO)",
  enterprise: "Kurumsal (ENTERPRISE)",
  trial: "Deneme",
  lifetime: "Ömür Boyu",
};

export default function OnboardingWizard({
  companyId,
  companyName: initialName,
  packageCode = "solo",
  onComplete,
}: OnboardingWizardProps) {
  const { company, refreshAuth } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 1: Company info
  const [companyName, setCompanyName] = useState(initialName || "");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const modules = PLAN_MODULES[packageCode as keyof typeof PLAN_MODULES] || PLAN_MODULES.solo;
  const planLabel = PLAN_LABELS[packageCode as keyof typeof PLAN_LABELS] || "Bilinmiyor";
  const maxUsers = company?.max_users || 3;
  const maxDevices = company?.max_devices || 3;

  async function handleCompleteOnboarding() {
    if (!companyName.trim()) {
      setError("Firma adı gerekli");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { error: rpcError } = await supabase.rpc("complete_company_onboarding", {
        p_company_id: companyId,
        p_company_name: companyName,
        p_phone: phone || null,
        p_email: email || null,
      });

      if (rpcError) {
        setError(rpcError.message || "Onboarding tamamlanamadı");
        return;
      }

      // Confirm persistence before closing; other devices use this flag too.
      const { data: savedCompany, error: readError } = await supabase
        .from("companies")
        .select("onboarding_completed")
        .eq("id", companyId)
        .single();
      if (readError) throw readError;
      if (savedCompany?.onboarding_completed !== true) {
        throw new Error("Başlangıç kaydı tamamlanmadı. Lütfen tekrar deneyin.");
      }

      // Dashboard is remounted on navigation: refresh its shared company state.
      await refreshAuth();
      onComplete();
    } catch (e: any) {
      setError(e?.message || "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Başlangıç kurulumu" className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-2 sm:p-4" style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))", paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
      <div className="flex min-h-0 max-h-full w-full max-w-2xl flex-col bg-white dark:bg-slate-900 rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="shrink-0 bg-gradient-to-r from-primary-600 to-primary-700 px-4 py-4 sm:px-8 sm:py-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-shrink-0">
              <div className="flex items-center justify-center h-10 w-10 rounded-full bg-white/20">
                <span className="text-lg font-black text-white">{step}</span>
              </div>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-white">PerdePRO'ya Hoş Geldin</h1>
          </div>
          <p className="text-primary-50 text-sm">3 adımda başlangıç yap</p>
        </div>

        {/* Progress bar */}
        <div className="h-1 shrink-0 bg-slate-200 dark:bg-slate-800">
          <div
            className="h-full bg-primary-600 transition-all duration-300"
            style={{ width: `${(step / 3) * 100}%` }}
          />
        </div>

        {/* Content */}
        <div key={step} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-8">
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-black text-slate-900 dark:text-white mb-1">
                  Firma Bilgileri
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Başlangıç için gerekli bilgileri girin
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Firma Adı *
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Örn: Perdeci A.Ş."
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Telefon (İsteğe bağlı)
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+90 555 123 4567"
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    E-posta (İsteğe bağlı)
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="iletişim@firma.com"
                    className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>

              {error && <div className="rounded-xl bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-200">{error}</div>}


            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-black text-slate-900 dark:text-white mb-1">
                  Paket Özeti
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Seçili paketiniz ve özellikler
                </p>
              </div>

              <div className="rounded-2xl bg-gradient-to-br from-primary-50 to-primary-100/50 dark:from-primary-900/20 dark:to-primary-800/10 border border-primary-200 dark:border-primary-800 p-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      Paket
                    </span>
                    <span className="text-lg font-black text-primary-600 dark:text-primary-400">
                      {planLabel}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-primary-200 dark:border-primary-800">
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      Kullanıcı Limiti
                    </span>
                    <span className="text-lg font-black text-slate-900 dark:text-white">
                      {maxUsers}
                    </span>
                  </div>

                  <div className="flex items-center justify-between border-t border-primary-200 dark:border-primary-800 pt-2">
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      Cihaz Limiti
                    </span>
                    <span className="text-lg font-black text-slate-900 dark:text-white">
                      {maxDevices}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
                  Aktif Modüller ({modules.length})
                </h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {modules.map((mod) => (
                    <div
                      key={mod}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700"
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {MODULE_LABELS[mod] || mod}
                      </span>
                    </div>
                  ))}
                </div>
              </div>


            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-black text-slate-900 dark:text-white mb-1">
                  Hazır mısın?
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Başlamak için aşağıdaki adımları takip et
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                  <div className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900/30">
                    <span className="text-xs font-black text-primary-600 dark:text-primary-400">
                      1
                    </span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-900 dark:text-white text-sm">
                      İlk müşterini oluştur
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                      Müşteriler sayfasından yeni kayıt ekle
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                  <div className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900/30">
                    <span className="text-xs font-black text-primary-600 dark:text-primary-400">
                      2
                    </span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-900 dark:text-white text-sm">
                      Ürün/fiyat listesini düzenle
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                      Kartela modülünde ürünleri ekle ve fiyatlandır
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                  <div className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900/30">
                    <span className="text-xs font-black text-primary-600 dark:text-primary-400">
                      3
                    </span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-900 dark:text-white text-sm">
                      Ekibini davet et
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                      Ayarlar'da takım üyelerini davet et
                    </p>
                  </div>
                </div>
              </div>

              {error && <div className="rounded-xl bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-200">{error}</div>}


            </div>
          )}
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white dark:bg-slate-900 px-4 py-3 sm:px-8">
          <div className="flex gap-3">
            {step > 1 && (
              <button type="button" disabled={loading} onClick={() => { setError(""); setStep(step - 1); }}
                className="min-h-12 flex-1 rounded-xl border border-slate-300 px-3 py-3 font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-50">
                Geri
              </button>
            )}
            <button type="button" disabled={loading || !companyName.trim()}
              onClick={() => { if (step === 3) { void handleCompleteOnboarding(); } else { setError(""); setStep(step + 1); } }}
              className="min-h-12 flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-3 py-3 font-semibold text-white disabled:opacity-50">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {step === 3 ? "Kaydet ve Başla" : "Devam Et"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
