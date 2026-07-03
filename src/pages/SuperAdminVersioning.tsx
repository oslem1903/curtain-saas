import { useEffect, useState } from "react";
import { Plus, Package, AlertCircle, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { supabase } from "../supabaseClient";
import { cn } from "../utils/cn";

type VersionRelease = {
    id: string;
    version: string;
    title: string;
    description: string;
    release_type: string;
    status: "draft" | "testing" | "staging" | "live" | "archived" | "rolled_back";
    is_mandatory_update: boolean;
    created_at: string;
    published_at: string | null;
    created_by: string;
};

export default function SuperAdminVersioning() {
    const [releases, setReleases] = useState<VersionRelease[]>([]);
    const [loading, setLoading] = useState(true);
    const [newVersion, setNewVersion] = useState("");
    const [newTitle, setNewTitle] = useState("");
    const [newDescription, setNewDescription] = useState("");
    const [creatingNew, setCreatingNew] = useState(false);
    const [selectedStatus, setSelectedStatus] = useState("live");

    useEffect(() => {
        loadReleases();
    }, [selectedStatus]);

    async function loadReleases() {
        setLoading(true);
        try {
            let query = supabase.from("version_releases").select("*").order("created_at", { ascending: false });

            if (selectedStatus !== "all") {
                query = query.eq("status", selectedStatus);
            }

            const { data, error } = await query.limit(50);
            if (error) throw error;
            setReleases(data || []);
        } catch (e: any) {
            alert("Sürümler yüklenirken hata: " + (e?.message || "Bilinmeyen hata"));
        } finally {
            setLoading(false);
        }
    }

    async function createNewRelease() {
        if (!newVersion || !newTitle) {
            alert("Sürüm ve başlık gerekli");
            return;
        }

        setCreatingNew(true);
        try {
            const { error } = await supabase.rpc("create_version_release", {
                p_version: newVersion,
                p_title: newTitle,
                p_description: newDescription,
                p_release_type: "general",
                p_download_urls: {},
            });

            if (error) throw error;

            alert("✓ Yeni sürüm oluşturuldu");
            setNewVersion("");
            setNewTitle("");
            setNewDescription("");
            await loadReleases();
        } catch (e: any) {
            alert("Sürüm oluşturma hatası: " + (e?.message || "Bilinmeyen hata"));
        } finally {
            setCreatingNew(false);
        }
    }

    async function publishRelease(releaseId: string) {
        if (!window.confirm("Bu sürümü yayınlamak istiyor musunuz?")) return;

        try {
            const { error } = await supabase.rpc("publish_version_release", {
                p_release_id: releaseId,
                p_target_companies: null,
                p_is_mandatory: false,
            });

            if (error) throw error;
            alert("✓ Sürüm yayınlandı");
            await loadReleases();
        } catch (e: any) {
            alert("Yayınlama hatası: " + (e?.message || "Bilinmeyen hata"));
        }
    }

    async function rollbackRelease(releaseId: string) {
        const reason = prompt("Geri alma nedeni:");
        if (!reason) return;

        try {
            const { error } = await supabase.rpc("rollback_version_release", {
                p_release_id: releaseId,
                p_reason: reason,
            });

            if (error) throw error;
            alert("✓ Sürüm geri alındı");
            await loadReleases();
        } catch (e: any) {
            alert("Geri alma hatası: " + (e?.message || "Bilinmeyen hata"));
        }
    }

    const statusColors = {
        draft: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300",
        testing: "bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300",
        staging: "bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300",
        live: "bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300",
        archived: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400",
        rolled_back: "bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300",
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                            <Package size={20} className="text-blue-600" />
                        </div>
                        <h1 className="text-3xl font-black text-slate-900 dark:text-white">Sürüm Yönetimi</h1>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">
                        Uygulama sürümlerini yönet ve yayınla
                    </p>
                </div>

                {/* Create New Release */}
                <div className="mb-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                    <h2 className="text-lg font-black text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                        <Plus size={20} />
                        Yeni Sürüm Oluştur
                    </h2>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <input
                            type="text"
                            placeholder="Sürüm (1.2.3)"
                            value={newVersion}
                            onChange={(e) => setNewVersion(e.target.value)}
                            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
                        />
                        <input
                            type="text"
                            placeholder="Başlık"
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
                        />
                        <textarea
                            placeholder="Açıklama"
                            value={newDescription}
                            onChange={(e) => setNewDescription(e.target.value)}
                            rows={2}
                            className="col-span-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
                        />
                    </div>
                    <button
                        onClick={createNewRelease}
                        disabled={creatingNew}
                        className="mt-4 rounded-lg bg-blue-600 px-6 py-2 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                        Sürüm Oluştur (Taslak)
                    </button>
                </div>

                {/* Filter Tabs */}
                <div className="mb-6 flex gap-2 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
                    {["all", "draft", "testing", "live", "archived"].map((status) => (
                        <button
                            key={status}
                            onClick={() => setSelectedStatus(status)}
                            className={cn(
                                "px-4 py-2 text-sm font-black whitespace-nowrap border-b-2 transition",
                                selectedStatus === status
                                    ? "border-blue-600 text-blue-600 dark:text-blue-400"
                                    : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900"
                            )}
                        >
                            {status === "all"
                                ? "Tümü"
                                : status === "draft"
                                  ? "Taslak"
                                  : status === "testing"
                                    ? "Test"
                                    : status === "live"
                                      ? "Canlı"
                                      : "Arşivlendi"}
                        </button>
                    ))}
                </div>

                {/* Releases List */}
                <div className="space-y-4">
                    {loading ? (
                        <div className="text-center py-12 text-slate-500">Yükleniyor...</div>
                    ) : releases.length === 0 ? (
                        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center">
                            <p className="text-slate-600 dark:text-slate-400">Sürüm bulunamadı</p>
                        </div>
                    ) : (
                        releases.map((release) => (
                            <div
                                key={release.id}
                                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6"
                            >
                                <div className="flex items-start justify-between gap-4 mb-3">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <h3 className="text-lg font-black text-slate-900 dark:text-white">
                                                v{release.version}
                                            </h3>
                                            <span
                                                className={cn(
                                                    "rounded-full px-2 py-0.5 text-xs font-black uppercase",
                                                    statusColors[release.status]
                                                )}
                                            >
                                                {release.status === "draft"
                                                    ? "Taslak"
                                                    : release.status === "testing"
                                                      ? "Test"
                                                      : release.status === "live"
                                                        ? "Canlı"
                                                        : release.status}
                                            </span>
                                            {release.is_mandatory_update && (
                                                <span className="text-xs font-black text-red-600 dark:text-red-400">
                                                    [ZORUNLU]
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-sm text-slate-700 dark:text-slate-300 font-medium mb-1">
                                            {release.title}
                                        </p>
                                        {release.description && (
                                            <p className="text-xs text-slate-600 dark:text-slate-400">
                                                {release.description}
                                            </p>
                                        )}
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-slate-500">
                                            {format(new Date(release.created_at), "d MMM yyyy", { locale: tr })}
                                        </p>
                                        {release.published_at && (
                                            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                                Yayınlandı
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* Actions */}
                                {release.status === "draft" && (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => publishRelease(release.id)}
                                            className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-700"
                                        >
                                            <CheckCircle2 size={14} />
                                            Yayınla
                                        </button>
                                    </div>
                                )}
                                {release.status === "testing" && (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => publishRelease(release.id)}
                                            className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-700"
                                        >
                                            <CheckCircle2 size={14} />
                                            Canlıya Taşı
                                        </button>
                                    </div>
                                )}
                                {release.status === "live" && (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => rollbackRelease(release.id)}
                                            className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-black text-white hover:bg-red-700"
                                        >
                                            <AlertCircle size={14} />
                                            Geri Al
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
