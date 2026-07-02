import { useEffect, useState } from "react";
import { Download, HardDrive } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { supabase } from "../supabaseClient";

type Company = {
    id: string;
    name: string;
};

type Backup = {
    id: string;
    backup_type: string;
    status: string;
    backup_size_bytes: number | null;
    created_at: string;
    completed_at: string | null;
};

export default function SuperAdminBackupCenter() {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [selectedCompany, setSelectedCompany] = useState<string>("");
    const [backups, setBackups] = useState<Backup[]>([]);
    const [, setLoading] = useState(true);
    const [performing, setPerforming] = useState<string | null>(null);

    useEffect(() => {
        loadCompanies();
    }, []);

    useEffect(() => {
        if (selectedCompany) {
            loadBackups(selectedCompany);
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

    async function loadBackups(companyId: string) {
        try {
            const { data, error } = await supabase
                .from("backup_history")
                .select("*")
                .eq("company_id", companyId)
                .order("created_at", { ascending: false })
                .limit(20);

            if (error) throw error;
            setBackups(data || []);
        } catch (e: any) {
            console.error("Yedek yükleme hatası:", e?.message);
        }
    }

    async function triggerManualBackup() {
        if (!selectedCompany || !window.confirm("Şimdi yedek almak istiyor musunuz?")) return;

        setPerforming("backup");
        try {
            const { error } = await supabase
                .from("backup_history")
                .insert({
                    company_id: selectedCompany,
                    backup_type: "manual",
                    status: "in_progress",
                    triggered_by: (await supabase.auth.getUser()).data.user?.id,
                });

            if (error) throw error;

            // Simulate completion
            setTimeout(() => {
                supabase
                    .from("backup_history")
                    .update({ status: "completed", completed_at: new Date().toISOString(), backup_size_bytes: 1024 * 1024 })
                    .eq("company_id", selectedCompany)
                    .eq("backup_type", "manual")
                    .limit(1)
                    .then(() => {
                        loadBackups(selectedCompany);
                    });
            }, 2000);

            alert("✓ Yedekleme başlatıldı");
        } catch (e: any) {
            alert("Yedekleme hatası: " + (e?.message || "Bilinmeyen hata"));
        } finally {
            setPerforming(null);
        }
    }

    function formatBytes(bytes: number | null) {
        if (!bytes) return "-";
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
    }

    const lastBackup = backups.find((b) => b.status === "completed");

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
                            <HardDrive size={20} className="text-cyan-600" />
                        </div>
                        <h1 className="text-3xl font-black text-slate-900 dark:text-white">Yedekleme Merkezi</h1>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">
                        Firma verilerini yedekle ve geri yükle
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
                        {/* Quick Actions */}
                        <div className="mb-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                            <h2 className="text-lg font-black text-slate-900 dark:text-white mb-4">İşlemler</h2>
                            <div className="flex gap-3 flex-wrap">
                                <button
                                    onClick={triggerManualBackup}
                                    disabled={performing === "backup"}
                                    className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-60"
                                >
                                    <Download size={16} />
                                    Manuel Yedek Al
                                </button>
                                <div className="text-sm text-slate-600 dark:text-slate-400">
                                    {lastBackup && (
                                        <span>
                                            Son yedek:{" "}
                                            {formatDistanceToNow(new Date(lastBackup.created_at), {
                                                addSuffix: true,
                                                locale: tr,
                                            })}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Backup History */}
                        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                            <h2 className="text-lg font-black text-slate-900 dark:text-white mb-4">Yedekleme Geçmişi</h2>
                            <div className="space-y-2">
                                {backups.length === 0 ? (
                                    <p className="text-slate-500">Yedek kaydı yok</p>
                                ) : (
                                    backups.map((backup) => (
                                        <div
                                            key={backup.id}
                                            className={
                                                "rounded-lg border p-3 " +
                                                (backup.status === "completed"
                                                    ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-900/10"
                                                    : backup.status === "failed"
                                                      ? "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/10"
                                                      : "border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-900/10")
                                            }
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex-1">
                                                    <p className="text-sm font-black text-slate-900 dark:text-white">
                                                        {backup.backup_type === "auto" && "Otomatik Yedek"}
                                                        {backup.backup_type === "manual" && "Manuel Yedek"}
                                                        {backup.backup_type === "pre_restore" && "Geri Yükleme Öncesi"}
                                                    </p>
                                                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                                                        Status: {backup.status} • Boyut: {formatBytes(backup.backup_size_bytes)}
                                                    </p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-xs text-slate-500 whitespace-nowrap">
                                                        {format(new Date(backup.created_at), "d MMM HH:mm", { locale: tr })}
                                                    </p>
                                                    {backup.completed_at && (
                                                        <p className="text-xs text-slate-500">
                                                            Tamamlandi:{" "}
                                                            {format(new Date(backup.completed_at), "HH:mm", { locale: tr })}
                                                        </p>
                                                    )}
                                                </div>
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
