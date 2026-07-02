import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader, RotateCw, Search, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { supabase } from "../supabaseClient";
import { cn } from "../utils/cn";

type Company = {
    id: string;
    name: string;
};

type RemoteOperation = {
    id: string;
    operation_type: string;
    operation_status: "pending" | "in_progress" | "completed" | "failed";
    executed_by: string;
    started_at: string;
    completed_at: string | null;
    duration_ms: number | null;
    error_message: string | null;
};

const OPERATIONS = [
    { id: "cache_clear", name: "Cache Temizle", description: "Tüm cache verileri temizle", icon: "🗑️" },
    { id: "sync_data", name: "Veri Senkronize Et", description: "Tüm cihazlarla veri senkronizasyonu başlat", icon: "🔄" },
    { id: "reset_notifications", name: "Bildirimleri Yeniden Kur", description: "Bildirim sistemini sıfırla", icon: "🔔" },
    { id: "recalculate_orders", name: "Siparişleri Yeniden Hesapla", description: "Tüm siparişleri yeniden hesapla", icon: "📊" },
    { id: "recalculate_payments", name: "Ödemeleri Yeniden Hesapla", description: "Tüm ödeme verilerini yeniden hesapla", icon: "💰" },
    { id: "reset_dashboard", name: "Paneli Yeniden Oluştur", description: "Gösterge panelini temizle", icon: "📈" },
    { id: "renew_mobile_session", name: "Mobil Oturumu Yenile", description: "Tüm mobil oturumları yenile", icon: "📱" },
];

export default function SuperAdminRemoteMaintenance() {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [selectedCompany, setSelectedCompany] = useState<string>("");
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [logs, setLogs] = useState<RemoteOperation[]>([]);
    const [executing, setExecuting] = useState<string | null>(null);
    const [showLogs, setShowLogs] = useState(false);

    useEffect(() => {
        loadCompanies();
    }, []);

    async function loadCompanies() {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from("companies")
                .select("id, name")
                .eq("is_active", true)
                .order("name");

            if (error) throw error;
            setCompanies(data || []);
            if (data && data.length > 0) {
                setSelectedCompany(data[0].id);
                loadLogs(data[0].id);
            }
        } catch (e: any) {
            alert("Firma listesi yüklenirken hata: " + (e?.message || "Bilinmeyen hata"));
        } finally {
            setLoading(false);
        }
    }

    async function loadLogs(companyId: string) {
        try {
            const { data, error } = await supabase
                .from("remote_maintenance_logs")
                .select("*")
                .eq("company_id", companyId)
                .order("started_at", { ascending: false })
                .limit(20);

            if (error) throw error;
            setLogs(data || []);
        } catch (e: any) {
            console.error("Log yükleme hatası:", e?.message);
        }
    }

    async function executeOperation(operationType: string) {
        if (!selectedCompany) {
            alert("Lütfen bir firma seçin");
            return;
        }

        setExecuting(operationType);
        try {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { data, error } = await supabase.rpc("super_admin_execute_remote_action", {
                p_company_id: selectedCompany,
                p_operation_type: operationType,
                p_parameters: {},
            });

            if (error) throw error;

            // Show success message
            const opName = OPERATIONS.find((op) => op.id === operationType)?.name || operationType;
            alert(`✓ ${opName} başarıyla tamamlandı`);

            // Reload logs
            await loadLogs(selectedCompany);
        } catch (e: any) {
            alert("İşlem başarısız: " + (e?.message || "Bilinmeyen hata"));
        } finally {
            setExecuting(null);
        }
    }

    const filteredCompanies = companies.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
    const selectedCompanyName = companies.find((c) => c.id === selectedCompany)?.name;

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                            <RotateCw size={20} className="text-amber-600" />
                        </div>
                        <h1 className="text-3xl font-black text-slate-900 dark:text-white">Uzaktan Müdahale</h1>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">
                        Firma veritabanı ve uygulamasını uzaktan yönet
                    </p>
                </div>

                {/* Company Selector */}
                <div className="mb-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <h2 className="text-lg font-black text-slate-900 dark:text-white">Firma Seçin</h2>
                    </div>

                    <div className="relative mb-4">
                        <Search size={18} className="absolute left-3 top-3 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Firma adında ara..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-10 pr-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
                        />
                    </div>

                    {loading ? (
                        <div className="text-slate-500">Firmalar yükleniyor...</div>
                    ) : (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {filteredCompanies.map((company) => (
                                <button
                                    key={company.id}
                                    onClick={() => {
                                        setSelectedCompany(company.id);
                                        loadLogs(company.id);
                                    }}
                                    className={cn(
                                        "rounded-lg px-4 py-3 text-left text-sm font-medium transition",
                                        selectedCompany === company.id
                                            ? "border-2 border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                                            : "border border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700"
                                    )}
                                >
                                    {company.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {selectedCompany && (
                    <>
                        {/* Operations Grid */}
                        <div className="mb-8">
                            <h2 className="text-lg font-black text-slate-900 dark:text-white mb-4">İşlemler</h2>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                {OPERATIONS.map((operation) => (
                                    <button
                                        key={operation.id}
                                        onClick={() => {
                                            if (
                                                window.confirm(
                                                    `${selectedCompanyName} firması için "${operation.name}" işlemini yürütmek istiyor musunuz?\n\nBu işlem tersine çevrilemez!`
                                                )
                                            ) {
                                                executeOperation(operation.id);
                                            }
                                        }}
                                        disabled={executing === operation.id}
                                        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-amber-300 dark:hover:border-amber-700 disabled:opacity-60 transition text-left"
                                    >
                                        <div className="flex items-start justify-between mb-2">
                                            <span className="text-2xl">{operation.icon}</span>
                                            {executing === operation.id && (
                                                <Loader size={16} className="text-blue-600 animate-spin" />
                                            )}
                                        </div>
                                        <h3 className="font-black text-slate-900 dark:text-white mb-1">{operation.name}</h3>
                                        <p className="text-xs text-slate-600 dark:text-slate-400">{operation.description}</p>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Logs Section */}
                        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-black text-slate-900 dark:text-white">İşlem Geçmişi</h2>
                                <button
                                    onClick={() => setShowLogs(!showLogs)}
                                    className="text-xs font-black text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                    {showLogs ? "Gizle" : "Göster"}
                                </button>
                            </div>

                            {showLogs && (
                                <div className="space-y-2 mt-4">
                                    {logs.length === 0 ? (
                                        <p className="text-slate-500">Henüz işlem kaydı yok</p>
                                    ) : (
                                        logs.map((log) => (
                                            <div
                                                key={log.id}
                                                className={cn(
                                                    "rounded-lg border p-3 text-sm",
                                                    log.operation_status === "completed"
                                                        ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-900/10"
                                                        : log.operation_status === "failed"
                                                          ? "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/10"
                                                          : log.operation_status === "in_progress"
                                                            ? "border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-900/10"
                                                            : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50"
                                                )}
                                            >
                                                <div className="flex items-start justify-between gap-2 mb-1">
                                                    <div className="flex items-center gap-2">
                                                        {log.operation_status === "completed" && (
                                                            <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
                                                        )}
                                                        {log.operation_status === "failed" && (
                                                            <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />
                                                        )}
                                                        {log.operation_status === "in_progress" && (
                                                            <Loader size={16} className="text-blue-600 animate-spin flex-shrink-0" />
                                                        )}
                                                        {log.operation_status === "pending" && (
                                                            <AlertCircle size={16} className="text-slate-600 flex-shrink-0" />
                                                        )}
                                                        <span className="font-black text-slate-900 dark:text-white">
                                                            {OPERATIONS.find((op) => op.id === log.operation_type)?.name ||
                                                                log.operation_type}
                                                        </span>
                                                    </div>
                                                    <span className="text-xs text-slate-500 whitespace-nowrap">
                                                        {format(new Date(log.started_at), "d MMM HH:mm:ss", { locale: tr })}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-slate-600 dark:text-slate-400">
                                                    Status: {log.operation_status}
                                                    {log.duration_ms && ` • Süre: ${(log.duration_ms / 1000).toFixed(2)}s`}
                                                </p>
                                                {log.error_message && (
                                                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                                        Hata: {log.error_message}
                                                    </p>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
