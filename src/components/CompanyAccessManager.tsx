import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Copy, History, Loader2, ShieldCheck, ShieldOff, Timer, X } from "lucide-react";
import { formatTrialDateTR } from "../utils/trialLicense";
import {
    ACCESS_ACTION_LABELS,
    type AccessChangeResult,
    type CompanyAccessDetail,
    accessErrorMessage,
    addTrialDays,
    copyText,
    endTrialNow,
    getCompanyAccess,
    isoToIstanbulInput,
    istanbulInputToIso,
    previewAddDays,
    setSpecialAccess,
    setTrialEnd,
} from "../utils/superAdminAccess";

type Props = {
    companyId: string;
    /** Liste satırındaki ad — yalnızca yüklenene kadar başlıkta gösterilir. */
    companyName?: string | null;
    onClose: () => void;
    /** Başarılı her işlemden sonra çağrılır (liste/detay yenilemesi için). */
    onChanged?: () => void | Promise<void>;
};

type PendingAction = {
    title: string;
    lines: string[];
    danger?: boolean;
    /** Doluysa kullanıcı firma adını birebir yazmadan onay verilemez. */
    requireName?: boolean;
    confirmLabel: string;
    run: (typedName: string) => Promise<AccessChangeResult>;
    successText: (result: AccessChangeResult) => string;
};

const PLAN_LABELS: Record<string, string> = {
    trial: "Deneme",
    active: "Ücretli (aktif)",
    lifetime: "Süresiz lisans",
    expired: "Süresi dolmuş",
    suspended: "Askıda",
};

function fmt(iso: string | null | undefined): string {
    return iso ? formatTrialDateTR(iso, { withTime: true }) : "—";
}

function remainingText(iso: string | null | undefined, serverTime: string | null | undefined): string {
    if (!iso) return "Bitiş tarihi yok";
    const now = serverTime ? new Date(serverTime).getTime() : Date.now();
    const diff = new Date(iso).getTime() - now;
    if (diff <= 0) return "Süresi dolmuş";
    const hours = Math.floor(diff / 3600000);
    if (hours < 24) return `${hours} saat kaldı`;
    return `${Math.floor(hours / 24)} gün ${hours % 24} saat kaldı`;
}

const inputClass =
    "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 focus:border-indigo-500 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
const sectionClass = "rounded-2xl border border-slate-200 p-4 dark:border-slate-800";
const primaryBtn =
    "inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-black text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50";
const dangerBtn =
    "inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-black text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300";

export default function CompanyAccessManager({ companyId, companyName, onClose, onChanged }: Props) {
    const [detail, setDetail] = useState<CompanyAccessDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
    const [pending, setPending] = useState<PendingAction | null>(null);
    const [typedName, setTypedName] = useState("");
    const [copied, setCopied] = useState(false);

    const [endInput, setEndInput] = useState("");
    const [daysInput, setDaysInput] = useState(7);
    const [reason, setReason] = useState("");
    const [specialMode, setSpecialMode] = useState<"unlimited" | "until">("unlimited");
    const [specialUntil, setSpecialUntil] = useState("");
    const [specialNote, setSpecialNote] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError("");
        try {
            const data = await getCompanyAccess(companyId);
            setDetail(data);
            setEndInput(isoToIstanbulInput(data.trial_ends_at));
            setSpecialMode(data.is_pilot && data.pilot_until ? "until" : "unlimited");
            setSpecialUntil(isoToIstanbulInput(data.pilot_until));
            setSpecialNote(data.pilot_note || "");
        } catch (error) {
            setDetail(null);
            setLoadError(accessErrorMessage(error, "Firma erişim bilgisi yüklenemedi."));
        } finally {
            setLoading(false);
        }
    }, [companyId]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape" && !busyRef.current) onClose();
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const name = detail?.name ?? companyName ?? "İsimsiz firma";
    const plan = String(detail?.plan_status ?? "").toLowerCase();
    const trialApplicable = Boolean(detail) && plan !== "active" && plan !== "lifetime" && plan !== "suspended" && detail?.is_active !== false;
    const trialEndedAlready = detail?.trial_ends_at ? new Date(detail.trial_ends_at).getTime() <= Date.now() : true;
    const preview = previewAddDays(detail?.trial_ends_at ?? null, Number.isFinite(daysInput) ? daysInput : 0);
    const cleanReason = reason.trim() || null;

    function ask(action: PendingAction) {
        setNotice(null);
        setTypedName("");
        setPending(action);
    }

    async function confirmPending() {
        if (!pending || busyRef.current) return;
        if (pending.requireName && typedName !== (detail?.name ?? "")) return;
        busyRef.current = true;
        setBusy(true);
        setNotice(null);
        const action = pending;
        try {
            const result = await action.run(typedName);
            setPending(null);
            setReason("");
            setNotice({ tone: "success", text: action.successText(result) });
            await load();
            try {
                await onChanged?.();
            } catch {
                // liste yenilemesi başarısız olsa da işlem sunucuda tamamlandı
            }
        } catch (error) {
            setNotice({ tone: "error", text: accessErrorMessage(error) });
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    const targetLines = detail ? [`Firma: ${detail.name ?? "İsimsiz"}`, `Firma ID: ${detail.company_id}`] : [];

    function requestSetEnd() {
        const iso = istanbulInputToIso(endInput);
        if (!iso) {
            setNotice({ tone: "error", text: "Geçerli bir bitiş tarihi ve saati seçin." });
            return;
        }
        const inPast = new Date(iso).getTime() <= Date.now();
        ask({
            title: "Deneme bitişini değiştir",
            lines: [
                ...targetLines,
                `Mevcut bitiş: ${fmt(detail?.trial_ends_at)}`,
                `Yeni bitiş: ${fmt(iso)} (Türkiye saati)`,
                inPast
                    ? "Seçilen an geçmişte: firma hemen salt okunur olur, veriler silinmez."
                    : "Firma bu ana kadar yazma yetkisiyle kullanabilir.",
            ],
            danger: inPast,
            confirmLabel: "Bitişi kaydet",
            run: () => setTrialEnd(companyId, iso, cleanReason),
            successText: (r) => `Deneme bitişi güncellendi: ${fmt(r.after.trial_ends_at)}.`,
        });
    }

    function requestAddDays() {
        const days = Math.trunc(daysInput);
        if (!Number.isFinite(days) || days < 1 || days > 365) {
            setNotice({ tone: "error", text: "Eklenecek gün 1 ile 365 arasında olmalı." });
            return;
        }
        const p = previewAddDays(detail?.trial_ends_at ?? null, days);
        ask({
            title: `Deneme süresine ${days} gün ekle`,
            lines: [
                ...targetLines,
                `Mevcut bitiş: ${fmt(detail?.trial_ends_at)}`,
                p.base === "mevcut_bitis"
                    ? `Süre dolmadığı için mevcut bitişe eklenecek → yaklaşık ${fmt(p.newEnd.toISOString())}`
                    : `Süre dolmuş (veya bitiş yok) olduğu için şu andan itibaren eklenecek → yaklaşık ${fmt(p.newEnd.toISOString())}`,
                "Kesin tarih sunucu saatine göre hesaplanır.",
            ],
            confirmLabel: `${days} gün ekle`,
            run: () => addTrialDays(companyId, days, cleanReason),
            successText: (r) => `${days} gün eklendi. Yeni bitiş: ${fmt(r.after.trial_ends_at)}.`,
        });
    }

    function requestEndNow() {
        ask({
            title: "Denemeyi şimdi bitir",
            lines: [
                ...targetLines,
                `Mevcut bitiş: ${fmt(detail?.trial_ends_at)}`,
                "Sonuç: deneme hemen sona erer, firma SALT OKUNUR olur.",
                "Veriler silinmez; kullanıcılar kayıtlarını görmeye devam eder ama yeni kayıt/düzenleme yapamaz.",
                "Süre uzatılırsa veya özel erişim verilirse yazma yetkisi geri gelir.",
                ...(detail?.special_access_active
                    ? ["DİKKAT: Firmanın özel erişimi aktif; özel erişim kaldırılana kadar yazma açık kalır."]
                    : []),
            ],
            danger: true,
            requireName: true,
            confirmLabel: "Denemeyi bitir",
            run: (typed) => endTrialNow(companyId, typed, cleanReason),
            successText: (r) => `Deneme bitirildi (${fmt(r.after.trial_ends_at)}). Firma salt okunur.`,
        });
    }

    function requestGrantSpecial() {
        const note = specialNote.trim();
        if (note.length < 3) {
            setNotice({ tone: "error", text: "Özel erişim için kısa bir açıklama yazın (en az 3 karakter)." });
            return;
        }
        let untilIso: string | null = null;
        if (specialMode === "until") {
            untilIso = istanbulInputToIso(specialUntil);
            if (!untilIso || new Date(untilIso).getTime() <= Date.now()) {
                setNotice({ tone: "error", text: "Özel erişim bitişi gelecekte bir tarih/saat olmalı." });
                return;
            }
        }
        ask({
            title: detail?.is_pilot ? "Özel erişimi güncelle" : "Özel erişim ver",
            lines: [
                ...targetLines,
                untilIso ? `Süreli: ${fmt(untilIso)} tarihine kadar (Türkiye saati)` : "Süresiz (siz kaldırana kadar)",
                `Açıklama: ${note}`,
                "Bu bir ödeme veya abonelik kaydı DEĞİLDİR; paket/plan/ödeme alanları değişmez.",
                "Deneme bitiş tarihi ve tek seferlik ücretsiz deneme hakkı değişmez.",
            ],
            confirmLabel: detail?.is_pilot ? "Güncelle" : "Özel erişim ver",
            run: () => setSpecialAccess(companyId, true, untilIso, note),
            successText: (r) =>
                r.after.pilot_until ? `Özel erişim verildi: ${fmt(r.after.pilot_until)} tarihine kadar.` : "Süresiz özel erişim verildi.",
        });
    }

    function requestRevokeSpecial() {
        ask({
            title: "Özel erişimi kaldır",
            lines: [
                ...targetLines,
                `Deneme bitişi: ${fmt(detail?.trial_ends_at)}`,
                "Sonuç: firma artık normal deneme/abonelik kurallarına tabi olur. Denemesi bitmişse salt okunur olur; veriler silinmez.",
            ],
            danger: true,
            confirmLabel: "Özel erişimi kaldır",
            run: () => setSpecialAccess(companyId, false, null, specialNote.trim() || null),
            successText: (r) => (r.after.writable ? "Özel erişim kaldırıldı. Firma yazabilir durumda." : "Özel erişim kaldırıldı. Firma salt okunur."),
        });
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-950/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Süre ve özel erişim yönetimi">
            <div className="relative w-full max-w-3xl rounded-3xl bg-white shadow-2xl dark:bg-slate-950">
                <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                    <div className="min-w-0">
                        <div className="text-xs font-black uppercase tracking-wider text-indigo-600">Süre ve Özel Erişim</div>
                        <div className="truncate text-lg font-black text-slate-900 dark:text-white">{name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span className="font-mono break-all">ID: {companyId}</span>
                            <button
                                type="button"
                                onClick={async () => {
                                    const ok = await copyText(companyId);
                                    setCopied(ok);
                                    window.setTimeout(() => setCopied(false), 1500);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-0.5 font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                            >
                                <Copy className="h-3 w-3" />
                                {copied ? "Kopyalandı" : "Kopyala"}
                            </button>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} disabled={busy} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-900" aria-label="Kapat">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="space-y-4 p-5">
                    {loading && !detail ? (
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
                            <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor...
                        </div>
                    ) : null}
                    {loadError ? (
                        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{loadError}</div>
                    ) : null}

                    {notice ? (
                        <div
                            role="status"
                            className={`flex items-start gap-2 rounded-2xl border p-3 text-sm font-semibold ${
                                notice.tone === "success"
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200"
                                    : "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                            }`}
                        >
                            {notice.tone === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                            <span>{notice.text}</span>
                        </div>
                    ) : null}

                    {detail ? (
                        <>
                            {/* Hedef firma kimliği */}
                            <div className={sectionClass}>
                                <div className="text-xs font-black uppercase tracking-wider text-slate-400">Firma yöneticileri</div>
                                {detail.admins.length === 0 ? (
                                    <div className="mt-2 text-sm font-semibold text-amber-700">Bu firmada yönetici üyeliği bulunamadı.</div>
                                ) : (
                                    <ul className="mt-2 space-y-1 text-sm">
                                        {detail.admins.map((a) => (
                                            <li key={a.user_id} className="flex flex-wrap items-center gap-2">
                                                <span className="font-bold text-slate-800 dark:text-slate-100">{a.email || "(e-posta yok)"}</span>
                                                {a.full_name ? <span className="text-slate-500">{a.full_name}</span> : null}
                                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">{a.role === "owner" ? "Sahip" : "Yönetici"}</span>
                                                {!a.is_active ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-black text-red-700">Pasif</span> : null}
                                                {a.is_owner_id ? <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-black text-indigo-700">Kayıtlı sahip</span> : null}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                {detail.owner_email && detail.owner_is_admin_member === false ? (
                                    <div className="mt-2 text-xs font-semibold text-amber-700">
                                        Firma kaydındaki sahip alanı {detail.owner_email} adresini gösteriyor, ancak bu kişi firmada yönetici değil; sahip olarak gösterilmedi.
                                    </div>
                                ) : null}
                            </div>

                            {/* Mevcut durum */}
                            <div className={`${sectionClass} grid grid-cols-1 gap-2 text-sm sm:grid-cols-2`}>
                                <div>Durum: <b>{PLAN_LABELS[plan] || detail.plan_status || "—"}</b></div>
                                <div>
                                    Yazma:{" "}
                                    {detail.writable ? <b className="text-emerald-700">Açık</b> : <b className="text-red-700">Salt okunur</b>}
                                </div>
                                <div className="sm:col-span-2">
                                    Deneme bitişi: <b>{fmt(detail.trial_ends_at)}</b>{" "}
                                    <span className="text-slate-500">({remainingText(detail.trial_ends_at, detail.server_time)})</span>
                                </div>
                                <div className="sm:col-span-2">
                                    Özel erişim:{" "}
                                    {detail.special_access_active ? (
                                        <b className="text-violet-700">{detail.pilot_until ? `Süreli — ${fmt(detail.pilot_until)} tarihine kadar` : "Süresiz"}</b>
                                    ) : detail.is_pilot ? (
                                        <b className="text-slate-500">Süresi dolmuş ({fmt(detail.pilot_until)})</b>
                                    ) : (
                                        <b className="text-slate-500">Yok</b>
                                    )}
                                    {detail.pilot_note ? <span className="text-slate-500"> — {detail.pilot_note}</span> : null}
                                </div>
                                {plan === "active" || plan === "lifetime" ? (
                                    <div className="sm:col-span-2">Lisans bitişi: <b>{detail.license_expires_at ? fmt(detail.license_expires_at) : "Süresiz"}</b></div>
                                ) : null}
                                <div className="sm:col-span-2 text-xs text-slate-500">
                                    Ücretsiz deneme hakkı:{" "}
                                    {detail.free_trial_used
                                        ? `Kullanıldı (${fmt(detail.free_trial_used.trial_started_at)}). Süre değişiklikleri bu hakkı sıfırlamaz.`
                                        : "Bu firma için kayıtlı ücretsiz deneme hakkı yok (davetle/elle açılmış olabilir)."}
                                    {" "}Sunucu saati: {fmt(detail.server_time)}
                                </div>
                            </div>

                            {/* Deneme süresi */}
                            {!trialApplicable ? (
                                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                                    {plan === "active" || plan === "lifetime"
                                        ? "Bu firmanın ücretli/süresiz lisansı var; deneme süresi uygulanmaz. Lisansı Lisans Yönetimi ekranından yönetin."
                                        : "Firma askıda veya pasif. Deneme süresi değiştirilemez."}
                                </div>
                            ) : (
                                <>
                                    <label className="block">
                                        <span className="text-xs font-black uppercase tracking-wider text-slate-400">İşlem notu (isteğe bağlı, geçmişe yazılır)</span>
                                        <input value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} maxLength={300} className={`${inputClass} mt-1`} placeholder="Örn. müşteri talebi, demo görüşmesi" />
                                    </label>

                                    <div className={sectionClass}>
                                        <div className="flex items-center gap-2 font-black text-slate-900 dark:text-white">
                                            <CalendarClock className="h-4 w-4 text-indigo-600" /> Deneme bitişini ayarla
                                        </div>
                                        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                                            <input type="datetime-local" value={endInput} onChange={(e) => setEndInput(e.target.value)} disabled={busy} className={`${inputClass} sm:max-w-xs`} aria-label="Yeni deneme bitişi" />
                                            <span className="text-xs text-slate-500">Türkiye saati (UTC+3)</span>
                                            <button type="button" onClick={requestSetEnd} disabled={busy || !endInput} className={`${primaryBtn} sm:ml-auto`}>
                                                Bitişi Kaydet
                                            </button>
                                        </div>
                                    </div>

                                    <div className={sectionClass}>
                                        <div className="flex items-center gap-2 font-black text-slate-900 dark:text-white">
                                            <Timer className="h-4 w-4 text-indigo-600" /> Gün ekle
                                        </div>
                                        <p className="mt-1 text-xs text-slate-500">
                                            Süre dolmamışsa günler <b>mevcut bitişe</b> eklenir. Süre dolmuşsa günler <b>şu andan itibaren</b> eklenir; geçmişte kalan günler geri verilmez.
                                        </p>
                                        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                                            <input
                                                type="number"
                                                min={1}
                                                max={365}
                                                value={Number.isFinite(daysInput) ? daysInput : ""}
                                                onChange={(e) => setDaysInput(Number(e.target.value))}
                                                disabled={busy}
                                                className={`${inputClass} sm:w-24`}
                                                aria-label="Eklenecek gün"
                                            />
                                            <span className="text-xs text-slate-500">
                                                {daysInput >= 1 && daysInput <= 365
                                                    ? `${preview.base === "mevcut_bitis" ? "Mevcut bitişten" : "Şu andan"} itibaren → yaklaşık ${fmt(preview.newEnd.toISOString())}`
                                                    : "1–365 gün"}
                                            </span>
                                            <button type="button" onClick={requestAddDays} disabled={busy} className={`${primaryBtn} sm:ml-auto`}>
                                                Gün Ekle
                                            </button>
                                        </div>
                                    </div>

                                    <div className={sectionClass}>
                                        <div className="flex items-center gap-2 font-black text-slate-900 dark:text-white">
                                            <Clock className="h-4 w-4 text-red-600" /> Denemeyi şimdi bitir
                                        </div>
                                        <p className="mt-1 text-xs text-slate-500">Veriler silinmez; firma salt okunur olur. Uzatma veya özel erişimle yazma yetkisi geri gelir.</p>
                                        <button type="button" onClick={requestEndNow} disabled={busy || trialEndedAlready} className={`${dangerBtn} mt-3`}>
                                            {trialEndedAlready ? "Deneme zaten bitmiş" : "Denemeyi şimdi bitir"}
                                        </button>
                                    </div>
                                </>
                            )}

                            {/* Özel erişim */}
                            <div className={sectionClass}>
                                <div className="flex items-center gap-2 font-black text-slate-900 dark:text-white">
                                    <ShieldCheck className="h-4 w-4 text-violet-600" /> Özel kullanım hakkı
                                </div>
                                <p className="mt-1 text-xs text-slate-500">
                                    Deneme/abonelik kilidinden muaf erişim verir. Ödeme veya abonelik kaydı oluşturmaz; paket, plan ve ödeme alanları ile WhatsApp satın alma yolu değişmez.
                                </p>
                                <div className="mt-3 flex flex-wrap gap-4 text-sm font-semibold">
                                    <label className="inline-flex items-center gap-2">
                                        <input type="radio" name="special-mode" checked={specialMode === "unlimited"} onChange={() => setSpecialMode("unlimited")} disabled={busy} />
                                        Süresiz
                                    </label>
                                    <label className="inline-flex items-center gap-2">
                                        <input type="radio" name="special-mode" checked={specialMode === "until"} onChange={() => setSpecialMode("until")} disabled={busy} />
                                        Belirli tarihe kadar
                                    </label>
                                </div>
                                {specialMode === "until" ? (
                                    <input type="datetime-local" value={specialUntil} onChange={(e) => setSpecialUntil(e.target.value)} disabled={busy} className={`${inputClass} mt-2 sm:max-w-xs`} aria-label="Özel erişim bitişi" />
                                ) : null}
                                <input value={specialNote} onChange={(e) => setSpecialNote(e.target.value)} disabled={busy} maxLength={300} className={`${inputClass} mt-2`} placeholder="Açıklama (zorunlu) — örn. pilot müşteri, iş ortağı" aria-label="Özel erişim açıklaması" />
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <button type="button" onClick={requestGrantSpecial} disabled={busy} className={primaryBtn}>
                                        <ShieldCheck className="h-4 w-4" />
                                        {detail.is_pilot ? "Özel erişimi güncelle" : "Özel erişim ver"}
                                    </button>
                                    {detail.is_pilot ? (
                                        <button type="button" onClick={requestRevokeSpecial} disabled={busy} className={dangerBtn}>
                                            <ShieldOff className="h-4 w-4" /> Özel erişimi kaldır
                                        </button>
                                    ) : null}
                                </div>
                            </div>

                            {/* Geçmiş */}
                            <div className={sectionClass}>
                                <div className="flex items-center gap-2 font-black text-slate-900 dark:text-white">
                                    <History className="h-4 w-4 text-slate-500" /> İşlem geçmişi
                                </div>
                                {detail.history.length === 0 ? (
                                    <div className="mt-2 text-sm text-slate-500">Bu ekrandan yapılmış işlem yok.</div>
                                ) : (
                                    <ul className="mt-2 space-y-2 text-xs">
                                        {detail.history.map((h, i) => (
                                            <li key={`${h.created_at}-${i}`} className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900">
                                                <div className="font-bold text-slate-800 dark:text-slate-100">
                                                    {ACCESS_ACTION_LABELS[h.action] || h.action} — {fmt(h.created_at)}
                                                </div>
                                                <div className="text-slate-500">
                                                    {h.actor_email || "—"}
                                                    {h.before || h.after ? ` · Bitiş: ${fmt(h.before?.trial_ends_at)} → ${fmt(h.after?.trial_ends_at)}` : ""}
                                                    {h.action.includes("SPECIAL_ACCESS")
                                                        ? ` · Özel erişim: ${h.after?.is_pilot ? (h.after?.pilot_until ? fmt(h.after.pilot_until) + " tarihine kadar" : "süresiz") : "yok"}`
                                                        : ""}
                                                    {h.reason ? ` · Not: ${h.reason}` : ""}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </>
                    ) : null}
                </div>

                {pending ? (
                    <div className="absolute inset-0 flex items-start justify-center rounded-3xl bg-slate-950/50 p-4 sm:items-center">
                        <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900">
                            <div className={`text-base font-black ${pending.danger ? "text-red-700" : "text-slate-900 dark:text-white"}`}>{pending.title}</div>
                            <ul className="mt-3 space-y-1 text-sm text-slate-700 dark:text-slate-200">
                                {pending.lines.map((line) => (
                                    <li key={line} className="break-words">{line}</li>
                                ))}
                            </ul>
                            {pending.requireName ? (
                                <label className="mt-3 block text-sm">
                                    <span className="font-semibold text-slate-600 dark:text-slate-300">
                                        Onaylamak için firma adını aynen yazın: <b className="select-all">{detail?.name}</b>
                                    </span>
                                    <input value={typedName} onChange={(e) => setTypedName(e.target.value)} disabled={busy} className={`${inputClass} mt-1`} autoFocus aria-label="Firma adı teyidi" />
                                </label>
                            ) : null}
                            <div className="mt-4 flex justify-end gap-2">
                                <button type="button" onClick={() => setPending(null)} disabled={busy} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300">
                                    Vazgeç
                                </button>
                                <button
                                    type="button"
                                    onClick={confirmPending}
                                    disabled={busy || (pending.requireName && typedName !== (detail?.name ?? ""))}
                                    className={pending.danger ? dangerBtn : primaryBtn}
                                >
                                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                    {busy ? "İşleniyor..." : pending.confirmLabel}
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
