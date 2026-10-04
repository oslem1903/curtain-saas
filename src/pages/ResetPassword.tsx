import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Lock } from "lucide-react";
import { supabase } from "../supabaseClient";
import AuthShell, { AuthMessage, authInputClass, authLabelClass, authPrimaryButtonClass, scrollFieldIntoView } from "../components/AuthShell";
import { friendlyAuthError } from "../utils/authErrors";

const MIN_PASSWORD_LENGTH = 8;
/** Giriş ekranının "şifreniz güncellendi" mesajını göstermesi için (bkz. Login.tsx). */
export const PASSWORD_UPDATED_FLAG = "perdepro_password_updated";
export const PASSWORD_UPDATED_EMAIL = "perdepro_password_updated_email";
const REDIRECT_DELAY_MS = 1800;

function getRecoveryParams() {
    const hash = window.location.hash || "";
    const query = window.location.search || "";
    const paramText = [
        query.startsWith("?") ? query.slice(1) : query,
        ...hash.split("#").slice(1),
        hash.includes("?") ? hash.split("?").slice(1).join("?") : "",
    ]
        .filter(Boolean)
        .join("&");

    return new URLSearchParams(paramText);
}

function resetErrorMessage(error: unknown): string {
    const raw = error instanceof Error ? error.message : String((error as { message?: string })?.message || "");
    const lower = raw.toLocaleLowerCase("tr-TR");
    if (lower.includes("different from the old password") || lower.includes("same_password")) {
        return "Yeni şifre eski şifrenizle aynı olamaz.";
    }
    if (lower.includes("auth session missing") || lower.includes("session_not_found") || lower.includes("jwt expired") || lower.includes("invalid refresh token")) {
        return "Şifre sıfırlama oturumunun süresi dolmuş. Giriş ekranından yeni bir sıfırlama bağlantısı isteyin.";
    }
    return friendlyAuthError(raw || "Şifre güncellenemedi.");
}

export default function ResetPassword() {
    const nav = useNavigate();
    const [password, setPassword] = useState("");
    const [password2, setPassword2] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [phase, setPhase] = useState<"checking" | "ready" | "invalid" | "saving" | "done">("checking");
    const [message, setMessage] = useState<{ tone: "info" | "error" | "success"; text: string } | null>({
        tone: "info",
        text: "Şifre sıfırlama bağlantısı kontrol ediliyor...",
    });
    const savingRef = useRef(false);

    useEffect(() => {
        let alive = true;

        async function prepareRecoverySession() {
            const params = getRecoveryParams();
            const accessToken = params.get("access_token");
            const refreshToken = params.get("refresh_token");
            const code = params.get("code");
            const linkError = params.get("error_description") || params.get("error");

            try {
                if (linkError) {
                    throw new Error(params.get("error_code") === "otp_expired" ? "otp_expired link" : linkError);
                }
                if (accessToken && refreshToken) {
                    const { error } = await supabase.auth.setSession({
                        access_token: accessToken,
                        refresh_token: refreshToken,
                    });
                    if (error) throw error;
                } else if (code) {
                    const { error } = await supabase.auth.exchangeCodeForSession(code);
                    if (error) throw error;
                }

                const { data, error } = await supabase.auth.getSession();
                if (error) throw error;
                if (!alive) return;

                if (!data.session) {
                    setPhase("invalid");
                    setMessage({ tone: "error", text: "Şifre sıfırlama oturumu bulunamadı. E-postadaki en son sıfırlama bağlantısını yeniden açın." });
                    return;
                }

                // Token'ları adres çubuğundan temizle.
                window.history.replaceState(null, document.title, `${window.location.pathname}#/reset-password`);
                setPhase("ready");
                setMessage({ tone: "info", text: "Yeni şifrenizi belirleyin." });
            } catch (error) {
                if (!alive) return;
                setPhase("invalid");
                setMessage({ tone: "error", text: resetErrorMessage(error) });
            }
        }

        void prepareRecoverySession();

        return () => {
            alive = false;
        };
    }, []);

    async function endRecoverySession() {
        // Kurtarma oturumunu sonlandır: önce tüm cihazlarda, olmazsa en azından bu cihazda.
        // Böylece kullanıcı ne bu hesapla ne de önceki bir hesapla otomatik giriş yapmış olur.
        const global = await supabase.auth.signOut({ scope: "global" }).catch((error) => ({ error }));
        if (global?.error) {
            await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
        }
    }

    async function handleUpdate(e?: React.FormEvent) {
        e?.preventDefault();
        if (phase !== "ready" || savingRef.current) return;

        if (password.length < MIN_PASSWORD_LENGTH) {
            setMessage({ tone: "error", text: `Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı.` });
            return;
        }
        if (password !== password2) {
            setMessage({ tone: "error", text: "Şifreler aynı değil." });
            return;
        }

        savingRef.current = true;
        setPhase("saving");
        setMessage(null);

        let email: string | null = null;
        try {
            const { data, error } = await supabase.auth.updateUser({ password });
            if (error) throw error;
            email = data.user?.email?.trim().toLowerCase() || null;
        } catch (error) {
            // Başarısız: ekranda kal, yönlendirme yok.
            savingRef.current = false;
            setPhase("ready");
            setMessage({ tone: "error", text: resetErrorMessage(error) });
            return;
        }

        setPhase("done");
        setPassword("");
        setPassword2("");
        setMessage({ tone: "success", text: "Şifreniz güncellendi. Giriş ekranına yönlendiriliyorsunuz..." });

        await endRecoverySession();

        try {
            sessionStorage.setItem(PASSWORD_UPDATED_FLAG, "1");
            if (email) sessionStorage.setItem(PASSWORD_UPDATED_EMAIL, email);
        } catch {
            // Depolama kapalıysa mesaj yalnızca yönlendirme durumuyla taşınır.
        }

        window.setTimeout(() => {
            nav("/login", { replace: true, state: { passwordUpdated: true, email } });
        }, REDIRECT_DELAY_MS);
    }

    const formDisabled = phase !== "ready";

    return (
        <AuthShell
            title="Şifre sıfırlama"
            icon={phase === "done" ? <CheckCircle2 className="w-7 h-7" /> : <KeyRound className="w-7 h-7" />}
            footer={
                phase === "done" ? null : (
                    <button
                        type="button"
                        onClick={async () => {
                            await endRecoverySession();
                            nav("/login", { replace: true });
                        }}
                        className="w-full text-sm font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white"
                        disabled={phase === "saving"}
                    >
                        Vazgeç, giriş ekranına dön
                    </button>
                )
            }
        >
            <form onSubmit={handleUpdate} className="space-y-4" noValidate>
                {message ? <AuthMessage tone={message.tone}>{message.text}</AuthMessage> : null}

                {phase !== "done" && phase !== "invalid" ? (
                    <>
                        <label className="block">
                            <span className={authLabelClass}>Yeni şifre</span>
                            <div className="mt-1.5 relative">
                                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <input
                                    type={showPassword ? "text" : "password"}
                                    autoComplete="new-password"
                                    placeholder={`En az ${MIN_PASSWORD_LENGTH} karakter`}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    onFocus={scrollFieldIntoView}
                                    disabled={formDisabled}
                                    className={`${authInputClass} pr-12`}
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
                        <label className="block">
                            <span className={authLabelClass}>Yeni şifre (tekrar)</span>
                            <div className="mt-1.5 relative">
                                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <input
                                    type={showPassword ? "text" : "password"}
                                    autoComplete="new-password"
                                    value={password2}
                                    onChange={(e) => setPassword2(e.target.value)}
                                    onFocus={scrollFieldIntoView}
                                    disabled={formDisabled}
                                    className={authInputClass}
                                />
                            </div>
                        </label>
                        <button type="submit" disabled={formDisabled} className={authPrimaryButtonClass}>
                            {phase === "saving" || phase === "checking" ? <Loader2 className="w-5 h-5 animate-spin" /> : <KeyRound className="w-5 h-5" />}
                            {phase === "saving" ? "Güncelleniyor..." : "Şifreyi Güncelle"}
                        </button>
                    </>
                ) : null}

                {phase === "done" ? (
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Oturum güvenli şekilde kapatıldı.
                    </div>
                ) : null}
            </form>
        </AuthShell>
    );
}
