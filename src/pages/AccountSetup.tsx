import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Building2, KeyRound, Loader2, LogOut, Sparkles, User } from "lucide-react";

import { supabase } from "../supabaseClient";
import { useAuth } from "../context/AuthContext";
import AuthShell, {
    AuthMessage,
    authInputClass,
    authLabelClass,
    authPrimaryButtonClass,
    authSecondaryButtonClass,
    scrollFieldIntoView,
} from "../components/AuthShell";
import { friendlyAuthError } from "../utils/authErrors";
import { startSelfServiceTrial } from "../utils/selfServiceTrial";

/**
 * Oturumu olan ama henüz hiçbir işletmeye bağlı olmayan kullanıcı ekranı.
 * - Kodsuz kayıt olan kullanıcı e-postasını doğruladıktan sonra buraya gelir;
 *   kayıtta yazdığı işletme adıyla işletme + deneme otomatik oluşturulur.
 * - Davet edilen kullanıcı "Davet kodum var" ile mevcut işletmeye katılır
 *   (bu yol yeni işletme veya yeni deneme OLUŞTURMAZ).
 */
export default function AccountSetup() {
    const nav = useNavigate();
    const { status, user, refreshAuth } = useAuth();
    const metadata = (user?.user_metadata ?? {}) as Record<string, unknown>;
    const intent = String(metadata.signup_intent || "");
    const [companyName, setCompanyName] = useState(String(metadata.company_name || ""));
    const [fullName, setFullName] = useState(String(metadata.full_name || ""));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const autoStarted = useRef(false);

    async function createBusiness(name: string, person: string) {
        if (loading) return;
        setError("");
        if (name.trim().length < 2) {
            setError("İşletme adını girin (en az 2 karakter).");
            return;
        }
        setLoading(true);
        try {
            await startSelfServiceTrial(name, person);
            await refreshAuth();
            nav("/", { replace: true });
        } catch (e) {
            const message = e instanceof Error ? e.message : String((e as { message?: string })?.message || "");
            setError(friendlyAuthError(message || "İşletme oluşturulamadı."));
        } finally {
            setLoading(false);
        }
    }

    // Kodsuz kayıtta işletme adı zaten alındı: doğrulamadan sonra tekrar sorma.
    useEffect(() => {
        if (status !== "needs_setup" || autoStarted.current) return;
        const metaCompany = String(metadata.company_name || "").trim();
        if (intent === "self_trial" && metaCompany.length >= 2) {
            autoStarted.current = true;
            void createBusiness(metaCompany, String(metadata.full_name || ""));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, intent]);

    async function logout() {
        await supabase.auth.signOut();
        nav("/login", { replace: true });
    }

    if (status === "loading") {
        return (
            <div className="min-h-[100dvh] flex items-center justify-center bg-slate-50 dark:bg-slate-950">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
        );
    }
    if (status === "unauthenticated") return <Navigate to="/login" replace />;
    if ((status === "unauthorized" || status === "access_error")) return <Navigate to="/unauthorized" replace />;
    if (status === "locked") return <Navigate to="/locked" replace />;
    if (status === "ready") return <Navigate to="/" replace />;

    return (
        <AuthShell
            title="Hesap kurulumu"
            icon={<Building2 className="w-7 h-7" />}
            subtitle={
                <>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{user?.email}</span> hesabı henüz bir işletmeye bağlı değil.
                </>
            }
            footer={
                <button
                    type="button"
                    onClick={logout}
                    className="w-full inline-flex items-center justify-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white"
                >
                    <LogOut className="w-4 h-4" />
                    Çıkış yap
                </button>
            }
        >
            <form
                className="space-y-4"
                onSubmit={(e) => {
                    e.preventDefault();
                    void createBusiness(companyName, fullName);
                }}
                noValidate
            >
                <label className="block">
                    <span className={authLabelClass}>Ad Soyad</span>
                    <div className="mt-1.5 relative">
                        <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            onFocus={scrollFieldIntoView}
                            autoComplete="name"
                            maxLength={120}
                            className={authInputClass}
                            disabled={loading}
                        />
                    </div>
                </label>
                <label className="block">
                    <span className={authLabelClass}>İşletme adı</span>
                    <div className="mt-1.5 relative">
                        <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            value={companyName}
                            onChange={(e) => setCompanyName(e.target.value)}
                            onFocus={scrollFieldIntoView}
                            autoComplete="organization"
                            placeholder="Örn. Yıldız Perde"
                            maxLength={120}
                            className={authInputClass}
                            disabled={loading}
                        />
                    </div>
                </label>

                {error ? <AuthMessage tone="error">{error}</AuthMessage> : null}

                <button type="submit" className={authPrimaryButtonClass} disabled={loading}>
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                    {loading ? "İşletmeniz hazırlanıyor..." : "İşletmemi oluştur"}
                </button>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    İşletmeniz oluşturulunca 7 günlük ücretsiz deneme başlar. Deneme her hesap için yalnızca bir kez verilir.
                </p>
            </form>

            <div className="my-4 flex items-center gap-3 text-xs font-bold uppercase tracking-wider text-slate-400">
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                veya
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            </div>

            <button type="button" onClick={() => nav("/join")} className={authSecondaryButtonClass} disabled={loading}>
                <KeyRound className="w-5 h-5" />
                Davet kodum var
            </button>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Bir işletmede çalışıyorsanız yöneticinizin verdiği kodla o işletmeye katılın; yeni işletme açılmaz.
            </p>
        </AuthShell>
    );
}
