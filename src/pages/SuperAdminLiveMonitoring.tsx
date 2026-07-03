import { useEffect, useState } from "react";
import { Activity, Globe, Users, Zap } from "lucide-react";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { supabase } from "../supabaseClient";
import { cn } from "../utils/cn";

type ActiveCompany = {
    company_id: string;
    company_name: string;
    active_user_count: number;
    active_device_count: number;
    last_activity_at: string;
    pages: Record<string, number>;
};

type RawSession = {
    id: string;
    target_company_id: string;
    session_start: string;
    accessed_pages: string[];
    companies: { id: string; name: string } | null;
};

export default function SuperAdminLiveMonitoring() {
    const [companies, setCompanies] = useState<ActiveCompany[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [totalActiveUsers, setTotalActiveUsers] = useState(0);
    const [totalActiveFirms, setTotalActiveFirms] = useState(0);
    const [subscriptionActive, setSubscriptionActive] = useState(false);

    useEffect(() => {
        loadInitialData();
        setupRealtime();
    }, []);

    async function loadInitialData() {
        setLoading(true);
        setError("");
        try {
            // Get active sessions
            const { data: sessions, error: sessErr } = await supabase
                .from("admin_sessions")
                .select("*, companies(id, name)")
                .is("session_end", null)
                .order("session_start", { ascending: false });

            if (sessErr) throw sessErr;

            // Get active devices
            const { data: devices, error: devErr } = await supabase
                .from("company_devices")
                .select("company_id")
                .eq("is_active", true);

            if (devErr) throw devErr;

            // Process data
            const companyMap = new Map<string, ActiveCompany>();

            // Add from sessions
            (sessions || []).forEach((session: RawSession) => {
                const cid = session.target_company_id;
                const cname = session.companies?.name || "Bilinmeyen Firma";

                if (!companyMap.has(cid)) {
                    companyMap.set(cid, {
                        company_id: cid,
                        company_name: cname,
                        active_user_count: 0,
                        active_device_count: 0,
                        last_activity_at: session.session_start,
                        pages: {},
                    });
                }

                const company = companyMap.get(cid)!;
                company.active_user_count += 1;

                // Count pages
                const pages = (session.accessed_pages || []) as string[];
                pages.forEach((page) => {
                    company.pages[page] = (company.pages[page] || 0) + 1;
                });
            });

            // Add device counts
            (devices || []).forEach((device: { company_id: string }) => {
                const company = companyMap.get(device.company_id);
                if (company) {
                    company.active_device_count += 1;
                }
            });

            const companiesList = Array.from(companyMap.values()).sort((a, b) =>
                new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime()
            );

            setCompanies(companiesList);
            setTotalActiveFirms(companiesList.length);
            setTotalActiveUsers(companiesList.reduce((sum, c) => sum + c.active_user_count, 0));
        } catch (e: any) {
            setError(e?.message || "Veri yüklenirken hata oluştu");
        } finally {
            setLoading(false);
        }
    }

    function setupRealtime() {
        const channel = supabase
            .channel("live-monitoring")
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "admin_sessions",
                },
                () => {
                    loadInitialData();
                }
            )
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "company_devices",
                },
                () => {
                    loadInitialData();
                }
            )
            .subscribe((status) => {
                if (status === "SUBSCRIBED") {
                    setSubscriptionActive(true);
                }
            });

        // Fallback polling every 10 seconds
        const pollInterval = setInterval(() => {
            loadInitialData();
        }, 10000);

        return () => {
            clearInterval(pollInterval);
            channel.unsubscribe();
        };
    }

    const timeNow = new Date();

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-green-100 dark:bg-green-900/30">
                            <Activity size={20} className="text-green-600 animate-pulse" />
                        </div>
                        <h1 className="text-3xl font-black text-slate-900 dark:text-white">Canlı Kullanıcı Takibi</h1>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">
                        {subscriptionActive && <span className="text-green-600 dark:text-green-400">🔴 Canlı İzleme Aktif</span>}
                        {!subscriptionActive && <span className="text-amber-600 dark:text-amber-400">⚪ Polling Modu</span>}
                    </p>
                </div>

                {/* Stats Overview */}
                <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <StatCard
                        icon={<Globe size={24} />}
                        label="Aktif Firma"
                        value={totalActiveFirms}
                        color="blue"
                    />
                    <StatCard
                        icon={<Users size={24} />}
                        label="Toplam Aktif Kullanıcı"
                        value={totalActiveUsers}
                        color="emerald"
                    />
                    <StatCard
                        icon={<Zap size={24} />}
                        label="Son Güncelleme"
                        value={format(timeNow, "HH:mm:ss")}
                        color="amber"
                    />
                </div>

                {/* Companies Grid */}
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="text-slate-600 dark:text-slate-400">Veriler yükleniyor...</div>
                    </div>
                ) : error ? (
                    <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/10 p-6">
                        <p className="text-red-700 dark:text-red-400">{error}</p>
                    </div>
                ) : companies.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center">
                        <Activity size={48} className="mx-auto text-slate-400 mb-4" />
                        <p className="text-slate-600 dark:text-slate-400">Şu anda aktif firma yok</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                        {companies.map((company) => (
                            <div
                                key={company.company_id}
                                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 hover:border-blue-300 dark:hover:border-blue-700 transition"
                            >
                                {/* Header */}
                                <div className="flex items-start justify-between mb-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                                    <div>
                                        <h3 className="text-lg font-black text-slate-900 dark:text-white">
                                            {company.company_name}
                                        </h3>
                                        <p className="text-xs text-slate-500 mt-1">
                                            {format(new Date(company.last_activity_at), "HH:mm:ss", { locale: tr })}
                                        </p>
                                    </div>
                                    <div
                                        className={cn(
                                            "h-3 w-3 rounded-full animate-pulse",
                                            "bg-green-600"
                                        )}
                                    />
                                </div>

                                {/* Stats */}
                                <div className="mb-4 grid grid-cols-2 gap-3">
                                    <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3">
                                        <p className="text-xs text-blue-600 dark:text-blue-400 font-black">AKTIF KULLANICI</p>
                                        <p className="text-2xl font-black text-blue-700 dark:text-blue-300 mt-1">
                                            {company.active_user_count}
                                        </p>
                                    </div>
                                    <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3">
                                        <p className="text-xs text-emerald-600 dark:text-emerald-400 font-black">CİHAZ</p>
                                        <p className="text-2xl font-black text-emerald-700 dark:text-emerald-300 mt-1">
                                            {company.active_device_count}
                                        </p>
                                    </div>
                                </div>

                                {/* Pages Section */}
                                <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-4">
                                    <p className="text-xs font-black text-slate-600 dark:text-slate-400 uppercase tracking-widest mb-3">
                                        Sayfalar
                                    </p>
                                    {Object.keys(company.pages).length === 0 ? (
                                        <p className="text-xs text-slate-500">Sayfa bilgisi yok</p>
                                    ) : (
                                        <div className="space-y-2">
                                            {Object.entries(company.pages)
                                                .sort((a, b) => b[1] - a[1])
                                                .slice(0, 5)
                                                .map(([page, count]) => (
                                                    <div key={page} className="flex items-center justify-between text-sm">
                                                        <span className="text-slate-700 dark:text-slate-300 truncate">
                                                            {formatPageName(page)}
                                                        </span>
                                                        <div className="flex items-center gap-2">
                                                            <div className="h-1.5 w-16 bg-blue-200 dark:bg-blue-900 rounded-full overflow-hidden">
                                                                <div
                                                                    className="h-full bg-blue-600 dark:bg-blue-400"
                                                                    style={{
                                                                        width: `${(count / Math.max(...Object.values(company.pages))) * 100}%`,
                                                                    }}
                                                                />
                                                            </div>
                                                            <span className="text-xs font-black text-slate-600 dark:text-slate-400 w-6 text-right">
                                                                {count}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function StatCard({
    icon,
    label,
    value,
    color,
}: {
    icon: React.ReactNode;
    label: string;
    value: string | number;
    color: "blue" | "emerald" | "amber";
}) {
    const bgColor =
        color === "blue"
            ? "bg-blue-50 dark:bg-blue-900/20"
            : color === "emerald"
              ? "bg-emerald-50 dark:bg-emerald-900/20"
              : "bg-amber-50 dark:bg-amber-900/20";

    const textColor =
        color === "blue"
            ? "text-blue-600 dark:text-blue-400"
            : color === "emerald"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-amber-600 dark:text-amber-400";

    const valueColor =
        color === "blue"
            ? "text-blue-700 dark:text-blue-300"
            : color === "emerald"
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-amber-700 dark:text-amber-300";

    return (
        <div className={cn("rounded-2xl border border-slate-200 dark:border-slate-800 p-6", bgColor)}>
            <div className={cn("flex items-center justify-center h-12 w-12 rounded-lg mb-3", "bg-white dark:bg-slate-900")}>
                <div className={textColor}>{icon}</div>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400 font-medium">{label}</p>
            <p className={cn("text-3xl font-black mt-2", valueColor)}>{value}</p>
        </div>
    );
}

function formatPageName(page: string): string {
    const pageNames: Record<string, string> = {
        "/orders": "Siparişler",
        "/customers": "Müşteriler",
        "/measurements": "Ölçüler",
        "/appointments": "Randevular",
        "/accounting": "Muhasebe",
        "/products": "Ürünler",
        "/suppliers": "Tedarikçiler",
        "/dashboard": "Gösterge Paneli",
        "/settings": "Ayarlar",
    };

    return pageNames[page] || page || "Ana Sayfa";
}
