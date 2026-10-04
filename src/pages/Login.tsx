import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, Lock, Mail, Sparkles } from "lucide-react";

import { supabase } from "../supabaseClient";
import AuthShell, {
    AuthMessage,
    authInputClass,
    authLabelClass,
    authPrimaryButtonClass,
    authSecondaryButtonClass,
    scrollFieldIntoView,
} from "../components/AuthShell";
import { getAuthRedirectUrl } from "../utils/authRedirect";
import { friendlyAuthError } from "../utils/authErrors";
import { PASSWORD_UPDATED_EMAIL, PASSWORD_UPDATED_FLAG } from "./ResetPassword";

const PASSWORD_UPDATED_TEXT = "Şifreniz güncellendi. Yeni şifrenizle giriş yapabilirsiniz.";

/** Şifre sıfırlamadan gelindiyse bayrağı okuyup hemen temizler (tek seferlik mesaj). */
function consumePasswordUpdated(state: unknown): { updated: boolean; email: string | null } {
    const navState = (state && typeof state === "object" ? state : {}) as { passwordUpdated?: boolean; email?: string | null };
    let flag = false;
    let storedEmail: string | null = null;
    try {
        flag = sessionStorage.getItem(PASSWORD_UPDATED_FLAG) === "1";
        storedEmail = sessionStorage.getItem(PASSWORD_UPDATED_EMAIL);
        sessionStorage.removeItem(PASSWORD_UPDATED_FLAG);
        sessionStorage.removeItem(PASSWORD_UPDATED_EMAIL);
    } catch {
        // depolama kapalı olabilir
    }
    const updated = navState.passwordUpdated === true || flag;
    const email = (navState.email || storedEmail || "").trim().toLowerCase() || null;
    return { updated, email };
}

function withTimeout<T>(promise: PromiseLike<T>, label: string, ms = 6000): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error(`${label} zaman asimina ugradi.`)), ms);
        promise.then(
            (value) => {
                window.clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                window.clearTimeout(timer);
                reject(error);
            },
        );
    });
}

export default function Login() {
    const nav = useNavigate();
    const location = useLocation();
    const [passwordUpdated] = useState(() => consumePasswordUpdated(location.state));
    const [email, setEmail] = useState(() => passwordUpdated.email || localStorage.getItem("last_login_email") || "");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [info, setInfo] = useState<{ tone: "info" | "error" | "success"; text: string } | null>(() =>
        passwordUpdated.updated ? { tone: "success", text: PASSWORD_UPDATED_TEXT } : null,
    );
    const [loading, setLoading] = useState(false);
    const [checkingSession, setCheckingSession] = useState(true);
    const [rememberMe, setRememberMe] = useState(() => localStorage.getItem("remember_login") !== "false");

    useEffect(() => {
        // Mesaj bir kez gösterildi: yönlendirme durumunu geçmişten sil (yenilemede tekrar çıkmasın).
        if ((location.state as { passwordUpdated?: boolean } | null)?.passwordUpdated) {
            nav(location.pathname, { replace: true, state: null });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        let alive = true;

        async function restoreSession() {
            if (passwordUpdated.updated) {
                // Şifre yeni güncellendi: kalmış olabilecek kurtarma oturumuyla asla otomatik giriş yapma.
                await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
                if (alive) setCheckingSession(false);
                return;
            }
            try {
                const { data } = await withTimeout(supabase.auth.getSession(), "Oturum kontrolu");
                if (!alive) return;
                if (data.session?.user) {
                    nav("/", { replace: true });
                    return;
                }
            } catch (error) {
                console.warn("Session restore failed:", error);
            }

            if (alive) setCheckingSession(false);
        }

        restoreSession();

        return () => {
            alive = false;
        };
    }, [nav, passwordUpdated.updated]);

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault();
        if (loading) return;

        const cleanEmail = email.trim().toLowerCase();
        if (!cleanEmail || !password) {
            setInfo({ tone: "error", text: "E-posta ve şifre alanlarını doldurun." });
            return;
        }

        setLoading(true);
        setInfo(null);

        try {
            const { data, error } = await withTimeout(
                supabase.auth.signInWithPassword({ email: cleanEmail, password }),
                "Giriş",
                15000,
            );
            if (error) throw error;

            localStorage.setItem("remember_login", rememberMe ? "true" : "false");
            if (rememberMe) localStorage.setItem("last_login_email", cleanEmail);
            else localStorage.removeItem("last_login_email");

            if (data.session?.user) {
                nav("/", { replace: true });
                return;
            }
        } catch (loginError) {
            const message = loginError instanceof Error ? loginError.message : String((loginError as { message?: string })?.message || "");
            setInfo({ tone: "error", text: friendlyAuthError(message || "Giriş sırasında bağlantı hatası oluştu.") });
        }
        setLoading(false);
    }

    async function handleForgot() {
        if (loading) return;
        setInfo(null);

        const cleanEmail = email.trim().toLowerCase();
        if (!cleanEmail) {
            setInfo({ tone: "error", text: "Şifre sıfırlamak için önce e-posta adresinizi yazın." });
            return;
        }

        setLoading(true);
        try {
            const redirectTo = getAuthRedirectUrl("/reset-password");
            const { error } = await withTimeout(
                supabase.auth.resetPasswordForEmail(cleanEmail, redirectTo ? { redirectTo } : undefined),
                "Şifre sıfırlama",
                15000,
            );
            if (error) throw error;
            setInfo({
                tone: "success",
                text: "Bu e-posta ile kayıtlı bir hesap varsa şifre sıfırlama bağlantısı gönderildi. Gelen kutusu ve spam klasörünü kontrol edin.",
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String((error as { message?: string })?.message || "");
            setInfo({ tone: "error", text: friendlyAuthError(message || "Şifre sıfırlama isteği tamamlanamadı.") });
        } finally {
            setLoading(false);
        }
    }

    if (checkingSession) {
        return (
            <div className="min-h-[100dvh] bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
                <div className="flex items-center gap-3 text-slate-500 dark:text-slate-300 font-semibold">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Oturum kontrol ediliyor...
                </div>
            </div>
        );
    }

    return (
        <AuthShell
            title="PerdePRO"
            subtitle="Hesabınıza giriş yapın ya da kendi işletmeniz için 7 günlük ücretsiz denemeyi hemen başlatın."
            footer={
                <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-sm">
                    <KeyRound className="w-4 h-4 text-slate-400" />
                    <span className="text-slate-500 dark:text-slate-400">Davet mi aldınız?</span>
                    <button
                        type="button"
                        onClick={() => nav("/join")}
                        className="font-bold text-primary-700 dark:text-primary-300 hover:underline"
                        disabled={loading}
                    >
                        Davet kodum var
                    </button>
                </div>
            }
        >
            <form onSubmit={handleLogin} className="space-y-4" noValidate>
                <label className="block">
                    <span className={authLabelClass}>E-posta</span>
                    <div className="mt-1.5 relative">
                        <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            onFocus={scrollFieldIntoView}
                            type="email"
                            inputMode="email"
                            autoComplete="email"
                            autoCapitalize="none"
                            spellCheck={false}
                            placeholder="ornek@mail.com"
                            className={authInputClass}
                            disabled={loading}
                        />
                    </div>
                </label>

                <label className="block">
                    <span className={authLabelClass}>Şifre</span>
                    <div className="mt-1.5 relative">
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onFocus={scrollFieldIntoView}
                            type={showPassword ? "text" : "password"}
                            autoComplete="current-password"
                            placeholder="••••••"
                            className={`${authInputClass} pr-12`}
                            disabled={loading}
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                            aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
                        >
                            {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                    </div>
                </label>

                <div className="flex items-center justify-between gap-3 text-sm">
                    <label className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-300 font-semibold cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={rememberMe}
                            onChange={(e) => setRememberMe(e.target.checked)}
                            disabled={loading}
                            className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                        />
                        Beni hatırla
                    </label>
                    <button
                        type="button"
                        onClick={handleForgot}
                        className="font-bold text-primary-700 dark:text-primary-300 hover:underline"
                        disabled={loading}
                    >
                        Şifremi unuttum
                    </button>
                </div>

                {info ? <AuthMessage tone={info.tone}>{info.text}</AuthMessage> : null}

                <button type="submit" className={authPrimaryButtonClass} disabled={loading}>
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
                    {loading ? "Lütfen bekleyin..." : "Giriş Yap"}
                </button>
            </form>

            <div className="my-4 flex items-center gap-3 text-xs font-bold uppercase tracking-wider text-slate-400">
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                Hesabınız yok mu?
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            </div>

            <button type="button" onClick={() => nav("/signup")} className={authSecondaryButtonClass} disabled={loading}>
                <Sparkles className="w-5 h-5" />
                7 Gün Ücretsiz Dene
            </button>
            <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400">
                Kredi kartı gerekmez. Kod beklemeden kendi hesabınızı açın.
            </p>
        </AuthShell>
    );
}
