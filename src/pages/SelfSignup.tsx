import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, CheckCircle2, Eye, EyeOff, Loader2, Lock, Mail, MailCheck, RefreshCw, Sparkles, User } from "lucide-react";

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
import { getAuthRedirectUrl } from "../utils/authRedirect";
import { friendlyAuthError } from "../utils/authErrors";
import { startSelfServiceTrial } from "../utils/selfServiceTrial";

const MIN_PASSWORD_LENGTH = 8;

type Step = "form" | "verify" | "done";

function errorText(error: unknown, fallback: string) {
    const message = error instanceof Error ? error.message : String((error as { message?: string })?.message || "");
    return friendlyAuthError(message || fallback);
}

export default function SelfSignup() {
    const nav = useNavigate();
    const { refreshAuth } = useAuth();
    const [fullName, setFullName] = useState("");
    const [companyName, setCompanyName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [step, setStep] = useState<Step>("form");
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ tone: "info" | "error" | "success"; text: string } | null>(null);
    const [existingAccount, setExistingAccount] = useState(false);
    const submittingRef = useRef(false);

    useEffect(() => {
        let alive = true;
        supabase.auth.getSession().then(({ data }) => {
            if (alive && data.session?.user) nav("/", { replace: true });
        });
        return () => {
            alive = false;
        };
    }, [nav]);

    async function finishWithSession() {
        // Doğrulanmış oturum var: işletme + deneme sunucuda oluşturulur (tekrar
        // çağrılırsa yeni işletme/deneme oluşmaz, mevcut olan döner).
        try {
            await startSelfServiceTrial(companyName, fullName);
        } catch (error) {
            console.warn("Self-service trial start failed; continuing on setup screen", error);
            // Kurulum ekranı hatayı gösterir ve tekrar denemeye izin verir.
            await refreshAuth();
            nav("/setup", { replace: true });
            return;
        }
        await refreshAuth();
        setStep("done");
        nav("/", { replace: true });
    }

    function validate(): string | null {
        if (fullName.trim().length < 2) return "Ad soyad girin.";
        if (companyName.trim().length < 2) return "İşletme adını girin (en az 2 karakter).";
        const cleanEmail = email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return "Geçerli bir e-posta adresi girin.";
        if (password.length < MIN_PASSWORD_LENGTH) return `Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı.`;
        return null;
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (loading || submittingRef.current) return;

        setMessage(null);
        setExistingAccount(false);
        const invalid = validate();
        if (invalid) {
            setMessage({ tone: "error", text: invalid });
            return;
        }

        const cleanEmail = email.trim().toLowerCase();
        submittingRef.current = true;
        setLoading(true);
        try {
            const emailRedirectTo = getAuthRedirectUrl("/auth/callback");
            const { data, error } = await supabase.auth.signUp({
                email: cleanEmail,
                password,
                options: {
                    ...(emailRedirectTo ? { emailRedirectTo } : {}),
                    data: {
                        full_name: fullName.trim(),
                        company_name: companyName.trim(),
                        signup_intent: "self_trial",
                    },
                },
            });

            if (error) {
                if (/already registered|already been registered/i.test(error.message)) {
                    setExistingAccount(true);
                }
                throw error;
            }

            // E-posta doğrulaması açıkken var olan bir e-posta için Supabase hata
            // döndürmez; kimliği olmayan sahte bir kullanıcı döndürür.
            if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
                setExistingAccount(true);
                setMessage({ tone: "error", text: "Bu e-posta ile zaten bir hesap var. Giriş yapın veya şifrenizi sıfırlayın." });
                return;
            }

            if (data.session) {
                await finishWithSession();
                return;
            }

            setStep("verify");
            setMessage({
                tone: "info",
                text: `${cleanEmail} adresine bir doğrulama bağlantısı gönderdik. Bağlantıya tıkladıktan sonra aşağıdaki butonla devam edin.`,
            });
        } catch (error) {
            setMessage({ tone: "error", text: errorText(error, "Hesap oluşturulamadı.") });
        } finally {
            submittingRef.current = false;
            setLoading(false);
        }
    }

    async function handleContinueAfterVerify() {
        if (loading) return;
        setLoading(true);
        setMessage(null);
        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email.trim().toLowerCase(),
                password,
            });
            if (error) throw error;
            if (!data.session) throw new Error("Oturum açılamadı.");
            await finishWithSession();
        } catch (error) {
            setMessage({ tone: "error", text: errorText(error, "Devam edilemedi.") });
        } finally {
            setLoading(false);
        }
    }

    async function handleResend() {
        if (loading) return;
        setLoading(true);
        setMessage(null);
        try {
            const emailRedirectTo = getAuthRedirectUrl("/auth/callback");
            const { error } = await supabase.auth.resend({
                type: "signup",
                email: email.trim().toLowerCase(),
                ...(emailRedirectTo ? { options: { emailRedirectTo } } : {}),
            });
            if (error) throw error;
            setMessage({ tone: "success", text: "Doğrulama e-postası tekrar gönderildi. Spam klasörünü de kontrol edin." });
        } catch (error) {
            setMessage({ tone: "error", text: errorText(error, "E-posta gönderilemedi.") });
        } finally {
            setLoading(false);
        }
    }

    if (step === "done") {
        return (
            <AuthShell title="Hesabınız hazır" icon={<CheckCircle2 className="w-7 h-7" />}>
                <div className="flex items-center gap-3 text-slate-600 dark:text-slate-300 font-semibold">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Panele yönlendiriliyorsunuz...
                </div>
            </AuthShell>
        );
    }

    if (step === "verify") {
        return (
            <AuthShell
                title="E-postanızı doğrulayın"
                icon={<MailCheck className="w-7 h-7" />}
                subtitle="Deneme süreniz, e-postanız doğrulandıktan sonra işletmeniz oluşturulduğunda başlar."
                footer={
                    <button
                        type="button"
                        onClick={() => nav("/login")}
                        className="w-full inline-flex items-center justify-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Giriş ekranına dön
                    </button>
                }
            >
                <div className="space-y-4">
                    {message ? <AuthMessage tone={message.tone}>{message.text}</AuthMessage> : null}
                    <ol className="list-decimal pl-5 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                        <li>E-postanızdaki “E-postamı doğrula” bağlantısına tıklayın.</li>
                        <li>Bağlantı tarayıcıda açılabilir; doğrulama tamamlanınca bu ekrana dönün.</li>
                        <li>“Doğruladım, devam et” butonuna basın.</li>
                    </ol>
                    <button type="button" onClick={handleContinueAfterVerify} className={authPrimaryButtonClass} disabled={loading}>
                        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                        Doğruladım, devam et
                    </button>
                    <button type="button" onClick={handleResend} className={authSecondaryButtonClass} disabled={loading}>
                        <RefreshCw className="w-5 h-5" />
                        Doğrulama e-postasını tekrar gönder
                    </button>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Bu ekranı kapatırsanız da sorun değil: daha sonra e-posta ve şifrenizle giriş yaptığınızda kurulum kaldığı yerden devam eder.
                    </p>
                </div>
            </AuthShell>
        );
    }

    return (
        <AuthShell
            title="7 gün ücretsiz deneyin"
            icon={<Sparkles className="w-7 h-7" />}
            subtitle="Kendi işletme hesabınızı açın. Kod beklemenize gerek yok."
            footer={
                <div className="flex flex-col items-center gap-2 text-sm">
                    <button type="button" onClick={() => nav("/login")} className="font-bold text-primary-700 dark:text-primary-300 hover:underline">
                        Zaten hesabım var, giriş yap
                    </button>
                    <button type="button" onClick={() => nav("/join")} className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
                        Davet kodum var
                    </button>
                </div>
            }
        >
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <label className="block">
                    <span className={authLabelClass}>Ad Soyad</span>
                    <div className="mt-1.5 relative">
                        <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            onFocus={scrollFieldIntoView}
                            autoComplete="name"
                            placeholder="Adınız Soyadınız"
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
                            autoComplete="new-password"
                            placeholder={`En az ${MIN_PASSWORD_LENGTH} karakter`}
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

                {message ? <AuthMessage tone={message.tone}>{message.text}</AuthMessage> : null}
                {existingAccount ? (
                    <button type="button" onClick={() => nav("/login")} className={authSecondaryButtonClass}>
                        Giriş ekranına git
                    </button>
                ) : null}

                <button type="submit" className={authPrimaryButtonClass} disabled={loading}>
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                    {loading ? "Hesap oluşturuluyor..." : "Ücretsiz denemeyi başlat"}
                </button>
                <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                    7 günlük deneme süresi sunucuda tutulur. Süre bitince verileriniz silinmez; görüntülemeye devam edebilirsiniz.
                </p>
            </form>
        </AuthShell>
    );
}
