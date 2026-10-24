import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Mail, RefreshCw, ShieldCheck, Trash2, UserCheck, UserPlus, UserX, Users } from "lucide-react";

import { supabase } from "../supabaseClient";
import { useAuth } from "../context/AuthContext";

/** Sahibin ekip uyesine verebilecegi moduller (sunucu da ayni listeyi dogrular: team_valid_modules). */
const MODULE_OPTIONS: Array<{ id: string; label: string }> = [
    { id: "customers", label: "Müşteriler" },
    { id: "measurements", label: "Ölçü, Teklif ve Randevular" },
    { id: "orders", label: "Siparişler" },
    { id: "installation", label: "Montajlar" },
    { id: "suppliers", label: "Tedarikçiler" },
    { id: "collections", label: "Tahsilat ve Ödemeler" },
    { id: "accounting", label: "Finans" },
    { id: "reports", label: "Raporlar" },
    { id: "expenses", label: "Giderler" },
    { id: "profit", label: "Kâr Analizi" },
    { id: "catalogs", label: "Kartela Yönetimi" },
    { id: "staff", label: "Personel" },
];

type TeamRow = {
    kind: "member" | "invite";
    user_id: string | null;
    invite_id: string | null;
    email: string;
    full_name: string | null;
    is_owner: boolean;
    is_active: boolean;
    allowed_modules: string[] | null;
    expires_at: string | null;
    joined_at: string | null;
};

const ERRORS: Record<string, string> = {
    OWNER_ONLY: "Bu işlemi yalnızca firma sahibi yapabilir.",
    MEMBER_LIMIT: "Kullanıcı sınırına ulaştınız. Yeni kullanıcı için önce birini kaldırın veya daveti iptal edin.",
    ALREADY_MEMBER: "Bu e-posta zaten firmanızın kullanıcısı.",
    EMAIL_INVALID: "Geçerli bir e-posta adresi girin.",
    MODULES_REQUIRED: "En az bir modül seçin.",
    MODULE_INVALID: "Geçersiz modül seçimi.",
    MODULE_NOT_IN_PLAN: "Seçilen modül paketinizde yok.",
    COMPANY_UNAVAILABLE: "Firma şu anda kullanıcı ekleyemiyor (lisans veya salt okunur mod).",
    MEMBER_INVALID: "Bu kullanıcı üzerinde değişiklik yapılamaz.",
    INVITE_INVALID: "Davet bulunamadı veya zaten kullanılmış.",
};

function friendly(message: string, fallback: string) {
    const hit = Object.keys(ERRORS).find((code) => message.includes(code));
    return hit ? ERRORS[hit] : fallback;
}

function formatDate(value: string | null) {
    if (!value) return "";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("tr-TR");
}

function moduleLabel(id: string) {
    return MODULE_OPTIONS.find((m) => m.id === id)?.label ?? id;
}

function ModulePicker({ options, value, onChange, disabled }: {
    options: Array<{ id: string; label: string }>;
    value: string[];
    onChange: (next: string[]) => void;
    disabled?: boolean;
}) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {options.map((option) => {
                const checked = value.includes(option.id);
                return (
                    <label key={option.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold cursor-pointer ${checked ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-200" : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}>
                        <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => onChange(checked ? value.filter((id) => id !== option.id) : [...value, option.id])}
                        />
                        {option.label}
                    </label>
                );
            })}
        </div>
    );
}

export default function TeamManagement() {
    const { companyId, company, enabledModules, readOnly, isOwner } = useAuth();
    const [rows, setRows] = useState<TeamRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [email, setEmail] = useState("");
    const [modules, setModules] = useState<string[]>([]);
    const [editing, setEditing] = useState<string | null>(null);
    const [editModules, setEditModules] = useState<string[]>([]);

    const options = useMemo(
        () => MODULE_OPTIONS.filter((option) => enabledModules.includes(option.id)),
        [enabledModules],
    );

    const load = useCallback(async () => {
        if (!companyId) return;
        setLoading(true);
        const { data, error: rpcError } = await supabase.rpc("list_company_team", { p_company_id: companyId });
        if (rpcError) setError(friendly(rpcError.message || "", "Kullanıcı listesi alınamadı."));
        else setRows((data ?? []) as TeamRow[]);
        setLoading(false);
    }, [companyId]);

    useEffect(() => { void load(); }, [load]);

    const members = rows.filter((row) => row.kind === "member");
    const invites = rows.filter((row) => row.kind === "invite");
    const used = members.filter((row) => row.is_active).length + invites.length;
    const limit = company?.max_users ?? null;
    const full = limit !== null && used >= limit;

    async function sendInvite(targetEmail: string, targetModules: string[]) {
        if (!companyId) return;
        setBusy(true);
        setError("");
        setNotice("");
        try {
            const { data, error: fnError } = await supabase.functions.invoke("team-invite", {
                body: { company_id: companyId, email: targetEmail, modules: targetModules },
            });
            let payload = data as { ok?: boolean; code?: string; message?: string; existing_account?: boolean } | null;
            if (fnError) {
                const response = (fnError as { context?: Response }).context;
                payload = response ? await response.json().catch(() => null) : null;
                if (!payload) throw new Error("Davet gönderilemedi. Bağlantınızı kontrol edip tekrar deneyin.");
            }
            if (!payload?.ok) throw new Error(payload?.message || "Davet gönderilemedi.");
            setNotice(payload.existing_account
                ? `${targetEmail} adresiyle zaten bir hesap var. Kullanıcı mevcut şifresiyle giriş yaptığında firmanıza katılır; şifresini hatırlamıyorsa giriş ekranından "Şifremi unuttum" seçeneğini kullanabilir.`
                : `Davet ${targetEmail} adresine gönderildi. Kullanıcı e-postadaki bağlantıdan şifresini belirleyip bu e-posta ile giriş yapar.`);
            setEmail("");
            setModules([]);
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Davet gönderilemedi.");
        } finally {
            setBusy(false);
        }
    }

    async function submitInvite(e: React.FormEvent) {
        e.preventDefault();
        const clean = email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return setError("Geçerli bir e-posta adresi girin.");
        if (modules.length === 0) return setError("Kullanıcının göreceği en az bir modül seçin.");
        await sendInvite(clean, modules);
    }

    async function run(action: () => PromiseLike<{ error: { message?: string } | null }>, okText: string, failText: string) {
        setBusy(true);
        setError("");
        setNotice("");
        const { error: actionError } = await action();
        if (actionError) setError(friendly(actionError.message || "", failText));
        else { setNotice(okText); await load(); }
        setBusy(false);
    }

    if (!isOwner) {
        return <div className="p-6 text-sm font-semibold text-slate-500">Kullanıcıları yalnızca firma sahibi yönetebilir.</div>;
    }

    return (
        <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
            <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-primary-50 dark:bg-primary-900/20 p-3 text-primary-600"><Users className="h-6 w-6" /></div>
                <div>
                    <h1 className="text-2xl font-black text-slate-900 dark:text-white">Kullanıcılar</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Ekibinizi e-posta ile davet edin. Kullanıcı yalnızca sizin yazdığınız e-posta ile katılabilir ve sizin seçtiğiniz modülleri görür.
                        Yaptığı tüm işlemler firmanızın verisine kaydolur.
                    </p>
                    {limit !== null ? (
                        <p className="mt-1 text-xs font-bold text-slate-500">Kullanıcı hakkı: {used} / {limit} (siz dahil)</p>
                    ) : null}
                </div>
            </div>

            {error ? <div role="alert" className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div> : null}
            {notice ? <div role="status" className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{notice}</div> : null}

            <form onSubmit={submitInvite} className="space-y-4 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
                <h2 className="flex items-center gap-2 text-lg font-black text-slate-900 dark:text-white"><UserPlus className="h-5 w-5" /> Yeni kullanıcı davet et</h2>
                <label className="block">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">E-posta</span>
                    <div className="relative mt-1.5">
                        <Mail className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                        <input
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            autoCapitalize="none"
                            placeholder="kullanici@firma.com"
                            disabled={busy || readOnly || full}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 outline-none focus:ring-2 focus:ring-primary-500 dark:border-slate-700 dark:bg-slate-800"
                        />
                    </div>
                </label>
                <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Göreceği modüller</span>
                    <div className="mt-1.5">
                        <ModulePicker options={options} value={modules} onChange={setModules} disabled={busy || readOnly || full} />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">Ayarlar, abonelik ve kullanıcı yönetimi yalnızca size açıktır.</p>
                </div>
                {full ? <p className="text-sm font-semibold text-amber-700">Kullanıcı hakkınız doldu. Yeni davet için bir kullanıcıyı kaldırın veya bekleyen daveti iptal edin.</p> : null}
                {readOnly ? <p className="text-sm font-semibold text-amber-700">Hesap salt okunur modda; kullanıcı eklenemez.</p> : null}
                <button type="submit" disabled={busy || readOnly || full} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary-600 px-6 font-black text-white shadow-lg shadow-primary-600/20 hover:bg-primary-700 disabled:opacity-60">
                    {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mail className="h-5 w-5" />}
                    Davet gönder
                </button>
            </form>

            <div className="space-y-3">
                <h2 className="text-lg font-black text-slate-900 dark:text-white">Ekip</h2>
                {loading ? <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor...</div> : null}

                {members.map((row) => (
                    <div key={row.user_id} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <div className="font-black text-slate-900 dark:text-white">{row.full_name || row.email}</div>
                                <div className="text-xs text-slate-500">{row.email}</div>
                            </div>
                            {row.is_owner ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700"><ShieldCheck className="h-4 w-4" /> Firma sahibi</span>
                            ) : (
                                <div className="flex items-center gap-2">
                                    {!row.is_active ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">Erişim kapalı</span> : null}
                                    <button type="button" disabled={busy || readOnly} onClick={() => { setEditing(editing === row.user_id ? null : row.user_id); setEditModules(row.allowed_modules ?? []); }} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200">Modüller</button>
                                    <button
                                        type="button"
                                        disabled={busy || readOnly}
                                        onClick={() => void run(
                                            () => supabase.rpc("update_team_member", { p_company_id: companyId, p_user_id: row.user_id, p_modules: null, p_is_active: !row.is_active }),
                                            row.is_active ? "Kullanıcının erişimi kapatıldı." : "Kullanıcının erişimi açıldı.",
                                            "İşlem yapılamadı.",
                                        )}
                                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                                    >
                                        {row.is_active ? <><UserX className="h-4 w-4" /> Erişimi kapat</> : <><UserCheck className="h-4 w-4" /> Erişimi aç</>}
                                    </button>
                                </div>
                            )}
                        </div>
                        {!row.is_owner && row.allowed_modules?.length ? (
                            <div className="mt-2 text-xs text-slate-500">Modüller: {row.allowed_modules.map(moduleLabel).join(", ")}</div>
                        ) : null}
                        {editing === row.user_id ? (
                            <div className="mt-3 space-y-3">
                                <ModulePicker options={options} value={editModules} onChange={setEditModules} disabled={busy} />
                                <button
                                    type="button"
                                    disabled={busy || editModules.length === 0}
                                    onClick={() => void run(
                                        () => supabase.rpc("update_team_member", { p_company_id: companyId, p_user_id: row.user_id, p_modules: editModules, p_is_active: null }),
                                        "Modüller güncellendi.",
                                        "Modüller güncellenemedi.",
                                    ).then(() => setEditing(null))}
                                    className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
                                >
                                    Kaydet
                                </button>
                            </div>
                        ) : null}
                    </div>
                ))}

                {invites.map((row) => (
                    <div key={row.invite_id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
                        <div>
                            <div className="font-black text-slate-900 dark:text-white">{row.email}</div>
                            <div className="text-xs text-slate-500">
                                Davet bekliyor · {row.expires_at && new Date(row.expires_at).getTime() < Date.now() ? "süresi doldu" : `son ${formatDate(row.expires_at)}`}
                                {row.allowed_modules?.length ? ` · ${row.allowed_modules.map(moduleLabel).join(", ")}` : ""}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button type="button" disabled={busy || readOnly} onClick={() => void sendInvite(row.email, row.allowed_modules ?? [])} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                                <RefreshCw className="h-4 w-4" /> Tekrar gönder
                            </button>
                            <button type="button" disabled={busy || readOnly} onClick={() => void run(() => supabase.rpc("revoke_team_invite", { p_invite_id: row.invite_id }), "Davet iptal edildi.", "Davet iptal edilemedi.")} className="inline-flex items-center gap-1 rounded-xl border border-red-200 px-3 py-2 text-xs font-bold text-red-600">
                                <Trash2 className="h-4 w-4" /> İptal
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
