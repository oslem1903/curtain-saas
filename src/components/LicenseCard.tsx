import { useAuth } from "../context/AuthContext";
import { Lock, CheckCircle2, AlertCircle } from "lucide-react";

const STATUS_CONFIG: Record<
    string,
    { label: string; bgColor: string; textColor: string; icon: React.ComponentType<{ className?: string }> }
> = {
    trial: {
        label: "Deneme Sürümü",
        bgColor: "bg-blue-50 dark:bg-blue-950/30",
        textColor: "text-blue-700 dark:text-blue-300",
        icon: AlertCircle,
    },
    active: {
        label: "Aktif",
        bgColor: "bg-emerald-50 dark:bg-emerald-950/30",
        textColor: "text-emerald-700 dark:text-emerald-300",
        icon: CheckCircle2,
    },
    suspended: {
        label: "Askıya Alındı",
        bgColor: "bg-orange-50 dark:bg-orange-950/30",
        textColor: "text-orange-700 dark:text-orange-300",
        icon: AlertCircle,
    },
    expired: {
        label: "Süresi Doldu",
        bgColor: "bg-red-50 dark:bg-red-950/30",
        textColor: "text-red-700 dark:text-red-300",
        icon: AlertCircle,
    },
    cancelled: {
        label: "İptal Edildi",
        bgColor: "bg-red-50 dark:bg-red-950/30",
        textColor: "text-red-700 dark:text-red-300",
        icon: AlertCircle,
    },
};

function calculateRemainingDays(expiresAt: string | null | undefined): string {
    if (!expiresAt) return "—";

    const now = new Date();
    const expiryDate = new Date(expiresAt);

    if (expiryDate < now) {
        return "Süresi doldu";
    }

    const diffTime = expiryDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        return "Bugün sona eriyor";
    } else if (diffDays === 1) {
        return "1 gün kaldı";
    } else {
        return `${diffDays} gün kaldı`;
    }
}

export function LicenseCard() {
    const { company } = useAuth();

    if (!company) {
        return (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6 sm:p-8">
                <div className="animate-pulse space-y-4">
                    <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded w-1/3"></div>
                    <div className="h-12 bg-slate-200 dark:bg-slate-800 rounded"></div>
                </div>
            </div>
        );
    }

    const status =
        String(company.subscription_status || "trial").toLowerCase();
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.trial;
    const StatusIcon = config.icon;

    const isLifetime =
        company.subscription_plan === "lifetime" &&
        !company.license_expires_at;
    const remainingDays = calculateRemainingDays(company.license_expires_at);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            {/* Header */}
            <div className={`border-b border-slate-100 dark:border-slate-800 p-6 sm:p-8 ${config.bgColor}`}>
                <div className="flex items-center gap-3 mb-4">
                    <Lock className="w-5 h-5 text-primary-600" />
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        Lisans Bilgileri
                    </h3>
                </div>

                <div className="flex items-center gap-2">
                    <StatusIcon className={`w-5 h-5 ${config.textColor}`} />
                    <span className={`text-sm font-semibold ${config.textColor}`}>
                        {config.label}
                    </span>
                </div>
            </div>

            {/* Content */}
            <div className="p-6 sm:p-8">
                <div className="grid gap-6 md:grid-cols-2">
                    {/* Package */}
                    <div>
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                            Paket
                        </p>
                        <p className="text-lg font-semibold text-slate-900 dark:text-white">
                            {company.package_code || company.subscription_plan || "—"}
                        </p>
                    </div>

                    {/* Subscription Status */}
                    <div>
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                            Abonelik Durumu
                        </p>
                        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${config.bgColor}`}>
                            <StatusIcon className={`w-4 h-4 ${config.textColor}`} />
                            <span className={`text-sm font-semibold ${config.textColor}`}>
                                {config.label}
                            </span>
                        </div>
                    </div>

                    {/* Trial Ends */}
                    {company.trial_ends_at && (
                        <div>
                            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                                Deneme Sürümü Bitiş
                            </p>
                            <p className="text-slate-900 dark:text-white">
                                {new Date(company.trial_ends_at).toLocaleDateString(
                                    "tr-TR"
                                )}
                            </p>
                        </div>
                    )}

                    {/* License Expires */}
                    <div>
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                            Lisans Bitiş Tarihi
                        </p>
                        <p className="text-slate-900 dark:text-white">
                            {isLifetime
                                ? "Süresiz Lisans"
                                : company.license_expires_at
                                  ? new Date(
                                        company.license_expires_at
                                    ).toLocaleDateString("tr-TR")
                                  : "—"}
                        </p>
                    </div>

                    {/* Remaining Days */}
                    <div>
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                            Kalan Zaman
                        </p>
                        <p className="text-slate-900 dark:text-white font-semibold">
                            {isLifetime ? "Sınırsız" : remainingDays}
                        </p>
                    </div>

                    {/* Max Users */}
                    <div>
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                            Maksimum Kullanıcı
                        </p>
                        <p className="text-slate-900 dark:text-white">
                            {company.max_users || "—"}
                        </p>
                    </div>

                    {/* Max Devices */}
                    <div>
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                            Maksimum Cihaz
                        </p>
                        <p className="text-slate-900 dark:text-white">
                            {company.max_devices || "—"}
                        </p>
                    </div>
                </div>

                {/* Enabled Modules */}
                {company.enabled_modules && company.enabled_modules.length > 0 && (
                    <div className="mt-8 pt-8 border-t border-slate-100 dark:border-slate-800">
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-4">
                            Etkin Modüller
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {company.enabled_modules.map((module) => (
                                <span
                                    key={module}
                                    className="inline-flex items-center px-3 py-1.5 rounded-full bg-primary-100 dark:bg-primary-950/30 text-primary-700 dark:text-primary-300 text-sm font-medium"
                                >
                                    {module}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
