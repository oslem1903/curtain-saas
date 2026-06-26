import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, Loader2, RefreshCw, X } from "lucide-react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../context/AuthContext";

declare global {
    interface Window {
        curtainUpdater?: {
            platform: "windows";
            installUpdate: (payload: { url: string; version: string }) => Promise<{ ok: boolean; file?: string }>;
        };
    }
}

type UpdateRow = {
    id: string;
    version: string;
    title: string | null;
    description: string | null;
    release_date: string | null;
    published_at: string | null;
    forced_update: boolean | null;
    force_update: boolean | null;
    target_type: string | null;
    target_company_ids: string[] | null;
    download_url: string | null;
    windows_download_url: string | null;
    android_download_url: string | null;
};

const CURRENT_VERSION = String(import.meta.env.VITE_APP_VERSION || "0.0.0");

function getDeviceId() {
    const key = "curtain_saas_device_id";
    let id = localStorage.getItem(key);
    if (!id) {
        id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(key, id);
    }
    return id;
}

function parseVersion(value: string) {
    return value
        .replace(/^v/i, "")
        .split(".")
        .map((part) => Number(part.replace(/\D+/g, "")) || 0);
}

function isNewerVersion(remote: string, current: string) {
    const a = parseVersion(remote);
    const b = parseVersion(current);
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        const diff = (a[i] || 0) - (b[i] || 0);
        if (diff > 0) return true;
        if (diff < 0) return false;
    }
    return false;
}

function isAndroid() {
    return /Android/i.test(navigator.userAgent);
}

function getDownloadUrl(update: UpdateRow | null) {
    if (!update) return "";
    if (isAndroid()) return update.android_download_url || update.download_url || "";
    return update.windows_download_url || update.download_url || "";
}

export default function AppUpdateNotifier() {
    const { user, companyId, role } = useAuth();
    const [update, setUpdate] = useState<UpdateRow | null>(null);
    const [dismissed, setDismissed] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [installError, setInstallError] = useState("");
    const autoStarted = useRef(false);

    const forced = Boolean(update?.forced_update || update?.force_update);
    const downloadUrl = getDownloadUrl(update);
    const canDesktopInstall = Boolean(window.curtainUpdater && downloadUrl);

    useEffect(() => {
        let alive = true;

        async function reportDevice() {
            if (!user || !companyId || role === "super_admin") return;

            await supabase
                .from("app_devices")
                .upsert({
                    id: getDeviceId(),
                    company_id: companyId,
                    user_id: user.id,
                    app_version: CURRENT_VERSION,
                    platform: isAndroid() ? "android" : window.curtainUpdater ? "windows" : "web",
                    device_name: navigator.platform || "Bilinmeyen cihaz",
                    last_seen_at: new Date().toISOString(),
                }, { onConflict: "id" });
        }

        async function loadUpdate() {
            if (!user) return;

            const { data, error } = await supabase
                .from("app_updates")
                .select("id,version,title,description,release_date,published_at,forced_update,force_update,target_type,target_company_ids,download_url,windows_download_url,android_download_url")
                .eq("status", "published")
                .order("release_date", { ascending: false })
                .limit(10);

            if (error || !alive) return;

            const candidates = ((data ?? []) as UpdateRow[]).filter((row) => {
                if (!isNewerVersion(row.version, CURRENT_VERSION)) return false;
                if (role === "super_admin") return true;
                if (row.target_type === "selected_companies") return Boolean(companyId && row.target_company_ids?.includes(companyId));
                return true;
            });

            const latest = candidates[0] ?? null;
            setUpdate(latest);

            if (latest && companyId) {
                await supabase
                    .from("app_update_reads")
                    .upsert({ update_id: latest.id, company_id: companyId, user_id: user.id }, { onConflict: "update_id,user_id" });
            }
        }

        reportDevice();
        loadUpdate();
        const timer = window.setInterval(loadUpdate, 10 * 60 * 1000);
        return () => {
            alive = false;
            window.clearInterval(timer);
        };
    }, [companyId, role, user]);

    const text = useMemo(() => {
        if (!update) return "";
        return `Yeni güncelleme mevcut: v${update.version}${update.title ? ` - ${update.title}` : ""}`;
    }, [update]);

    const installDesktopUpdate = useCallback(async () => {
        if (!update || !downloadUrl || !window.curtainUpdater) return;
        setInstalling(true);
        setInstallError("");
        try {
            await window.curtainUpdater.installUpdate({ url: downloadUrl, version: update.version });
        } catch (e: any) {
            setInstallError(e?.message || "Güncelleme indirilemedi.");
            setInstalling(false);
        }
    }, [downloadUrl, update]);

    useEffect(() => {
        if (!forced || !canDesktopInstall || autoStarted.current) return;
        autoStarted.current = true;
        window.setTimeout(() => {
            void installDesktopUpdate();
        }, 0);
    }, [canDesktopInstall, forced, installDesktopUpdate]);

    function openDownload() {
        if (!downloadUrl) {
            setInstallError("Bu sürüm için indirme linki girilmemiş.");
            return;
        }
        window.location.href = downloadUrl;
    }

    if (!update || (dismissed && !forced)) return null;

    if (forced) {
        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
                <div className="w-full max-w-lg rounded-3xl border border-red-200 bg-white p-6 text-center shadow-2xl dark:border-red-900 dark:bg-slate-900">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-700">
                        {installing ? <Loader2 className="h-8 w-8 animate-spin" /> : <AlertTriangle className="h-8 w-8" />}
                    </div>
                    <h2 className="text-xl font-black text-slate-900 dark:text-white">Zorunlu güncelleme var</h2>
                    <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{text}</p>
                    {update.description ? <p className="mt-2 text-xs text-slate-500">{update.description}</p> : null}
                    {installing ? (
                        <p className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 text-sm font-bold text-blue-800">
                            Güncelleme indiriliyor. Kurulum başlayınca uygulama kapanacaktır.
                        </p>
                    ) : null}
                    {installError ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{installError}</p> : null}
                    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                        {window.curtainUpdater ? (
                            <button
                                type="button"
                                onClick={installDesktopUpdate}
                                disabled={installing}
                                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 py-3 text-sm font-black text-white hover:bg-red-700 disabled:opacity-60"
                            >
                                {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                İndir ve Kur
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={openDownload}
                                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-red-600 px-5 py-3 text-sm font-black text-white hover:bg-red-700"
                            >
                                <Download className="h-4 w-4" />
                                Güncellemeyi İndir
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="sticky top-0 z-50 flex flex-col gap-3 border-b border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-900 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                <span>{text}</span>
            </div>
            {installError ? <span className="text-xs text-red-700">{installError}</span> : null}
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={window.curtainUpdater ? installDesktopUpdate : openDownload}
                    disabled={installing}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-black text-white disabled:opacity-60"
                >
                    {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    İndir ve Kur
                </button>
                <button type="button" onClick={() => window.location.reload()} className="rounded-xl bg-white px-3 py-1.5 text-xs font-black text-blue-900">
                    Yenile
                </button>
                <button type="button" onClick={() => setDismissed(true)} className="rounded-xl p-1.5 hover:bg-blue-100" aria-label="Kapat">
                    <X className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}
