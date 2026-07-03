import { useState } from "react";
import { Clock, LockKeyhole, MonitorSmartphone, RefreshCw, ShieldOff } from "lucide-react";
import { supabase } from "../supabaseClient";
import { getDeviceId, useAuth } from "../context/AuthContext";

const REASON_CONTENT: Record<string, { title: string; text: string; icon: typeof LockKeyhole }> = {
    inactive_user: {
        title: "Hesabınız pasif",
        text: "Kullanıcı hesabınız pasif durumda. Firma yöneticinizle iletişime geçin.",
        icon: ShieldOff,
    },
    inactive_member: {
        title: "Üyeliğiniz pasif",
        text: "Firma içindeki kullanıcı üyeliğiniz pasife alınmış. Firma yöneticinizle iletişime geçin.",
        icon: ShieldOff,
    },
    inactive_company: {
        title: "Firma lisansı askıda",
        text: "Firmanızın lisansı pasif veya askıya alınmış durumda. Devam etmek için lisans yöneticinizle iletişime geçin.",
        icon: LockKeyhole,
    },
    expired_trial: {
        title: "Deneme süreniz doldu",
        text: "Deneme süreniz sona erdi. Verileriniz güvende — lisans satın aldığınızda kaldığınız yerden devam edersiniz.",
        icon: Clock,
    },
    read_only: {
        title: "Salt okunur mod",
        text: "Firmanız şu anda sadece okuma modunda. Yeni kayıt eklemek için lisansınızı yenileyin.",
        icon: LockKeyhole,
    },
    device_limit: {
        title: "Cihaz limiti doldu",
        text: "Lisansınızın izin verdiği cihaz sayısına ulaşıldı. Bu cihazdan kullanmak için yöneticinizden cihaz limitini artırmasını veya eski bir cihazı kaldırmasını isteyin.",
        icon: MonitorSmartphone,
    },
    unknown: {
        title: "Erişim kilitli",
        text: "Hesabınız geçici olarak kilitli. Lütfen yöneticinizle iletişime geçin.",
        icon: LockKeyhole,
    },
};

export default function Locked() {
    const { lockReason, company, refreshAuth, status, user } = useAuth();
    const [checking, setChecking] = useState(false);
    const [requesting, setRequesting] = useState(false);
    const [checkMessage, setCheckMessage] = useState("");

    const content = REASON_CONTENT[lockReason || "unknown"] ?? REASON_CONTENT.unknown;
    const Icon = content.icon;

    async function handleRetry() {
        setChecking(true);
        setCheckMessage("");
        try {
            await refreshAuth();
            // refreshAuth sonrası hâlâ bu ekrandaysak lisans hâlâ kilitli demektir
            setCheckMessage("Lisans durumu kontrol edildi. Erişim hâlâ kilitli görünüyor — değişiklik yapıldıysa birkaç dakika içinde tekrar deneyin.");
        } catch {
            setCheckMessage("Kontrol sırasında bağlantı sorunu oluştu. İnternet bağlantınızı kontrol edip tekrar deneyin.");
        } finally {
            setChecking(false);
        }
    }

    async function handleSupportRequest() {
        if (!company?.id || !user?.id) {
            setCheckMessage("Firma veya kullanici bilgisi henuz yuklenemedi. Lutfen tekrar deneyin.");
            return;
        }

        setRequesting(true);
        setCheckMessage("");

        const isDeviceLimit = lockReason === "device_limit";
        const payload = {
            company_id: company.id,
            user_id: user.id,
            title: isDeviceLimit ? "Cihaz limiti talebi" : "Lisans / destek talebi",
            description: isDeviceLimit
                ? `${company.name || "Firma"} icin yeni cihaz giris izni isteniyor. Super admin cihaz limitini artirabilir veya eski bir cihazi kaldirabilir.`
                : `${company.name || "Firma"} icin lisans/destek talebi olusturuldu. Durum: ${lockReason || "unknown"}.`,
            category: isDeviceLimit ? "payment" : "request",
            priority: isDeviceLimit ? "high" : "medium",
            status: "open",
            page_url: window.location.href,
            support_metadata: {
                kind: isDeviceLimit ? "device_limit" : "license_support",
                lock_reason: lockReason,
                requested_device_id: getDeviceId(),
                user_agent: navigator.userAgent.slice(0, 250),
                device_name: [navigator.platform, navigator.language].filter(Boolean).join(" / ").slice(0, 120),
            },
        };

        try {
            let { error } = await supabase.from("support_tickets").insert(payload);
            if (error && /support_metadata|schema cache|column/i.test(String(error.message || ""))) {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { support_metadata: _metadata, ...fallbackPayload } = payload;
                const retry = await supabase.from("support_tickets").insert(fallbackPayload);
                error = retry.error;
            }
            if (error) throw error;
            setCheckMessage("Talebiniz super admin paneline dustu. Onaylandiginda bu ekrandan Tekrar Dene ile giris yapabilirsiniz.");
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
                        {requesting ? "Talep gonderiliyor..." : "Destek / Lisans Al"}
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
