import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Loader2, Lock, Mail, ShieldCheck, User, XCircle } from "lucide-react";

import { supabase } from "../supabaseClient";
import { useAuth } from "../context/AuthContext";
import { getAuthRedirectUrl } from "../utils/authRedirect";
import { inviteSignupMetadata, friendlyInviteJoinError } from "../utils/inviteJoin";
import { scrollFieldIntoView } from "../components/AuthShell";

type InviteRole = "admin" | "accountant" | "installer" | "measurement";

type InviteInfo = {
    invite_id: string;
    company_id: string;
    company_name: string | null;
    email: string;
    role: InviteRole;
    expires_at: string;
    used_at: string | null;
    invite_code?: string | null;
};

type JoinStep =
    | "invite_lookup"
    | "auth_existing_session"
    | "auth_sign_in"
    | "auth_sign_up"
    | "auth_verify_session"
    | "rpc_accept_invite";

type SupabaseLikeError = {
    message?: string;
    code?: string;
    status?: number;
    name?: string;
    details?: string;
    hint?: string;
};

type JoinDebug = {
    step: JoinStep;
    label: string;
    message: string;
    code?: string;
    status?: number;
    details?: string;
    hint?: string;
};

type JoinFlowError = Error & {
    joinStep?: JoinStep;
    originalMessage?: string;
    code?: string;
    status?: number;
    details?: string;
    hint?: string;
};

const JOIN_STEP_LABELS: Record<JoinStep, string> = {
    invite_lookup: "Davet bilgisi okuma",
    auth_existing_session: "Mevcut oturum kontrolü",
    auth_sign_in: "Supabase Auth giriş",
    auth_sign_up: "Supabase Auth kayıt",
    auth_verify_session: "Oturum e-posta doğrulama",
    rpc_accept_invite: "Davet kabul RPC",
};

function roleLabel(role?: string | null) {
    if (role === "admin") return "Yönetici";
    if (role === "accountant") return "Muhasebe";
    if (role === "installer") return "Montaj Personeli";
    if (role === "measurement") return "Saha Personeli";
    return "Personel";
}

function normalizeMessage(message?: string | null) {
    return (message || "").toLowerCase();
}

function getErrorInfo(error: unknown): Omit<JoinDebug, "step" | "label"> {
    const typed = (error || {}) as SupabaseLikeError;
    const message =
        typeof typed.message === "string"
            ? typed.message
            : error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : "Bilinmeyen hata";

    return {
        message,
        code: typed.code,
        status: typeof typed.status === "number" ? typed.status : undefined,
        details: typed.details,
        hint: typed.hint,
    };
}

function shouldTrySignupAfterSignIn(error: unknown) {
    return /invalid login credentials|user not found/.test(normalizeMessage(getErrorInfo(error).message));
}
function createJoinError(step: JoinStep, error: unknown): JoinFlowError {
    return Object.assign(new Error(getErrorInfo(error).message), getErrorInfo(error), { joinStep: step });
}
function friendlyInviteError(message: string) { return friendlyInviteJoinError({ message }); }

function friendlySignupError(message: string) {
    return friendlyInviteJoinError({ message });
}

function signupRedirect() {
    return getAuthRedirectUrl("/auth/callback");
}

export default function SignupWithCode() {
    const { token } = useParams<{ token: string }>();
    const nav = useNavigate();
    const { refreshAuth } = useAuth();
    // Zaten oturum açmış (ör. "Hesap kurulumu" ekranından gelen) kullanıcı:
    // e-posta oturumdan alınır, şifre tekrar istenmez.
    const [sessionEmail, setSessionEmail] = useState<string | null>(null);

    const [invite, setInvite] = useState<InviteInfo | null>(null);
    const [email, setEmail] = useState("");
    const [inviteCode, setInviteCode] = useState("");
    const [password, setPassword] = useState("");
    const [fullName, setFullName] = useState("");
    const [loadingInvite, setLoadingInvite] = useState(true);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");
    const [success, setSuccess] = useState(false);
    const [verificationRequired, setVerificationRequired] = useState(false);
    const [, setJoinDebug] = useState<JoinDebug | null>(null);
    const [, setJoinTrace] = useState<string[]>([]);

    const tokenValue = token?.trim() || "";
    const isCodeMode = !tokenValue;

    const inviteState = useMemo(() => {
        if (!invite) return { usable: isCodeMode, message: "" };
        if (!invite.used_at && new Date(invite.expires_at).getTime() < Date.now()) {
            return { usable: false, message: "Bu davetin süresi dolmuş." };
        }
        if (!["admin", "accountant", "installer", "measurement"].includes(invite.role)) {
            return { usable: false, message: "Davet rolü geçersiz." };
        }
        if (!invite.company_id) return { usable: false, message: "Davet edilen firma bulunamadı." };
        return { usable: true, message: "" };
    }, [invite, isCodeMode]);

    function recordJoinStep(step: JoinStep, result: "başladı" | "tamam" | "uyarı" | "hata", payload?: unknown) {
        const label = JOIN_STEP_LABELS[step];
        const line = `${new Date().toLocaleTimeString("tr-TR")} - ${label}: ${result}`;
        setJoinTrace((previous) => [...previous.slice(-7), line]);

        if (result === "hata") {
            console.error(`[InviteJoin] ${label}: ${result}`, payload);
            return;
        }
        console.info(`[InviteJoin] ${label}: ${result}`, payload ?? "");
    }

    function failJoinStep(step: JoinStep, error: unknown): JoinFlowError {
        const info = getErrorInfo(error);
        const nextDebug: JoinDebug = {
            step,
            label: JOIN_STEP_LABELS[step],
            ...info,
        };

        setJoinDebug(nextDebug);
        recordJoinStep(step, "hata", info);
        console.groupCollapsed(`[InviteJoin] HATA - ${nextDebug.label}`);
        console.error("Orijinal hata:", error);
        console.table({
            step: nextDebug.step,
            message: nextDebug.message,
            code: nextDebug.code || "",
            status: nextDebug.status || "",
            details: nextDebug.details || "",
            hint: nextDebug.hint || "",
        });
        console.groupEnd();

        return createJoinError(step, error);
    }

    useEffect(() => {
        let alive = true;
        supabase.auth.getSession().then(({ data }) => {
            const current = data.session?.user?.email?.trim().toLowerCase() || null;
            if (!alive || !current) return;
            setSessionEmail(current);
            setEmail((previous) => previous || current);
        });
        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => {
        let alive = true;

        async function loadInvite() {
            setLoadingInvite(true);
            setErr("");
            setInvite(null);
            setJoinDebug(null);
            setJoinTrace([]);

            if (!tokenValue) {
                setLoadingInvite(false);
                return;
            }

            try {
                recordJoinStep("invite_lookup", "başladı", { token: tokenValue.slice(0, 8) });
                const { data, error } = await supabase.rpc("get_invite_by_token", {
                    p_token: tokenValue,
                });

                if (error) throw failJoinStep("invite_lookup", error);

                const row = Array.isArray(data) ? data[0] : data;
                if (!row) throw failJoinStep("invite_lookup", new Error("Davet bulunamadı."));

                if (!alive) return;
                const nextInvite = row as InviteInfo;
                setInvite(nextInvite);
                setEmail(nextInvite.email || "");
                recordJoinStep("invite_lookup", "tamam", {
                    company_id: nextInvite.company_id,
                    email: nextInvite.email,
                    role: nextInvite.role,
                });
            } catch (e: unknown) {
                if (!alive) return;
                const joinError = e as JoinFlowError;
                setErr(friendlyInviteError(joinError.originalMessage || joinError.message));
            } finally {
                if (alive) setLoadingInvite(false);
            }
        }

        loadInvite();

        return () => {
            alive = false;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tokenValue]);

    async function verifySessionEmail(cleanEmail: string) {
        recordJoinStep("auth_verify_session", "başladı");
        const { data, error } = await supabase.auth.getUser();
        if (error) throw failJoinStep("auth_verify_session", error);

        const sessionEmail = data.user?.email?.trim().toLowerCase();
        if (!data.user || sessionEmail !== cleanEmail) {
            throw failJoinStep(
                "auth_verify_session",
                new Error("Oturum davet e-postası ile eşleşmedi. Lütfen doğru kullanıcıyla tekrar deneyin."),
            );
        }

        recordJoinStep("auth_verify_session", "tamam", { user_id: data.user.id, email: sessionEmail });
    }

    async function lookupInviteByCode(cleanEmail: string) {
        recordJoinStep("invite_lookup", "başladı", { email: cleanEmail });
        const { data, error } = await supabase.rpc("get_invite_by_email_code", {
            p_email: cleanEmail,
            p_code: inviteCode.trim().toUpperCase(),
        });

        if (error) throw failJoinStep("invite_lookup", error);
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) throw failJoinStep("invite_lookup", new Error("Davet kodu bulunamadı."));

        const nextInvite = row as InviteInfo;
        setInvite(nextInvite);
        recordJoinStep("invite_lookup", "tamam", {
            company_id: nextInvite.company_id,
            email: nextInvite.email,
            role: nextInvite.role,
        });
        return nextInvite;
    }

    async function acceptInviteForCurrentUser() {
        recordJoinStep("rpc_accept_invite", "başladı");
        const { error } = isCodeMode
            ? await supabase.rpc("accept_invite_code_for_current_user", {
                p_email: email.trim().toLowerCase(),
                p_code: inviteCode.trim().toUpperCase(),
                p_full_name: fullName.trim() || null,
            })
            : await supabase.rpc("accept_invite_for_current_user", {
                p_token: tokenValue,
                p_full_name: fullName.trim() || null,
            });
        if (error) throw failJoinStep("rpc_accept_invite", error);
        recordJoinStep("rpc_accept_invite", "tamam");
    }

    async function authenticateInviteUser(cleanEmail: string, continuing = false) {
        const { data: current, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw failJoinStep("auth_existing_session", sessionError);
        const activeEmail = current.session?.user.email?.trim().toLowerCase();
        if (activeEmail === cleanEmail) return "SUCCESS";
        if (activeEmail) {
            const { error } = await supabase.auth.signOut({ scope: "local" });
            if (error) throw failJoinStep("auth_existing_session", error);
        }

        // Once giris: onaylanmis eski hesapta signUp sahte kullanici dondurebilir.
        const signedIn = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (!signedIn.error) return "SUCCESS";
        if (signedIn.error.code === "email_not_confirmed" || signedIn.error.message.toLowerCase().includes("email not confirmed")) {
            return "VERIFICATION_REQUIRED";
        }
        if (continuing || !shouldTrySignupAfterSignIn(signedIn.error)) throw failJoinStep("auth_sign_in", signedIn.error);

        const redirectTo = signupRedirect();
        const signedUp = await supabase.auth.signUp({
            email: cleanEmail, password,
            options: {
                ...(redirectTo ? { emailRedirectTo: redirectTo } : {}),
                data: inviteSignupMetadata(tokenValue, inviteCode, fullName.trim() || cleanEmail.split("@")[0]),
            },
        });
        if (signedUp.error) throw failJoinStep("auth_sign_up", signedUp.error);
        if (!signedUp.data.user) throw failJoinStep("auth_sign_up", new Error("Kayıt tamamlanamadı."));
        if (signedUp.data.user.identities?.length === 0) {
            throw failJoinStep("auth_sign_in", new Error("invalid login credentials"));
        }
        return signedUp.data.session ? "SUCCESS" : "VERIFICATION_REQUIRED";
    }

    async function handleJoin(e?: React.FormEvent) {
        e?.preventDefault();
        if (loading) return;

        setErr("");
        setJoinDebug(null);
        setJoinTrace([]);

        if (!isCodeMode && (!invite || !inviteState.usable)) {
            setErr(inviteState.message || "Davet doğrulanamadı.");
            return;
        }

        const cleanEmail = email.trim().toLowerCase();
        if (!cleanEmail) return setErr("E-posta zorunlu.");
        if (isCodeMode && !inviteCode.trim()) return setErr("Davet kodu zorunlu.");
        if (!isCodeMode && invite && cleanEmail !== invite.email.trim().toLowerCase()) {
            setErr("Bu davet farklı bir e-posta adresi için oluşturulmuş. Lütfen davetteki e-posta ile devam edin.");
            return;
        }

        const usingCurrentSession = Boolean(sessionEmail && sessionEmail === cleanEmail);
        if (!usingCurrentSession && password.length < 6) {
            setErr("Şifre en az 6 karakter olmalı.");
            return;
        }

        setLoading(true);

        try {
            const activeInvite = isCodeMode ? await lookupInviteByCode(cleanEmail) : invite;
            if (!activeInvite) throw failJoinStep("invite_lookup", new Error("Davet doğrulanamadı."));
            if (!activeInvite.used_at && new Date(activeInvite.expires_at).getTime() < Date.now()) throw failJoinStep("invite_lookup", new Error("Bu davetin süresi dolmuş."));
            if (cleanEmail !== activeInvite.email.trim().toLowerCase()) {
                throw failJoinStep("invite_lookup", new Error("Bu davet farklı bir e-posta adresi için oluşturulmuş."));
            }
            const authStatus = await authenticateInviteUser(cleanEmail, verificationRequired);
            if (authStatus === "VERIFICATION_REQUIRED") {
                setErr(verificationRequired ? "Doğrulama henüz tamamlanmamış. E-postanızdaki bağlantıya tıklayıp yeniden deneyin." : "");
                setVerificationRequired(true);
                return;
            }

            await verifySessionEmail(cleanEmail);
            await acceptInviteForCurrentUser();
            // Oturum zaten açıksa auth olayı tetiklenmez: firma bilgisini yenile.
            await refreshAuth();

            setVerificationRequired(false);
            setSuccess(true);
            window.setTimeout(() => nav("/", { replace: true }), 1500);
        } catch (e: unknown) {
            const joinError = e as JoinFlowError;
            setErr(friendlySignupError(joinError.originalMessage || joinError.message));
        } finally {
            setLoading(false);
        }
    }

    if (loadingInvite) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
                <div className="flex items-center gap-3 text-slate-500 dark:text-slate-300 font-semibold">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Davet kontrol ediliyor...
                </div>
            </div>
        );
    }

    if (verificationRequired) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6 text-center">
                <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-3xl p-10 shadow-xl border border-blue-100 dark:border-slate-800">
                    <Mail className="w-16 h-16 text-blue-500 mx-auto mb-5" />
                    <h2 className="text-2xl font-black text-slate-900 dark:text-white mb-3">E-postanızı doğrulayın</h2>
                    <p className="text-slate-500 dark:text-slate-400 leading-relaxed font-medium mb-6">
                        Güvenliğiniz için e-posta adresinize bir doğrulama bağlantısı gönderdik. Lütfen gelen kutunuzu (veya spam klasörünüzü) kontrol edin.
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                        Bağlantıyı açtığınızda firma üyeliğiniz tamamlanır. Başka cihazda doğruladıysanız bu ekrana dönüp devam edebilirsiniz.
                    </p>
                    {err ? <p role="alert" className="mb-4 text-sm text-red-600">{err}</p> : null}
                    <button
                        disabled={loading}
                        onClick={() => void handleJoin()}
                        className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors"
                    >
                        {loading ? "Kontrol ediliyor..." : "Doğruladım, devam et"}
                    </button>
                </div>
            </div>
        );
    }

    if (success) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-center">
                <div className="max-w-md w-full bg-white rounded-3xl p-10 shadow-xl border border-emerald-100">
                    <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-5" />
                    <h2 className="text-2xl font-black text-slate-900 mb-3">Hesabınız hazır</h2>
                    <p className="text-slate-500 leading-relaxed font-medium">
                        Firma hesabınıza bağlandınız. Panele yönlendiriliyorsunuz.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div
            className="min-h-[100dvh] overflow-y-auto bg-slate-50 dark:bg-slate-950 flex justify-center items-start sm:items-center px-4"
            style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))", paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        >
            <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xl overflow-hidden">
                <div className="bg-slate-900 p-8 text-white">
                    <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center mb-4">
                        <ShieldCheck className="w-7 h-7" />
                    </div>
                    <h1 className="text-2xl font-black">Davet kodum var</h1>
                    <p className="opacity-75 mt-2 text-sm">
                        Size davet kodu verilen işletmeye katılın. Bu yol yeni işletme veya yeni deneme oluşturmaz; işletmenin mevcut hakları geçerlidir.
                    </p>
                </div>

                <div className="p-7 space-y-5">
                    {err ? (
                        <div className="space-y-3">
                            <div className="p-4 bg-red-50 text-red-700 rounded-2xl text-sm font-semibold border border-red-100 flex items-start gap-2">
                                <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
                                <span>{err}</span>
                            </div>

                        </div>
                    ) : null}

                    {invite ? (
                        <div className="rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 text-sm">
                            <div className="font-black text-slate-900 dark:text-white">{invite.company_name || "Firma"}</div>
                            <div className="text-slate-500 mt-1">Rol: {roleLabel(invite.role)}</div>
                            <div className="text-slate-500">E-posta: {invite.email}</div>
                        </div>
                    ) : null}

                    {!inviteState.usable && inviteState.message ? (
                        <div className="p-4 bg-amber-50 text-amber-800 rounded-2xl text-sm font-semibold border border-amber-100">
                            {inviteState.message}
                        </div>
                    ) : null}

                    <form onSubmit={handleJoin} className="space-y-4">
                        <label className="block">
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Ad Soyad</span>
                            <div className="mt-1.5 relative">
                                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <input
                                    className="w-full pl-11 pr-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:ring-2 focus:ring-primary-500"
                                    placeholder="Ad soyad"
                                    value={fullName}
                                    onChange={(event) => setFullName(event.target.value)}
                                    onFocus={scrollFieldIntoView}
                                    disabled={loading || !inviteState.usable}
                                />
                            </div>
                        </label>

                        {isCodeMode ? (
                            <label className="block">
                                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Davet Kodu</span>
                                <div className="mt-1.5 relative">
                                    <ShieldCheck className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <input
                                        className="w-full pl-11 pr-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:ring-2 focus:ring-primary-500 font-mono uppercase tracking-widest"
                                        placeholder="ABC-123"
                                        value={inviteCode}
                                        onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                                        onFocus={scrollFieldIntoView}
                                        disabled={loading}
                                        required
                                    />
                                </div>
                            </label>
                        ) : null}

                        <label className="block">
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">E-posta</span>
                            <div className="mt-1.5 relative">
                                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <input
                                    type="email"
                                    className="w-full pl-11 pr-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:ring-2 focus:ring-primary-500"
                                    value={email}
                                    onChange={(event) => setEmail(event.target.value)}
                                    onFocus={scrollFieldIntoView}
                                    autoCapitalize="none"
                                    disabled={loading || !inviteState.usable}
                                    required
                                />
                            </div>
                        </label>

                        {sessionEmail && sessionEmail === email.trim().toLowerCase() ? (
                            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-3 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                Oturumunuz açık; şifre tekrar istenmez.
                            </div>
                        ) : (
                            <label className="block">
                                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Şifre</span>
                                <div className="mt-1.5 relative">
                                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <input
                                        type="password"
                                        className="w-full pl-11 pr-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none focus:ring-2 focus:ring-primary-500"
                                        placeholder="En az 6 karakter"
                                        value={password}
                                        onChange={(event) => setPassword(event.target.value)}
                                        onFocus={scrollFieldIntoView}
                                        disabled={loading || !inviteState.usable}
                                        required
                                        minLength={6}
                                    />
                                </div>
                            </label>
                        )}

                        <button
                            type="submit"
                            disabled={loading || !inviteState.usable}
                            className="w-full h-12 rounded-2xl bg-primary-600 hover:bg-primary-700 text-white font-black shadow-lg shadow-primary-600/20 transition inline-flex items-center justify-center gap-2 disabled:opacity-60"
                        >
                            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                            {loading ? "Hesap hazırlanıyor..." : sessionEmail ? "Kodu Onayla ve Katıl" : "Kodu Onayla ve Şifreyi Belirle"}
                        </button>
                    </form>

                    <button
                        type="button"
                        onClick={() => nav(sessionEmail ? "/setup" : "/login")}
                        className="w-full text-sm font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white"
                    >
                        {sessionEmail ? "Geri dön" : "Giriş ekranına dön"}
                    </button>
                </div>
            </div>
        </div>
    );
}
