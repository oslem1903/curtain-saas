import { useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Zap } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { supabase } from "../supabaseClient";
import { cn } from "../utils/cn";

type Company = {
    id: string;
    name: string;
};

type HealthCheck = {
    id: string;
    company_id: string;
    check_timestamp: string;
    total_customers: number;
    total_measurements: number;
    total_orders: number;
    total_suppliers: number;
    total_appointments: number;
    total_invoices: number;
    total_payments: number;
    orphan_records_count: number;
    missing_relations_count: number;
    data_inconsistencies: any;
    status: "healthy" | "warning" | "critical";
    notes: string | null;
};

export default function SuperAdminDatabaseHealth() {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [selectedCompany, setSelectedCompany] = useState<string>("");
    const [healthChecks, setHealthChecks] = useState<HealthCheck[]>([]);
    const [, setLoading] = useState(true);
    const [checking, setChecking] = useState<string | null>(null);

    useEffect(() => {
        loadCompanies();
    }, []);

    useEffect(() => {
        if (selectedCompany) {
            loadHealthChecks(selectedCompany);
        }
    }, [selectedCompany]);

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
            }
        } catch (e: any) {
            alert("Firmalar yüklenirken hata: " + (e?.message || "Bilinmeyen hata"));
        } finally {
            setLoading(false);
        }
    }

    async function loadHealthChecks(companyId: string) {
        try {
            const { data, error } = await supabase
                .from("database_health_checks")
                .select("*")
                .eq("company_id", companyId)
                .order("check_timestamp", { ascending: false })
                .limit(10);

            if (error) throw error;
            setHealthChecks(data || []);
        } catch (e: any) {
            console.error("Sağlık kontrol yükleme hatası:", e?.message);
        }
    }

    async function triggerHealthCheck() {
        if (!selectedCompany) return;

        setChecking(selectedCompany);
        try {
            const { error } = await supabase.rpc("trigger_company_database_health_check", {
                p_company_id: selectedCompany,
            });

            if (error) throw error;

            alert("✓ Sağlık kontrolü başlatıldı");
            await loadHealthChecks(selectedCompany);
        } catch (e: any) {
            alert("Kontrol hatası: " + (e?.message || "Bilinmeyen hata"));
        } finally {
            setChecking(null);
        }
    }

    const latestHealth = healthChecks[0];
    const statusColor =
        latestHealth?.status === "healthy"
            ? "bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
            : latestHealth?.status === "warning"
              ? "bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
              : "bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300";

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-green-100 dark:bg-green-900/30">
                            <Activity size={20} className="text-green-600" />
                        </div>
                        <h1 className="text-3xl font-black text-slate-900 dark:text-white">Veritabanı Sağlığı</h1>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">
                        Firma veritabanlarının sağlığını ve bütünlüğünü kontrol et
                    </p>
                </div>

                {/* Company Selector */}
                <div className="mb-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                    <h2 className="text-sm font-black text-slate-600 dark:text-slate-400 uppercase mb-3">Firma Seçin</h2>
                    <select
                        value={selectedCompany}
                        onChange={(e) => setSelectedCompany(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-medium focus:border-blue-500 focus:outline-none"
                    >
                        {companies.map((company) => (
                            <option key={company.id} value={company.id}>
                                {company.name}
                            </option>
                        ))}
                    </select>
                </div>

                {selectedCompany && (
                    <>
                        {/* Latest Status */}
                        {latestHealth && (
                            <div className={cn("mb-6 rounded-2xl border p-6", statusColor)}>
                                <div className="flex items-center gap-3 mb-3">
                                    {latestHealth.status === "healthy" && <CheckCircle2 size={24} />}
                                    {latestHealth.status === "warning" && <AlertTriangle size={24} />}
                                    {latestHealth.status === "critical" && <AlertTriangle size={24} />}
                                    <div>
                                        <h3 className="font-black text-lg">
                                            {latestHealth.status === "healthy"
                                                ? "Sağlıklı"
                                                : latestHealth.status === "warning"
                                                  ? "Uyarı"
                                                  : "Kritik"}
                                        </h3>
                                        <p className="text-sm opacity-75">
                                            Son kontrol:{" "}
                                            {formatDistanceToNow(new Date(latestHealth.check_timestamp), {
                                                addSuffix: true,
                                                locale: tr,
                                            })}
                                        </p>
                                    </div>
                                </div>
                                {latestHealth.notes && (
                                    <p className="text-sm">{latestHealth.notes}</p>
                                )}
                            </div>
                        )}

                        {/* Action Button */}
                        <div className="mb-6">
                            <button
                                onClick={triggerHealthCheck}
                                disabled={checking === selectedCompany}
                                className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-60"
                            >
                                <Zap size={16} />
                                Sağlık Kontrolü Çalıştır
                            </button>
                        </div>

                        {/* Stats Grid */}
                        {latestHealth && (
                            <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                <StatCard label="Müşteri" value={latestHealth.total_customers} />
                                <StatCard label="Ölçü" value={latestHealth.total_measurements} />
                                <StatCard label="Sipariş" value={latestHealth.total_orders} />
                                <StatCard label="Tedarikçi" value={latestHealth.total_suppliers} />
                                <StatCard label="Randevu" value={latestHealth.total_appointments} />
                                <StatCard label="Fatura" value={latestHealth.total_invoices} />
                                <StatCard label="Ödeme" value={latestHealth.total_payments} />
                            </div>
                        )}

                        {/* Issues */}
                        {latestHealth && (latestHealth.orphan_records_count > 0 || latestHealth.missing_relations_count > 0) && (
                            <div className="mb-6 rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/10 p-6">
                                <h3 className="font-black text-red-700 dark:text-red-400 mb-3">Sorunlar Bulundu</h3>
                                <div className="space-y-2 text-sm text-red-600 dark:text-red-400">
                                    {latestHealth.orphan_records_count > 0 && (
                                        <p>⚠️ Yetim Kayıt: {latestHealth.orphan_records_count}</p>
                                    )}
                                    {latestHealth.missing_relations_count > 0 && (
                                        <p>⚠️ Eksik İlişkiler: {latestHealth.missing_relations_count}</p>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* History */}
                        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                            <h2 className="text-lg font-black text-slate-900 dark:text-white mb-4">Kontrol Geçmişi</h2>
                            <div className="space-y-2">
                                {healthChecks.length === 0 ? (
                                    <p className="text-slate-500">Kontrol kaydı yok</p>
                                ) : (
                                    healthChecks.map((check) => (
                                        <div
                                            key={check.id}
                                            className={
                                                "rounded-lg border p-3 " +
                                                (check.status === "healthy"
                                                    ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-900/10"
                                                    : check.status === "warning"
                                                      ? "border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-900/10"
                                                      : "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/10")
                                            }
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <div>
                                                    <p className="font-medium text-slate-900 dark:text-white text-sm">
                                                        {check.status === "healthy"
                                                            ? "✓ Sağlıklı"
                                                            : check.status === "warning"
                                                              ? "⚠️ Uyarı"
                                                              : "❌ Kritik"}
                                                    </p>
                                                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                                                        Kayıtlar: {check.total_customers + check.total_orders + check.total_measurements}
                                                        {(check.orphan_records_count || check.missing_relations_count) && (
                                                            <span className="text-red-600 dark:text-red-400">
                                                                {" "}
                                                                • Sorun: {check.orphan_records_count + check.missing_relations_count}
                                                            </span>
                                                        )}
                                                    </p>
                                                </div>
                                                <span className="text-xs text-slate-500 whitespace-nowrap">
                                                    {format(new Date(check.check_timestamp), "d MMM HH:mm", {
                                                        locale: tr,
                                                    })}
                                                </span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function StatCard({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
            <p className="text-xs font-black text-slate-600 dark:text-slate-400 uppercase mb-1">{label}</p>
            <p className="text-2xl font-black text-slate-900 dark:text-white">{value}</p>
        </div>
    );
}
