import { useState } from "react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../context/AuthContext";
import { CheckCircle2, ArrowRight, Loader2 } from "lucide-react";

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
  const { company } = useAuth();
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

      onComplete();
    } catch (e: any) {
      setError(e?.message || "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary-600 to-primary-700 px-6 py-8 sm:px-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-shrink-0">
              <div className="flex items-center justify-center h-10 w-10 rounded-full bg-white/20">
                <span className="text-lg font-black text-white">{step}</span>
              </div>
            </div>
            <h1 className="text-2xl font-black text-white">PerdePRO'ya Hoş Geldin</h1>
          </div>
          <p className="text-primary-50 text-sm">3 adımda başlangıç yap</p>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-slate-200 dark:bg-slate-800">
          <div
            className="h-full bg-primary-600 transition-all duration-300"
            style={{ width: `${(step / 3) * 100}%` }}
          />
        </div>

        {/* Content */}
        <div className="px-6 py-8 sm:px-8">
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

              <button
                onClick={() => {
                  setError("");
                  setStep(2);
                }}
                disabled={!companyName.trim()}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-6 py-3 text-white font-semibold hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Devam Et
                <ArrowRight className="w-4 h-4" />
              </button>
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
                <div className="grid grid-cols-2 gap-2">
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

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 px-6 py-3 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  Geri
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-6 py-3 text-white font-semibold hover:bg-primary-700 transition-colors"
                >
                  Devam Et
                  <ArrowRight className="w-4 h-4" />
                </button>
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

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(2)}
                  className="flex-1 px-6 py-3 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  Geri
                </button>
                <button
                  onClick={handleCompleteOnboarding}
                  disabled={loading}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Başla
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
