import { useMemo, useState } from "react";
import { Building2, CheckCircle2, Loader2, Search, X } from "lucide-react";

import { supabase } from "../supabaseClient";

type CompanyOption = { id: string; name: string };

type ExistingMembership = { company_id: string; company_name: string; role: string };

type AssignResult = {
    status: "linked" | "already_member" | "requires_confirmation" | "invited";
    existing_memberships?: ExistingMembership[];
    invite_code?: string;
    expires_at?: string;
    reused?: boolean;
    account_exists?: boolean;
    role?: string;
};

const ROLE_OPTIONS = [
    { value: "admin", label: "Yönetici (admin)" },
    { value: "accountant", label: "Muhasebe" },
    { value: "installer", label: "Montaj" },
    { value: "measurement", label: "Ölçü" },
];

const ROLE_LABEL: Record<string, string> = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(raw: string) {
    // Bosluklar (basta/sonda/ortada) temizlenir; esleme sunucuda buyuk/kucuk harfe duyarsiz yapilir.
    return raw.replace(/\s+/g, "").toLowerCase();
}

function normalizeText(value: string) {
    return value.toLocaleLowerCase("tr-TR").normalize("NFC");
}

/**
 * Süper Admin: e-posta + firma + rol zorunlu. Firma adıyla aranır; sunucuya yalnızca seçilen
 * firmanın ID'si gider. Mevcut doğrulanmış hesap firmaya bağlanır, hesap yoksa bekleyen davet tutulur.
 */
export default function AssignUserToCompanyModal({
    companies,
    initialCompanyId,
    onClose,
    onDone,
}: {
    companies: CompanyOption[];
    initialCompanyId?: string | null;
    onClose: () => void;
    onDone: () => void | Promise<void>;
}) {
    const [companyQuery, setCompanyQuery] = useState("");
    const [companyId, setCompanyId] = useState<string | null>(initialCompanyId ?? null);
    const [email, setEmail] = useState("");
    const [role, setRole] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [result, setResult] = useState<AssignResult | null>(null);

    const selectedCompany = companies.find((c) => c.id === companyId) ?? null;
    const matches = useMemo(() => {
        const q = normalizeText(companyQuery.trim());
        if (!q) return companies.slice(0, 8);
        return companies.filter((c) => normalizeText(c.name).includes(q)).slice(0, 8);
    }, [companies, companyQuery]);

    const cleanEmail = normalizeEmail(email);
    const valid = Boolean(companyId) && EMAIL_RE.test(cleanEmail) && Boolean(role);

    async function submit(confirmOther: boolean) {
        if (busy || !valid || !companyId) return;
        setBusy(true);
        setError("");
        try {
            const { data, error: rpcError } = await supabase.rpc("super_admin_assign_user_to_company", {
                p_email: cleanEmail,
                p_company_id: companyId,
                p_role: role,
                p_confirm_other_memberships: confirmOther,
            });
            if (rpcError) throw rpcError;
            const res = data as AssignResult | null;
            if (!res?.status) throw new Error("Sunucu yanıtı doğrulanamadı; işlem tamamlanmış sayılmadı.");
            setResult(res);
            if (res.status === "linked" || res.status === "invited") await onDone();
        } catch (e) {
            setResult(null);
            const message = e instanceof Error ? e.message : String((e as { message?: string })?.message || "");
            setError(message || "Kullanıcı firmaya bağlanamadı.");
        } finally {
            setBusy(false);
        }
    }

    function reset() {
        setResult(null);
        setError("");
        setEmail("");
    }

    const companyLabel = selectedCompany?.name ?? "";
    const roleLabel = ROLE_LABEL[role] ?? role;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900">
                <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                        <h2 className="text-xl font-black text-slate-900 dark:text-white">Kullanıcıyı Firmaya Bağla</h2>
                        <p className="mt-1 text-sm text-slate-500">E-posta, firma ve rol zorunludur. Mevcut şifre ve diğer firma üyelikleri değiştirilmez.</p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Kapat" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                        <X size={18} />
                    </button>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Firma *</label>
                        {selectedCompany ? (
                            <div className="mt-1.5 flex items-center justify-between gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
                                <span className="inline-flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-200">
                                    <Building2 size={16} /> {selectedCompany.name}
                                </span>
                                {!result && (
                                    <button type="button" className="text-xs font-bold text-slate-500 underline" onClick={() => setCompanyId(null)} disabled={busy}>
                                        Değiştir
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="mt-1.5">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                    <input
                                        value={companyQuery}
                                        onChange={(e) => setCompanyQuery(e.target.value)}
                                        placeholder="Firma adıyla ara..."
                                        className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-800"
                                    />
                                </div>
                                <ul className="mt-2 max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-2xl border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700">
                                    {matches.length === 0 ? (
                                        <li className="px-3 py-2 text-slate-500">Eşleşen firma yok. Önce firmayı oluşturun.</li>
                                    ) : (
                                        matches.map((c) => (
                                            <li key={c.id}>
                                                <button type="button" onClick={() => setCompanyId(c.id)} className="w-full px-3 py-2 text-left font-semibold hover:bg-slate-50 dark:hover:bg-slate-800">
                                                    {c.name}
                                                </button>
                                            </li>
                                        ))
                                    )}
                                </ul>
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500" htmlFor="assign-email">E-posta *</label>
                        <input
                            id="assign-email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            type="email"
                            inputMode="email"
                            autoCapitalize="none"
                            autoCorrect="off"
                            placeholder="kullanici@ornek.com"
                            disabled={busy || Boolean(result)}
                            className="mt-1.5 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-800"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500" htmlFor="assign-role">Rol *</label>
                        <select
                            id="assign-role"
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            disabled={busy || Boolean(result)}
                            className="mt-1.5 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-800"
                        >
                            <option value="">Rol seçin</option>
                            {ROLE_OPTIONS.map((r) => (
                                <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                        </select>
                    </div>

                    {error ? (
                        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
                            İşlem tamamlanmadı: {error}
                        </div>
                    ) : null}

                    {result?.status === "requires_confirmation" ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
                            <p className="font-bold text-amber-900 dark:text-amber-100">Bu hesap başka firmalara zaten bağlı. Mevcut üyelikleri korunacak, taşınmayacak:</p>
                            <ul className="mt-2 list-disc pl-5 text-amber-900 dark:text-amber-100">
                                {(result.existing_memberships ?? []).map((m) => (
                                    <li key={m.company_id}>{m.company_name} — {ROLE_LABEL[m.role] ?? m.role}</li>
                                ))}
                            </ul>
                            <button
                                type="button"
                                onClick={() => void submit(true)}
                                disabled={busy}
                                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-amber-600 px-3 py-2 text-xs font-black text-white hover:bg-amber-700 disabled:opacity-60"
                            >
                                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                                Mevcut üyelikleri koruyarak {companyLabel} firmasına da ekle
                            </button>
                        </div>
                    ) : null}

                    {result?.status === "linked" || result?.status === "already_member" ? (
                        <div role="status" className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                            <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
                            <span>
                                {result.status === "already_member"
                                    ? `${cleanEmail} zaten ${companyLabel} firmasında ${roleLabel} olarak kayıtlı; değişiklik yapılmadı.`
                                    : `${cleanEmail}, ${companyLabel} firmasına ${roleLabel} olarak bağlandı. Mevcut şifresi ve diğer firma üyelikleri korunmuştur; tekrar kayıt veya davet kodu gerekmez.`}
                            </span>
                        </div>
                    ) : null}

                    {result?.status === "invited" ? (
                        <div role="status" className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm dark:border-sky-900 dark:bg-sky-950/30">
                            <p className="font-bold text-sky-900 dark:text-sky-100">
                                {result.account_exists
                                    ? "Bu e-postanın hesabı henüz doğrulanmamış; erişim verilmedi, bekleyen davet kaydedildi."
                                    : "Bu e-postaya ait hesap yok; bekleyen davet kaydedildi, erişim verilmedi."}
                            </p>
                            <p className="mt-1 text-sky-900 dark:text-sky-100">
                                Kullanıcı bu e-postayla kayıt olup e-postasını doğruladığında {companyLabel} firmasına {roleLabel} olarak otomatik eklenir. İsterse davet koduyla da katılabilir.
                                {result.reused ? " (Aynı bekleyen davet yeniden kullanıldı; yeni kayıt oluşturulmadı.)" : ""}
                            </p>
                            {result.invite_code ? (
                                <p className="mt-2 font-mono text-lg font-black tracking-widest text-sky-900 dark:text-sky-100">{result.invite_code}</p>
                            ) : null}
                        </div>
                    ) : null}
                </div>

                <div className="mt-6 flex flex-wrap justify-end gap-2">
                    {result && result.status !== "requires_confirmation" ? (
                        <button type="button" onClick={reset} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                            Başka kullanıcı ekle
                        </button>
                    ) : null}
                    <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                        Kapat
                    </button>
                    {!result ? (
                        <button
                            type="button"
                            onClick={() => void submit(false)}
                            disabled={!valid || busy}
                            className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                            Kullanıcıyı bağla
                        </button>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
