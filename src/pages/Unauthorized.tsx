import { Navigate } from "react-router-dom";
import { useState } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../context/AuthContext";

/**
 * "Yetki bulunamadı" ekranı.
 *
 * Bu ekrana yalnızca gerçekten firma üyeliği bulunamadığında değil, geçici bir
 * ağ/sunucu hatası yüzünden de düşülebiliyordu ve kullanıcının çıkış yapmaktan
 * başka seçeneği yoktu. Artık kontrolü yeniden çalıştıran bir "Tekrar dene"
 * butonu var; böylece kısa süreli bağlantı sorunları oturumu bitirmeye gerek
 * kalmadan atlatılabiliyor.
 */
export default function Unauthorized() {
    const { refreshAuth, status, accessError } = useAuth();
    const [retrying, setRetrying] = useState(false);

    async function retry() {
        if (retrying) return;
        setRetrying(true);
        try {
            await refreshAuth();
        } finally {
            setRetrying(false);
        }
    }

    async function logout() {
        await supabase.auth.signOut();
        window.location.hash = "#/login";
    }

    if (["ready", "needs_setup", "locked", "unauthenticated"].includes(status)) return <Navigate to="/" replace />;

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
            <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                    <ShieldAlert className="h-8 w-8" />
                </div>
                <h1 className="text-2xl font-black text-slate-900 dark:text-white">{status === "access_error" ? "Hesabınız kontrol edilemedi" : "Hesap erişimi tamamlanamadı"}</h1>
                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    {accessError || "Firma erişiminiz henüz tamamlanmamış. Davet kodunuzla katılabilir veya firma yöneticinizle iletişime geçebilirsiniz."}
                </p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                    <button
                        type="button"
                        onClick={retry}
                        disabled={retrying}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary-600 px-5 py-3 text-sm font-black text-white hover:bg-primary-700 disabled:opacity-60"
                    >
                        <RefreshCw className={`h-4 w-4 ${retrying ? "animate-spin" : ""}`} />
                        {retrying ? "Kontrol ediliyor..." : "Tekrar dene"}
                    </button>
                    <button
                        type="button"
                        onClick={() => { window.location.hash = "#/join"; }}
                        className="rounded-2xl border border-blue-200 bg-blue-50 px-5 py-3 text-sm font-black text-blue-700 hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40"
                    >
                        Davet Kodu Gir
                    </button>
                    <button
                        type="button"
                        onClick={logout}
                        className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                        Çıkış Yap
                    </button>
                </div>
            </div>
        </div>
    );
}
