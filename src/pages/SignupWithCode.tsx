import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Loader2, Lock, Mail, ShieldCheck, User, XCircle } from "lucide-react";

import { supabase } from "../supabaseClient";

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
    return (message || "").toLocaleLowerCase("tr-TR");
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

function isAlreadyRegistered(error: unknown) {
    const lower = normalizeMessage(getErrorInfo(error).message);
    return (
        lower.includes("already registered") ||
        lower.includes("already been registered") ||
        lower.includes("user already registered")
    );
}

function shouldTrySignupAfterSignIn(error: unknown) {
    const lower = normalizeMessage(getErrorInfo(error).message);
    return lower.includes("invalid login credentials") || lower.includes("user not found");
}

function createJoinError(step: JoinStep, error: unknown): JoinFlowError {
    const info = getErrorInfo(error);
    const nextError = new Error(info.message) as JoinFlowError;
    nextError.joinStep = step;
    nextError.originalMessage = info.message;
    nextError.code = info.code;
    nextError.status = info.status;
    nextError.details = info.details;
    nextError.hint = info.hint;
    return nextError;
}

function friendlyInviteError(message: string) {
    const lower = normalizeMessage(message);
    if (lower.includes("get_invite_by_token") || lower.includes("schema cache")) {
        return "Davet sistemi veritabanında eksik. Güncel SQL fix dosyasını Supabase SQL Editor'da çalıştırın.";
    }
    if (lower.includes("bulunamadi") || lower.includes("bulunamad?") || lower.includes("gecersiz") || lower.includes("geçersiz")) {
        return "Davet bağlantısı geçersiz. Lütfen yöneticinizden yeni davet isteyin.";
    }
    if (lower.includes("kullanilmis") || lower.includes("kullanılmış")) {
        return "Bu davet bağlantısı daha önce kullanılmış. Lütfen yöneticinizden yeni davet isteyin.";
    }
    if (lower.includes("suresi dol") || lower.includes("süresi dol")) {
        return "Bu davetin süresi dolmuş. Lütfen yöneticinizden yeni davet isteyin.";
    }
    return message || "Davet doğrulanamadı.";
}

function friendlySignupError(message: string, step?: JoinStep) {
    const lower = normalizeMessage(message);

    if (step === "auth_sign_up" && lower.includes("database error finding user")) {
        return "Supabase Auth kayıt aşamasında hata verdi: Database error finding user. Bu hata profiles/company_members/user_invites adımına geçmeden önce oluşuyor; auth.users trigger/policy fix SQL dosyasını çalıştırın.";
    }
    if (step === "auth_sign_in" && lower.includes("email not confirmed")) {
        return "Bu e-posta için hesap var ancak e-posta doğrulaması bekliyor. E-postadaki doğrulamayı tamamlayıp aynı davet bağlantısından tekrar giriş yapın.";
    }
    if (step === "auth_sign_in" && lower.includes("database error querying schema")) {
        return "Supabase Auth giriş aşamasında veritabanı şema hatası verdi. Bu frontend değil; auth.users trigger/hook/function fix SQL dosyasını çalıştırın.";
    }
    if (step === "auth_sign_in" && lower.includes("invalid login credentials")) {
        return "Bu e-posta için daha önce hesap oluşturulmuş ve girilen şifre mevcut hesapla eşleşmedi. Şifremi unuttum ile şifrenizi sıfırlayın, sonra aynı e-posta ve davet koduyla tekrar deneyin.";
    }
    if (step === "auth_sign_in" && lower.includes("şifre sıfırlama maili")) {
        return message;
    }
    if (isAlreadyRegistered({ message })) {
        return "Bu e-posta zaten kayıtlı. Daveti kabul etmek için mevcut şifrenizle devam edin.";
    }
    if (lower.includes("password")) return "Şifre en az 6 karakter olmalı.";
    if (lower.includes("email")) return "Lütfen geçerli bir e-posta adresi girin.";
    if (lower.includes("accept_invite_for_current_user") || lower.includes("schema cache")) {
        return "Davet kabul fonksiyonu veritabanında kurulu değil. Güncel SQL fix dosyasını çalıştırın.";
    }
    if (lower.includes("company_id") && lower.includes("ambiguous")) {
        return "Davet kabul fonksiyonunda veritabanı isim çakışması var. Supabase SQL Editor'da supabase_invite_accept_company_id_ambiguity_hotfix.sql dosyasını çalıştırın.";
    }
    if (lower.includes("42702")) {
        return "Davet kabul fonksiyonunda veritabanı isim çakışması var. Supabase SQL Editor'da supabase_invite_accept_company_id_ambiguity_hotfix.sql dosyasını çalıştırın.";
    }
    if (lower.includes("farkli") || lower.includes("farklı")) {
        return "Bu davet farklı bir e-posta adresi için oluşturulmuş.";
    }
    if (lower.includes("firma lisansı") || lower.includes("firma lisansi")) {
        return "Firma lisansı aktif değil veya sadece okuma modunda. Yeni kullanıcı eklemek için firmayı aktif hale getirin.";
    }
    return message || "Kayıt tamamlanamadı.";
}

function passwordResetRedirectUrl() {
    return `${window.location.origin}${window.location.pathname}#/reset-password`;
}

export default function SignupWithCode() {
    const { token } = useParams<{ token: string }>();
    const nav = useNavigate();

    const [invite, setInvite] = useState<InviteInfo | null>(null);
    const [email, setEmail] = useState("");
    const [inviteCode, setInviteCode] = useState("");
    const [password, setPassword] = useState("");
    const [fullName, setFullName] = useState("");
    const [loadingInvite, setLoadingInvite] = useState(true);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");
    const [success, setSuccess] = useState(false);
    const [joinDebug, setJoinDebug] = useState<JoinDebug | null>(null);
    const [joinTrace, setJoinTrace] = useState<string[]>([]);

    const tokenValue = token?.trim() || "";
    const isCodeMode = !tokenValue;

    const inviteState = useMemo(() => {
        if (!invite) return { usable: isCodeMode, message: "" };
        if (invite.used_at) return { usable: false, message: "Bu davet bağlantısı daha önce kullanılmış." };
        if (new Date(invite.expires_at).getTime() < Date.now()) {
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

        async function loadInvite() {
            setLoadingInvite(true);
            setErr("");
            setInvite(null);
            setJoinDebug(null);
            setJoinTrace([]);

            if (!tokenValue) {
                setLoadingInvite(false);
                return;
                setErr("Davet bağlantısı eksik. Kayıt yalnızca davet bağlantısı ile yapılabilir.");
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

        const sessionEmail = data.user?.email?.trim().toLocaleLowerCase("tr-TR");
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
                p_email: email.trim().toLocaleLowerCase("tr-TR"),
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

    async function sendPasswordResetForExistingUser(cleanEmail: string) {
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
            redirectTo: passwordResetRedirectUrl(),
        });

        if (error) {
            const info = getErrorInfo(error);
            recordJoinStep("auth_sign_in", "uyarı", {
                ...info,
                reset_message: "Şifre sıfırlama maili gönderilemedi.",
            });
            return false;
        }

        recordJoinStep("auth_sign_in", "uyarı", {
            message: "Mevcut kullanıcı için şifre sıfırlama maili gönderildi.",
            email: cleanEmail,
        });
        return true;
    }

    async function authenticateInviteUser(cleanEmail: string, activeInvite: InviteInfo) {
        recordJoinStep("auth_existing_session", "başladı");
        const currentUserResult = await supabase.auth.getUser();
        if (currentUserResult.error) {
            recordJoinStep("auth_existing_session", "uyarı", getErrorInfo(currentUserResult.error));
        }

        const activeEmail = currentUserResult.data.user?.email?.trim().toLocaleLowerCase("tr-TR");
        if (activeEmail === cleanEmail) {
            recordJoinStep("auth_existing_session", "tamam", { email: activeEmail });
            return;
        }

        recordJoinStep("auth_existing_session", "tamam", {
            active_email: activeEmail || null,
            invite_email: cleanEmail,
        });

        if (activeEmail && activeEmail !== cleanEmail) {
            await supabase.auth.signOut();
            recordJoinStep("auth_existing_session", "uyarı", {
                message: "Farklı kullanıcı oturumu kapatıldı.",
                active_email: activeEmail,
            });
        }

        if (isCodeMode) {
            recordJoinStep("auth_sign_up", "başladı", { email: cleanEmail, role: activeInvite.role });
            const codeSignUpResult = await supabase.auth.signUp({
                email: cleanEmail,
                password,
                options: {
                    data: {
                        full_name: fullName.trim() || cleanEmail.split("@")[0],
                        role: activeInvite.role || "installer",
                    },
                },
            });

            if (!codeSignUpResult.error) {
                if (!codeSignUpResult.data.user) {
                    throw failJoinStep("auth_sign_up", new Error("Supabase kullanıcı kaydı oluşturamadı."));
                }

                recordJoinStep("auth_sign_up", "tamam", {
                    user_id: codeSignUpResult.data.user.id,
                    session_created: Boolean(codeSignUpResult.data.session),
                });

                if (!codeSignUpResult.data.session) {
                    throw failJoinStep(
                        "auth_sign_up",
                        new Error(
                            "Hesap oluşturuldu ancak Supabase e-posta doğrulaması istedi. Supabase Auth ayarlarında e-posta onayı kapalı olmalı ya da kullanıcı e-postasını onayladıktan sonra mevcut şifresiyle devam etmelidir.",
                        ),
                    );
                }

                return;
            }

            recordJoinStep("auth_sign_up", "uyarı", getErrorInfo(codeSignUpResult.error));

            if (!isAlreadyRegistered(codeSignUpResult.error)) {
                throw failJoinStep("auth_sign_up", codeSignUpResult.error);
            }

            recordJoinStep("auth_sign_in", "başladı", { email: cleanEmail });
            const existingSignInResult = await supabase.auth.signInWithPassword({
                email: cleanEmail,
                password,
            });

            if (existingSignInResult.error) {
                const resetSent = await sendPasswordResetForExistingUser(cleanEmail);
                throw failJoinStep(
                    "auth_sign_in",
                    new Error(
                        resetSent
                            ? "Bu e-posta daha önce kayıt olmuş. Girilen şifre mevcut hesapla eşleşmedi; şifre sıfırlama maili gönderildi. Şifrenizi sıfırladıktan sonra aynı e-posta ve davet koduyla tekrar deneyin."
                            : "Bu e-posta daha önce kayıt olmuş. Girilen şifre mevcut hesapla eşleşmedi; giriş ekranındaki Şifremi unuttum akışı ile şifrenizi sıfırlayın, sonra aynı e-posta ve davet koduyla tekrar deneyin.",
                    ),
                );
            }

            recordJoinStep("auth_sign_in", "tamam", { user_id: existingSignInResult.data.user?.id });
            return;
        }

        recordJoinStep("auth_sign_in", "başladı", { email: cleanEmail });
        const signInResult = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
        });

        if (!signInResult.error) {
            recordJoinStep("auth_sign_in", "tamam", { user_id: signInResult.data.user?.id });
            return;
        }

        recordJoinStep("auth_sign_in", "uyarı", getErrorInfo(signInResult.error));

        if (!shouldTrySignupAfterSignIn(signInResult.error)) {
            throw failJoinStep("auth_sign_in", signInResult.error);
        }

        recordJoinStep("auth_sign_up", "başladı", { email: cleanEmail, role: invite?.role });
        const signUpResult = await supabase.auth.signUp({
            email: cleanEmail,
            password,
            options: {
                data: {
                    full_name: fullName.trim() || cleanEmail.split("@")[0],
                    role: activeInvite.role || "installer",
                },
            },
        });

        if (signUpResult.error) {
            if (isAlreadyRegistered(signUpResult.error)) {
                throw failJoinStep(
                    "auth_sign_up",
                    new Error("Bu e-posta zaten kayıtlı. Mevcut şifrenizle giriş yaparak daveti kabul edin."),
                );
            }
            throw failJoinStep("auth_sign_up", signUpResult.error);
        }

        if (!signUpResult.data.user) {
            throw failJoinStep("auth_sign_up", new Error("Supabase kullanıcı kaydı oluşturamadı."));
        }

        recordJoinStep("auth_sign_up", "tamam", {
            user_id: signUpResult.data.user.id,
            session_created: Boolean(signUpResult.data.session),
        });

        if (!signUpResult.data.session) {
            throw failJoinStep(
                "auth_sign_up",
                new Error(
                    "Hesap oluşturuldu ancak Supabase e-posta doğrulaması istedi. E-postayı doğruladıktan sonra aynı davet bağlantısından mevcut şifrenizle devam edin.",
                ),
            );
        }
    }

    async function handleJoin(e: React.FormEvent) {
        e.preventDefault();
        if (loading) return;

        setErr("");
        setJoinDebug(null);
        setJoinTrace([]);

        if (!isCodeMode && (!invite || !inviteState.usable)) {
            setErr(inviteState.message || "Davet doğrulanamadı.");
            return;
        }

        const cleanEmail = email.trim().toLocaleLowerCase("tr-TR");
        if (!cleanEmail) return setErr("E-posta zorunlu.");
        if (isCodeMode && !inviteCode.trim()) return setErr("Davet kodu zorunlu.");
        if (!isCodeMode && invite && cleanEmail !== invite.email.trim().toLocaleLowerCase("tr-TR")) {
            setErr("Bu davet farklı bir e-posta adresi için oluşturulmuş. Lütfen davetteki e-posta ile devam edin.");
            return;
        }

        if (password.length < 6) {
            setErr("Şifre en az 6 karakter olmalı.");
            return;
        }

        setLoading(true);

        try {
            const activeInvite = isCodeMode ? await lookupInviteByCode(cleanEmail) : invite;
            if (!activeInvite) throw failJoinStep("invite_lookup", new Error("Davet doğrulanamadı."));
            if (activeInvite.used_at) throw failJoinStep("invite_lookup", new Error("Bu davet daha önce kullanılmış."));
            if (new Date(activeInvite.expires_at).getTime() < Date.now()) throw failJoinStep("invite_lookup", new Error("Bu davetin süresi dolmuş."));
            if (cleanEmail !== activeInvite.email.trim().toLocaleLowerCase("tr-TR")) {
                throw failJoinStep("invite_lookup", new Error("Bu davet farklı bir e-posta adresi için oluşturulmuş."));
            }
            await authenticateInviteUser(cleanEmail, activeInvite);
            await verifySessionEmail(cleanEmail);
            await acceptInviteForCurrentUser();

            setSuccess(true);
            window.setTimeout(() => nav("/app/dashboard", { replace: true }), 1500);
        } catch (e: unknown) {
            const joinError = e as JoinFlowError;
            const step = joinError.joinStep;
            setErr(friendlySignupError(joinError.originalMessage || joinError.message, step));
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
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xl overflow-hidden">
                <div className="bg-slate-900 p-8 text-white">
                    <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center mb-4">
                        <ShieldCheck className="w-7 h-7" />
                    </div>
                    <h1 className="text-2xl font-black">Kodla Katıl</h1>
                    <p className="opacity-75 mt-2 text-sm">
                        E-posta adresiniz ve davet kodunuzla kendi Şifrenizi belirleyin.
                    </p>
                </div>

                <div className="p-7 space-y-5">
                    {err ? (
                        <div className="space-y-3">
                            <div className="p-4 bg-red-50 text-red-700 rounded-2xl text-sm font-semibold border border-red-100 flex items-start gap-2">
                                <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
                                <span>{err}</span>
                            </div>

                            {joinDebug ? (
                                <div className="rounded-2xl border border-red-100 bg-red-50/60 p-4 text-xs text-red-800 space-y-1">
                                    <div>
                                        <span className="font-black">Teknik aşama:</span> {joinDebug.label}
                                    </div>
                                    <div>
                                        <span className="font-black">Orijinal hata:</span> {joinDebug.message}
                                    </div>
                                    {joinDebug.code || joinDebug.status ? (
                                        <div>
                                            <span className="font-black">Kod:</span> {joinDebug.code || "-"}{" "}
                                            <span className="font-black">Durum:</span> {joinDebug.status || "-"}
                                        </div>
                                    ) : null}
                                    {joinDebug.details ? <div>Detay: {joinDebug.details}</div> : null}
                                    {joinDebug.hint ? <div>İpucu: {joinDebug.hint}</div> : null}
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {joinTrace.length ? (
                        <details className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-xs text-slate-500 dark:text-slate-300">
                            <summary className="cursor-pointer font-bold text-slate-700 dark:text-slate-100">
                                Join işlem adımları
                            </summary>
                            <div className="mt-2 space-y-1">
                                {joinTrace.map((line) => (
                                    <div key={line}>{line}</div>
                                ))}
                            </div>
                        </details>
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
                                    disabled={loading || !inviteState.usable}
                                    required
                                />
                            </div>
                        </label>

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
                                    disabled={loading || !inviteState.usable}
                                    required
                                    minLength={6}
                                />
                            </div>
                        </label>

                        <button
                            type="submit"
                            disabled={loading || !inviteState.usable}
                            className="w-full h-12 rounded-2xl bg-primary-600 hover:bg-primary-700 text-white font-black shadow-lg shadow-primary-600/20 transition inline-flex items-center justify-center gap-2 disabled:opacity-60"
                        >
                            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                            {loading ? "Hesap hazırlanıyor..." : "Kodu Onayla ve Şifreyi Belirle"}
                        </button>
                    </form>

                    <button
                        type="button"
                        onClick={() => nav("/login")}
                        className="w-full text-sm font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white"
                    >
                        Zaten hesabım var, girişe dön
                    </button>
                </div>
            </div>
        </div>
    );
}
