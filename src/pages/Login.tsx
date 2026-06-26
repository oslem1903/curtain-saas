import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2, Lock, Mail, ShieldCheck, UserPlus } from "lucide-react";

import { supabase } from "../supabaseClient";

const MOBILE_BUILD_MARKER = "Mobil fix 2026-05-11-2";

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

async function goToHome(userId: string, nav: ReturnType<typeof useNavigate>) {
    void userId;
    nav("/", { replace: true });
}

export default function Login() {
    const nav = useNavigate();
    const [email, setEmail] = useState(() => localStorage.getItem("last_login_email") || "");
    const [password, setPassword] = useState("");
    const [info, setInfo] = useState<string>("");
    const [loading, setLoading] = useState(false);
    const [checkingSession, setCheckingSession] = useState(true);
    const [rememberMe, setRememberMe] = useState(() => localStorage.getItem("remember_login") !== "false");

    useEffect(() => {
        let alive = true;

        async function restoreSession() {
            try {
                const { data } = await withTimeout(supabase.auth.getSession(), "Oturum kontrolu");
                const user = data.session?.user;

                if (!alive) return;
                if (user) {
                    await goToHome(user.id, nav);
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
    }, [nav]);

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault();
        if (loading) return;

        const cleanEmail = email.trim().toLowerCase();
        if (!cleanEmail || !password) {
            setInfo("E-posta ve şifre alanlarini doldurun.");
            return;
        }

        setLoading(true);
        setInfo("");

        let data;
        let error;
        try {
            const result = await withTimeout(
                supabase.auth.signInWithPassword({
                    email: cleanEmail,
                    password,
                }),
                "Giris",
            );
            data = result.data;
            error = result.error;
        } catch (loginError) {
            setLoading(false);
            return setInfo(loginError instanceof Error ? loginError.message : "Giriş sırasında bağlantı hatası oluştu.");
        }

        if (error) {
            setLoading(false);
            return setInfo(error.message);
        }

        localStorage.setItem("remember_login", rememberMe ? "true" : "false");
        if (rememberMe) localStorage.setItem("last_login_email", cleanEmail);
        else localStorage.removeItem("last_login_email");

        if (data.session?.user) {
            await goToHome(data.session.user.id, nav);
            return;
        }

        setLoading(false);
    }

    async function handleForgot() {
        if (loading) return;

        setInfo("");

        const cleanEmail = email.trim().toLowerCase();
        if (!cleanEmail) {
            setInfo("Şifre sıfırlamak için önce e-posta adresinizi yazin.");
            return;
        }

        setLoading(true);

        const redirectTo = `${window.location.origin}${window.location.pathname}#/reset-password`;

        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
            redirectTo,
        });

        setLoading(false);

        if (error) setInfo(error.message);
        else setInfo("Şifre sıfırlama maili gönderildi. Gelen kutusu ve spam klasorunu kontrol edin.");
    }

    if (checkingSession) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
                <div className="flex items-center gap-3 text-slate-500 dark:text-slate-300 font-semibold">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Oturum kontrol ediliyor...
                    <span className="sr-only">{MOBILE_BUILD_MARKER}</span>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xl overflow-hidden">
                <div className="px-7 pt-8 pb-5">
                    <div className="w-12 h-12 rounded-2xl bg-primary-600 text-white flex items-center justify-center shadow-lg shadow-primary-600/20 mb-5">
                        <ShieldCheck className="w-7 h-7" />
                    </div>
                    <h1 className="text-2xl font-black text-slate-900 dark:text-white">Giriş Yap</h1>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Oturumunuz bu cihazda hatırlanır; bilgisayar ve mobilde aynı anda kullanabilirsiniz.
                    </p>
                </div>

                <form onSubmit={handleLogin} className="px-7 pb-7 space-y-4">
                    <label className="block">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">E-posta</span>
                        <div className="mt-1.5 relative">
                            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                type="email"
                                autoComplete="email"
                                placeholder="ornek@mail.com"
                                className="w-full pl-11 pr-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                                disabled={loading}
                            />
                        </div>
                    </label>

                    <label className="block">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Şifre</span>
                        <div className="mt-1.5 relative">
                            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                type="password"
                                autoComplete="current-password"
                                placeholder="******"
                                className="w-full pl-11 pr-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                                disabled={loading}
                            />
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

                    <button
                        type="submit"
                        className="w-full h-12 rounded-2xl bg-primary-600 hover:bg-primary-700 text-white font-black shadow-lg shadow-primary-600/20 transition inline-flex items-center justify-center gap-2 disabled:opacity-60"
                        disabled={loading}
                    >
                        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
                        {loading ? "Giriş yapiliyor..." : "Giriş Yap"}
                    </button>

                    {info ? (
                        <div className="rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                            {info}
                        </div>
                    ) : null}
                </form>

                <div className="border-t border-slate-200 dark:border-slate-800 px-7 py-5 bg-slate-50/70 dark:bg-slate-950/40">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <div className="text-sm font-black text-slate-900 dark:text-white">Davet kodunuz mu var?</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">E-posta ve kod ile kendi şifrenizi belirleyin.</div>
                        </div>
                        <button
                            type="button"
                            onClick={() => nav("/join")}
                            className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800"
                        >
                            <UserPlus className="w-4 h-4" />
                            Kodla Katıl
                        </button>
                    </div>
                </div>
                <div className="px-7 pb-4 text-[11px] text-slate-400">{MOBILE_BUILD_MARKER}</div>
            </div>
        </div>
    );
}
