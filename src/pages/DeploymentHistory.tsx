import { useEffect, useState } from "react";
import { Calendar, Search, TrendingDown, TrendingUp, AlertCircle, CheckCircle2, Clock, Filter } from "lucide-react";
import { format, subDays } from "date-fns";
import { tr } from "date-fns/locale";
import { supabase } from "../supabaseClient";
import { cn } from "../utils/cn";

type DeploymentRecord = {
    version: string;
    deployment_date: string;
    total_companies: number;
    companies_updated: number;
    companies_failed: number;
    companies_rolled_back: number;
    error_rate_percentage: number;
    status: string;
};

type AuditLogRecord = {
    log_id: string;
    event_type: string;
    company_name: string;
    from_version: string;
    to_version: string;
    is_test: string;
    rollback_reason: string | null;
    initiated_by_name: string;
    initiated_by_ip: string;
    initiated_at: string;
    approved_by_name: string | null;
    approved_by_ip: string | null;
    approved_at: string | null;
};

type TabType = "summary" | "audit";

export default function DeploymentHistory() {
    const [activeTab, setActiveTab] = useState<TabType>("summary");
    const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
    const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filters
    const [searchVersion, setSearchVersion] = useState("");
    const [dateRange, setDateRange] = useState(30);
    const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "paused" | "rolled_back">("all");

    useEffect(() => {
        if (activeTab === "summary") {
            loadDeploymentHistory();
        } else {
            loadAuditLogs();
        }
    }, [activeTab, dateRange, statusFilter, searchVersion]);

    async function loadDeploymentHistory() {
        setLoading(true);
        setError(null);
        try {
            const { data, error: fetchError } = await supabase.rpc("get_canary_history", {
                p_limit: 100,
            });

            if (fetchError) throw fetchError;

            let filteredData = data || [];

            // Filter by date range
            const cutoffDate = subDays(new Date(), dateRange);
            filteredData = filteredData.filter(
                (d: any) => new Date(d.deployment_date) >= cutoffDate
            );

            // Filter by status
            if (statusFilter !== "all") {
                filteredData = filteredData.filter((d: any) => d.status === statusFilter);
            }

            // Filter by version search
            if (searchVersion.trim()) {
                filteredData = filteredData.filter((d: any) =>
                    d.version.toLowerCase().includes(searchVersion.toLowerCase())
                );
            }

            setDeployments(filteredData);
        } catch (e: any) {
            setError(`Deployment geçmişi yüklenirken hata: ${e?.message || "Bilinmeyen hata"}`);
        } finally {
            setLoading(false);
        }
    }

    async function loadAuditLogs() {
        setLoading(true);
        setError(null);
        try {
            const { data, error: fetchError } = await supabase.rpc("get_deployment_audit_log", {
                p_limit: 100,
                p_days_back: dateRange,
            });

            if (fetchError) throw fetchError;

            let filteredData = data || [];

            // Filter by version search
            if (searchVersion.trim()) {
                filteredData = filteredData.filter((d: any) =>
                    (d.from_version?.toLowerCase().includes(searchVersion.toLowerCase()) ||
                        d.to_version?.toLowerCase().includes(searchVersion.toLowerCase()))
                );
            }

            setAuditLogs(filteredData);
        } catch (e: any) {
            setError(`Audit log yüklenirken hata: ${e?.message || "Bilinmeyen hata"}`);
        } finally {
            setLoading(false);
        }
    }

    const getStatusColor = (status: string) => {
        switch (status?.toLowerCase()) {
            case "completed":
                return "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300";
            case "paused":
                return "bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300";
            case "rolled_back":
                return "bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300";
            default:
                return "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300";
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status?.toLowerCase()) {
            case "completed":
                return <CheckCircle2 size={16} />;
            case "paused":
                return <Clock size={16} />;
            case "rolled_back":
                return <TrendingDown size={16} />;
            default:
                return <AlertCircle size={16} />;
        }
    };

    const getErrorRateColor = (rate: number) => {
        if (rate === 0) return "text-green-600 dark:text-green-400";
        if (rate < 5) return "text-green-600 dark:text-green-400";
        if (rate < 10) return "text-amber-600 dark:text-amber-400";
        return "text-red-600 dark:text-red-400";
    };

    const getEventTypeLabel = (eventType: string) => {
        const labels: Record<string, string> = {
            deployment: "Deployment",
            rollback_requested: "Rollback İsteği",
            rollback_approved: "Rollback Onay",
            rollback_denied: "Rollback Red",
            rollback_executed: "Rollback Yapıldı",
        };
        return labels[eventType] || eventType;
    };

    const getEventTypeColor = (eventType: string) => {
        switch (eventType) {
            case "deployment":
                return "bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300";
            case "rollback_executed":
                return "bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300";
            case "rollback_approved":
                return "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300";
            case "rollback_denied":
                return "bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300";
            default:
                return "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300";
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
                <div className="text-center">
                    <Clock size={40} className="animate-spin text-blue-600 mx-auto mb-3" />
                    <p className="text-slate-600 dark:text-slate-400">Deployment geçmişi yükleniyor...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                            <TrendingUp size={20} className="text-blue-600" />
                        </div>
                        <h1 className="text-3xl font-black text-slate-900 dark:text-white">Deployment Geçmişi</h1>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">Tüm sürüm deployment'larının geçmişini görüntüle</p>
                </div>

                {/* Error Alert */}
                {error && (
                    <div className="mb-6 rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 flex gap-3">
                        <AlertCircle size={20} className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                        <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
                    </div>
                )}

                {/* Tabs */}
                <div className="mb-6 border-b border-slate-200 dark:border-slate-800">
                    <div className="flex gap-4">
                        <button
                            onClick={() => setActiveTab("summary")}
                            className={cn(
                                "pb-3 px-2 border-b-2 font-semibold text-sm transition-colors",
                                activeTab === "summary"
                                    ? "border-blue-600 text-blue-600 dark:text-blue-400"
                                    : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-300"
                            )}
                        >
                            Özet
                        </button>
                        <button
                            onClick={() => setActiveTab("audit")}
                            className={cn(
                                "pb-3 px-2 border-b-2 font-semibold text-sm transition-colors",
                                activeTab === "audit"
                                    ? "border-blue-600 text-blue-600 dark:text-blue-400"
                                    : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-300"
                            )}
                        >
                            Audit Log
                        </button>
                    </div>
                </div>

                {/* Filters */}
                <div className="mb-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                    <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
                        <div className="flex-1 min-w-0">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                <Search size={14} className="inline mr-1" />
                                Sürüm Ara
                            </label>
                            <input
                                type="text"
                                placeholder="örn: 1.2.0"
                                value={searchVersion}
                                onChange={(e) => setSearchVersion(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                <Calendar size={14} className="inline mr-1" />
                                Tarih Aralığı
                            </label>
                            <select
                                value={dateRange}
                                onChange={(e) => setDateRange(Number(e.target.value))}
                                className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                            >
                                <option value={7}>Son 7 gün</option>
                                <option value={30}>Son 30 gün</option>
                                <option value={90}>Son 90 gün</option>
                                <option value={365}>Son 1 yıl</option>
                            </select>
                        </div>

                        {activeTab === "summary" && (
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                    <Filter size={14} className="inline mr-1" />
                                    Durum
                                </label>
                                <select
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value as any)}
                                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                >
                                    <option value="all">Tümü</option>
                                    <option value="completed">Tamamlandı</option>
                                    <option value="paused">Duraklatıldı</option>
                                    <option value="rolled_back">Geri Alındı</option>
                                </select>
                            </div>
                        )}
                    </div>
                </div>

                {/* SUMMARY TAB */}
                {activeTab === "summary" && (
                    <div className="space-y-4">
                        {deployments.length === 0 ? (
                            <div className="text-center py-12 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                                <AlertCircle size={40} className="mx-auto text-slate-400 dark:text-slate-600 mb-3" />
                                <p className="text-slate-600 dark:text-slate-400">Hiç deployment kaydı bulunamadı.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                                <table className="w-full">
                                    <thead className="bg-slate-100 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                Versiyon
                                            </th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                Tarih
                                            </th>
                                            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                Güncellenen
                                            </th>
                                            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                Hata
                                            </th>
                                            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                Rollback
                                            </th>
                                            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                Hata Oranı
                                            </th>
                                            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                Durum
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                                        {deployments.map((deployment) => (
                                            <tr
                                                key={deployment.version}
                                                className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                                            >
                                                <td className="px-4 py-3">
                                                    <span className="font-semibold text-slate-900 dark:text-white">
                                                        {deployment.version}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">
                                                    {format(new Date(deployment.deployment_date), "dd MMM yyyy HH:mm", {
                                                        locale: tr,
                                                    })}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <div className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/30">
                                                        <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                                                            {deployment.companies_updated}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <div className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-red-100 dark:bg-red-900/30">
                                                        <span className="text-sm font-bold text-red-600 dark:text-red-400">
                                                            {deployment.companies_failed}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <div className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-900/30">
                                                        <span className="text-sm font-bold text-amber-600 dark:text-amber-400">
                                                            {deployment.companies_rolled_back}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className={cn("px-4 py-3 text-center font-bold", getErrorRateColor(deployment.error_rate_percentage))}>
                                                    {deployment.error_rate_percentage.toFixed(1)}%
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <div
                                                        className={cn(
                                                            "inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold",
                                                            getStatusColor(deployment.status)
                                                        )}
                                                    >
                                                        {getStatusIcon(deployment.status)}
                                                        <span>
                                                            {deployment.status === "completed"
                                                                ? "Tamamlandı"
                                                                : deployment.status === "paused"
                                                                ? "Duraklatıldı"
                                                                : deployment.status === "rolled_back"
                                                                ? "Geri Alındı"
                                                                : deployment.status}
                                                        </span>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* AUDIT LOG TAB */}
                {activeTab === "audit" && (
                    <div className="space-y-3">
                        {auditLogs.length === 0 ? (
                            <div className="text-center py-12 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                                <AlertCircle size={40} className="mx-auto text-slate-400 dark:text-slate-600 mb-3" />
                                <p className="text-slate-600 dark:text-slate-400">Hiç audit log kaydı bulunamadı.</p>
                            </div>
                        ) : (
                            auditLogs.map((log) => (
                                <div
                                    key={log.log_id}
                                    className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:shadow-md transition-shadow"
                                >
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                                        <div className={cn("px-3 py-1 rounded-full text-xs font-semibold w-fit", getEventTypeColor(log.event_type))}>
                                            {getEventTypeLabel(log.event_type)}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex flex-col sm:flex-row gap-2 text-sm">
                                                <span className="text-slate-900 dark:text-white font-semibold">{log.company_name}</span>
                                                <span className="text-slate-500 dark:text-slate-400 hidden sm:inline">•</span>
                                                <span className="text-slate-600 dark:text-slate-400">
                                                    {log.from_version} → {log.to_version}
                                                </span>
                                                <span className="text-slate-500 dark:text-slate-400 hidden sm:inline">•</span>
                                                <span className="text-slate-600 dark:text-slate-400">{log.is_test}</span>
                                            </div>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                                Yapan: {log.initiated_by_name} ({log.initiated_by_ip})
                                            </p>
                                            {log.approved_by_name && (
                                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                                    Onaylayan: {log.approved_by_name} ({log.approved_by_ip})
                                                </p>
                                            )}
                                            {log.rollback_reason && (
                                                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                                                    Neden: {log.rollback_reason}
                                                </p>
                                            )}
                                        </div>

                                        <div className="text-right flex-shrink-0">
                                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                                {format(new Date(log.initiated_at), "dd MMM yyyy HH:mm", {
                                                    locale: tr,
                                                })}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {/* Footer */}
                <div className="mt-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    <p>Son güncelleme: {format(new Date(), "dd MMM yyyy HH:mm:ss", { locale: tr })}</p>
                </div>
            </div>
        </div>
    );
}
