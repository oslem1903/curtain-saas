import { isNativeApp } from "../utils/nativeRuntime";
import { buildSupportTicket, getLockedContent, retryCheckMessage, supportButtonLabel, supportSuccessMessage } from "../utils/lockedContent";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Clock, LockKeyhole, MonitorSmartphone, RefreshCw, ShieldOff } from "lucide-react";
import { supabase } from "../supabaseClient";
import { getDeviceId, useAuth } from "../context/AuthContext";

/** Metinler utils/lockedContent.ts'te (native'de satın alma dili yok); burada yalnızca simgeler. */
const REASON_ICON: Record<string, typeof LockKeyhole> = {
    inactive_user: ShieldOff,
    inactive_member: ShieldOff,
    inactive_company: LockKeyhole,
    expired_trial: Clock,
    read_only: LockKeyhole,
    device_limit: MonitorSmartphone,
    unknown: LockKeyhole,
};

export default function Locked() {
    const { lockReason, company, refreshAuth, status } = useAuth();
    const [checking, setChecking] = useState(false);
    const [requesting, setRequesting] = useState(false);
    const [checkMessage, setCheckMessage] = useState("");

    const native = isNativeApp();
    const content = getLockedContent(lockReason, native);
    const Icon = REASON_ICON[lockReason || "unknown"] ?? LockKeyhole;

    async function handleRetry() {
        setChecking(true);
        setCheckMessage("");
        try {
            await refreshAuth();
            // refreshAuth sonrası hâlâ bu ekrandaysak lisans hâlâ kilitli demektir
            setCheckMessage(retryCheckMessage(native));
        } catch {
            setCheckMessage("Kontrol sırasında bağlantı sorunu oluştu. İnternet bağlantınızı kontrol edip tekrar deneyin.");
        } finally {
            setChecking(false);
        }
    }

    async function handleSupportRequest() {
        if (!company?.id) {
            setCheckMessage("Firma bilgisi henuz yuklenemedi. Lutfen tekrar deneyin.");
            return;
        }

        setRequesting(true);
        setCheckMessage("");

        const payload = buildSupportTicket({
            companyId: company.id,
            companyName: company.name,
            lockReason,
            deviceId: getDeviceId(),
            pageUrl: window.location.href,
            userAgent: navigator.userAgent,
            deviceName: [navigator.platform, navigator.language].filter(Boolean).join(" / "),
        }, native);

        try {
            const { data, error } = await supabase.rpc("create_support_ticket_as_locked_user", payload);
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            setCheckMessage(supportSuccessMessage(native));
        } catch (e: any) {
            setCheckMessage(e?.message || "Talep olusturulamadi. Lutfen internet baglantinizi kontrol edip tekrar deneyin.");
        } finally {
            setRequesting(false);
        }
    }

    async function logout() {
        await supabase.auth.signOut();
        // Navigate to login - auth state change will trigger re-render
        window.location.hash = "#/login";
    }

    // refreshAuth kilidi açtıysa kullanıcıyı içeri al
    if (status === "ready") {
        window.location.hash = "#/dashboard";
        return null;
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
            <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    <Icon className="h-8 w-8" />
                </div>
                <h1 className="text-2xl font-black text-slate-900 dark:text-white">{content.title}</h1>
                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    {content.text}
                </p>
                {company?.name && (
                    <p className="mt-2 text-xs font-bold text-slate-400">Firma: {company.name}</p>
                )}

                {checkMessage && (
                    <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                        {checkMessage}
                    </p>
                )}

                <Link to="/account/delete" className="mt-4 inline-block text-sm font-bold text-red-700 underline dark:text-red-300">Hesabımı sil</Link>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                    <button
                        type="button"
                        onClick={handleRetry}
                        disabled={checking}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary-600 px-5 py-3 text-sm font-black text-white hover:bg-primary-700 disabled:opacity-60"
                    >
                        <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
                        {checking ? "Kontrol ediliyor..." : "Tekrar Dene"}
                    </button>
                    <button
                        type="button"
                        onClick={handleSupportRequest}
                        disabled={requesting}
                        className="inline-flex items-center justify-center rounded-2xl border border-emerald-300 bg-emerald-50 px-5 py-3 text-sm font-black text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                    >
                        {supportButtonLabel(native, requesting)}
                    </button>
                    <button
                        type="button"
                        onClick={logout}
                        className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white hover:bg-slate-800"
                    >
                        Çıkış Yap
                    </button>
                </div>
            </div>
        </div>
    );
}
