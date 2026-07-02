import type { ReactNode } from "react";
import { LockKeyhole } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const MODULE_LABELS: Record<string, string> = {
    accounting:   "Muhasebe & Finans",
    suppliers:    "Tedarikçiler",
    installation: "Montaj Takibi",
    reports:      "Raporlar",
    expenses:     "Gider Yönetimi",
    profit:       "Kâr Analizi",
    branches:     "Şube Yönetimi",
    vehicles:     "Araç Takibi",
    commissions:  "Komisyon Hesaplama",
    warehouse:    "Depo Yönetimi",
    staff:        "Personel",
    catalogs:     "Kartela Yönetimi",
};

const MODULE_REQUIRED_PLAN: Record<string, string> = {
    accounting:   "Professional",
    reports:      "Professional",
    expenses:     "Professional",
    profit:       "Professional",
    suppliers:    "Solo veya üzeri",
    installation: "Solo veya üzeri",
    branches:     "Enterprise",
    vehicles:     "Enterprise",
    commissions:  "Enterprise",
    warehouse:    "Enterprise",
};

function getUpgradeUrl(moduleName: string) {
    const label = MODULE_LABELS[moduleName] ?? moduleName;
    const plan = MODULE_REQUIRED_PLAN[moduleName] ?? "üst paket";
    const msg = encodeURIComponent(
        `Merhaba, PerdePRO kullanıcısıyım. "${label}" modülü için ${plan} paketine geçmek istiyorum. Bilgi alabilir miyim?`
    );
    return `https://wa.me/905308427870?text=${msg}`;
}

export default function ModuleGate({ module, children }: { module: string; children: ReactNode }) {
    const { hasModule, company } = useAuth();

    if (hasModule(module)) return <>{children}</>;

    const label = MODULE_LABELS[module] ?? module;
    const requiredPlan = MODULE_REQUIRED_PLAN[module];
    const currentPlan = company?.subscription_plan || "starter";

    return (
        <div className="m-4 rounded-3xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-900">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-amber-700 shadow-sm">
                <LockKeyhole className="h-8 w-8" />
            </div>
            <h2 className="text-xl font-black">{label} — Paketinizde Yok</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6">
                Mevcut paketiniz: <span className="font-bold">{currentPlan}</span>.
                {requiredPlan
                    ? ` Bu modül için ${requiredPlan} paketine geçmeniz gerekiyor.`
                    : " Bu modülü kullanmak için paketinizi yükseltin."}
            </p>
            <button
                type="button"
                className="mt-5 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white hover:bg-slate-700 active:scale-95 transition"
                onClick={() => window.open(getUpgradeUrl(module), "_blank", "noreferrer")}
            >
                Satın Al / Yükselt
            </button>
        </div>
    );
}
