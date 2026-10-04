import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { EmailOtpType } from "@supabase/supabase-js";
import { CheckCircle2, Loader2, MailWarning } from "lucide-react";

import { supabase } from "../supabaseClient";
import { useAuth } from "../context/AuthContext";
import AuthShell, { AuthMessage, authPrimaryButtonClass } from "../components/AuthShell";
import { readAuthParamsFromLocation } from "../utils/authRedirect";
import { friendlyAuthError } from "../utils/authErrors";

/**
 * E-posta doğrulama / şifre sıfırlama bağlantılarının döndüğü sayfa (#/auth/callback).
 * Hash router kullanıldığı için Supabase'in eklediği parametreler
 * (#access_token=..., ?code=..., token_hash=...) burada elle işlenir.
 */
export default function AuthCallback() {
    const nav = useNavigate();
    const { refreshAuth } = useAuth();
    const [state, setState] = useState<"working" | "confirmed" | "error">("working");
    const [message, setMessage] = useState("");
    const sessionTask = useRef<Promise<string> | null>(null);

    useEffect(() => {
        let alive = true;

        if (!sessionTask.current) sessionTask.current = (async () => {
            const params = readAuthParamsFromLocation();
            const type = params.get("type") || "";
            const errorDescription = params.get("error_description") || params.get("error");
            if (errorDescription) throw new Error(params.get("error_code") === "otp_expired" ? "otp_expired link" : errorDescription);
            const accessToken = params.get("access_token");
            const refreshToken = params.get("refresh_token");
            const code = params.get("code");
            const tokenHash = params.get("token_hash");
            if (accessToken && refreshToken) {
                const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
                if (error) throw error;
            } else if (code) {
                const { error } = await supabase.auth.exchangeCodeForSession(code);
                if (error) throw error;
            } else if (tokenHash && ["signup", "email", "recovery", "invite", "email_change"].includes(type)) {
                const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
                if (error) throw error;
            }
            window.history.replaceState(null, document.title, `${window.location.pathname}#/auth/callback`);
            return type;
        })();

        async function run() {
            try {
                const type = await sessionTask.current;
                if (!alive) return;
                if (type === "recovery") {
                    nav("/reset-password", { replace: true });
                    return;
                }

                const { data, error } = await supabase.auth.getSession();
                if (error) throw error;
                if (!alive) return;
                if (!data.session) {
                    setState("error");
                    setMessage("Doğrulama oturumu bulunamadı. E-postanızdaki bağlantıyı yeniden açın veya doğrulama tamamlandıysa giriş yaparak devam edin.");
                    return;
                }

                await refreshAuth();
                if (!alive) return;
                setState("confirmed");
                setMessage("E-postanız doğrulandı. Hesabınız hazırlanıyor...");
                window.setTimeout(() => nav("/", { replace: true }), 900);
            } catch (error) {
                if (!alive) return;
                const raw = error instanceof Error ? error.message : String((error as { message?: string })?.message || "");
                setState("error");
                setMessage(friendlyAuthError(raw || "Bağlantı doğrulanamadı."));
            }
        }

        void run();
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (state === "working") {
        return (
            <AuthShell title="Bağlantı kontrol ediliyor" icon={<Loader2 className="w-7 h-7 animate-spin" />}>
                <p className="text-sm text-slate-500 dark:text-slate-400">Lütfen bekleyin...</p>
            </AuthShell>
        );
    }

    return (
        <AuthShell
            title={state === "confirmed" ? "E-posta doğrulandı" : "Bağlantı doğrulanamadı"}
            icon={state === "confirmed" ? <CheckCircle2 className="w-7 h-7" /> : <MailWarning className="w-7 h-7" />}
        >
            <div className="space-y-4">
                <AuthMessage tone={state === "confirmed" ? "success" : "error"}>{message}</AuthMessage>
                {state === "confirmed" ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Telefon veya bilgisayar uygulamasında kayıt olduysanız uygulamaya dönüp “Doğruladım, devam et” butonuna basabilir ya da giriş yapabilirsiniz.
                    </p>
                ) : null}
                <button type="button" className={authPrimaryButtonClass} onClick={() => nav("/login", { replace: true })}>
                    Giriş ekranına git
                </button>
            </div>
        </AuthShell>
    );
}
