import { useEffect, useState } from "react";
import { AlertTriangle, Download, Search } from "lucide-react";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { supabase } from "../supabaseClient";

type ErrorLog = {
    id: string;
    company_id: string;
    message: string;
    error_message?: string;
    app_version: string;
    created_at: string;
    companies?: { name: string };
};

type ErrorSummary = {
    module: string;
    count: number;
};

export default function SuperAdminErrorLogs() {
    const [errors, setErrors] = useState<ErrorLog[]>([]);
    const [summary, setSummary] = useState<ErrorSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [filterVersion, setFilterVersion] = useState("");
    const [versions, setVersions] = useState<string[]>([]);
    const [dateRange, setDateRange] = useState("7days");

    useEffect(() => {
        loadData();
    }, [dateRange, filterVersion]);

    async function loadData() {
        setLoading(true);
        try {
            // Calculate date filter
            const now = new Date();
            const daysAgo =
                dateRange === "24h" ? 1 : dateRange === "7days" ? 7 : dateRange === "30days" ? 30 : 7;
            const since = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();

            // Build query
            let query = supabase
                .from("error_logs")
                .select("*, companies(name)")
                .gte("created_at", since)
                .order("created_at", { ascending: false });

            if (filterVersion) {
                query = query.eq("app_version", filterVersion);
            }

            const { data, error } = await query.limit(500);
            if (error) throw error;

            setErrors(data || []);

            // Extract unique versions
            const uniqueVersions = Array.from(new Set((data || []).map((e) => e.app_version))).sort();
            setVersions(uniqueVersions);

            // Calculate summary by module
            const moduleMap = new Map<string, number>();
            (data || []).forEach((err) => {
                const module = extractModule(err.message || err.error_message || "");
                moduleMap.set(module, (moduleMap.get(module) || 0) + 1);
            });

            const summaryArray = Array.from(moduleMap.entries())
                .map(([module, count]) => ({ module, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10);

            setSummary(summaryArray);
        } catch (e: any) {
            alert("Hata logları yüklenirken hata: " + (e?.message || "Bilinmeyen hata"));
        } finally {
            setLoading(false);
        }
    }

    function extractModule(message: string): string {
        if (!message) return "Diğer";
        if (message.includes("order")) return "Siparişler";
        if (message.includes("customer")) return "Müşteriler";
        if (message.includes("measurement")) return "Ölçüler";
        if (message.includes("appointment")) return "Randevular";
        if (message.includes("invoice")) return "Faturalar";
        if (message.includes("payment")) return "Ödemeler";
        return "Diğer";
    }

    function downloadCSV() {
        const csv = [
            ["Tariih", "Firma", "Sürüm", "Hata Mesajı"].join(","),
            ...errors.map((e) =>
                [
                    format(new Date(e.created_at), "d MMM yyyy HH:mm"),
                    e.companies?.name || "Bilinmeyen",
                    e.app_version,
                    `"${(e.message || e.error_message || "").replace(/"/g, '""')}"`,
                ].join(",")
            ),
        ].join("\n");

        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `error_logs_${format(new Date(), "yyyy-MM-dd")}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    const filteredErrors = errors.filter(
        (e) =>
            (e.message || e.error_message || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
            (e.companies?.name || "").toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8 flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-red-100 dark:bg-red-900/30">
                                <AlertTriangle size={20} className="text-red-600" />
                            </div>
                            <h1 className="text-3xl font-black text-slate-900 dark:text-white">Hata Logları</h1>
                        </div>
                        <p className="text-slate-600 dark:text-slate-400">
                            Uygulamadaki tüm hataları merkezi olarak takip et
                        </p>
                    </div>
                    <button
                        onClick={downloadCSV}
                        className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-700"
                    >
                        <Download size={16} />
                        CSV İndir
                    </button>
                </div>

                {/* Summary Grid */}
                {summary.length > 0 && (
                    <div className="mb-8">
                        <h2 className="text-lg font-black text-slate-900 dark:text-white mb-4">Modüle Göre Özet</h2>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                            {summary.map((item) => (
                                <div
                                    key={item.module}
                                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"
                                >
                                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest">
                                        {item.module}
                                    </p>
                                    <p className="text-2xl font-black text-red-600 dark:text-red-400 mt-1">{item.count}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Filters */}
                <div className="mb-6 flex flex-wrap gap-3 items-center">
                    <div className="relative flex-1 min-w-64">
                        <Search size={18} className="absolute left-3 top-3 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Hata veya firma adında ara..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-10 pr-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
                        />
                    </div>

                    <select
                        value={dateRange}
                        onChange={(e) => setDateRange(e.target.value)}
                        className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-medium focus:border-blue-500 focus:outline-none"
                    >
                        <option value="24h">Son 24 Saat</option>
                        <option value="7days">Son 7 Gün</option>
                        <option value="30days">Son 30 Gün</option>
                    </select>

                    {versions.length > 0 && (
                        <select
                            value={filterVersion}
                            onChange={(e) => setFilterVersion(e.target.value)}
                            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-medium focus:border-blue-500 focus:outline-none"
                        >
                            <option value="">Tüm Sürümler</option>
                            {versions.map((v) => (
                                <option key={v} value={v}>
                                    v{v}
                                </option>
                            ))}
                        </select>
                    )}
                </div>

                {/* Error List */}
                <div className="space-y-3">
                    {loading ? (
                        <div className="text-center py-12 text-slate-500">Yükleniyor...</div>
                    ) : filteredErrors.length === 0 ? (
                        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center">
                            <p className="text-slate-600 dark:text-slate-400">Hata kaydı bulunamadı</p>
                        </div>
                    ) : (
                        filteredErrors.map((error) => (
                            <div
                                key={error.id}
                                className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/10 p-4"
                            >
                                <div className="flex items-start justify-between gap-3 mb-2">
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-red-700 dark:text-red-400 break-words">
                                            {error.message || error.error_message || "Bilinmeyen Hata"}
                                        </p>
                                    </div>
                                    <div className="text-xs text-red-600 dark:text-red-500 whitespace-nowrap">
                                        {format(new Date(error.created_at), "d MMM HH:mm", { locale: tr })}
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 text-xs text-red-600 dark:text-red-500">
                                    <span>📍 {error.companies?.name || "Bilinmeyen Firma"}</span>
                                    <span>📦 v{error.app_version}</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
