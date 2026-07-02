import { useEffect, useState } from "react";
import {
    History,
    Wrench,
    Undo2,
    AlertTriangle,
    CheckCircle2,
    Loader,
    ChevronDown,
    ShieldAlert,
} from "lucide-react";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import {
    INTERVENTION_PRESETS,
    applyIntervention,
    revertIntervention,
    getInterventions,
    getCompanyActivity,
    type AdminIntervention,
    type CompanyActivity,
    type InterventionPreset,
} from "../utils/adminIntervention";

interface Props {
    companyId: string;
    companyName?: string;
    ticketId?: string | null;
    /** Talep kategorisine göre uygun ön ayarı seç (order, payment, ...) */
    defaultCategory?: string;
    /** Açıklamadan çıkarılan kayıt ID'si (varsa formu önceden doldurur) */
    suggestedRecordId?: string | null;
}

const CATEGORY_TO_PRESET: Record<string, string> = {
    order: "order_status",
    installation: "order_installer",
    payment: "payment",
    supplier: "supplier_cari",
    measurement: "measurement",
    customer: "customer",
};

function fmt(v: unknown): string {
    if (v === null || v === undefined || v === "") return "—";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
}

export default function AdminInterventionPanel({
    companyId,
    ticketId,
    defaultCategory,
    suggestedRecordId,
}: Props) {
    const [activity, setActivity] = useState<CompanyActivity[]>([]);
    const [interventions, setInterventions] = useState<AdminIntervention[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadErr, setLoadErr] = useState("");

    // Form durumu
    const initialPreset =
        INTERVENTION_PRESETS.find((p) => p.key === CATEGORY_TO_PRESET[defaultCategory ?? ""]) ??
        INTERVENTION_PRESETS[0];
    const [preset, setPreset] = useState<InterventionPreset>(initialPreset);
    const [recordId, setRecordId] = useState(suggestedRecordId ?? "");
    const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
    const [reason, setReason] = useState("");
    const [saving, setSaving] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [formMsg, setFormMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
    const [revertingId, setRevertingId] = useState<string | null>(null);

    async function loadAll() {
        setLoading(true);
        setLoadErr("");
        const [act, intr] = await Promise.all([
            getCompanyActivity(companyId, 40),
            getInterventions(companyId, { limit: 50 }),
        ]);
        if (act.success) setActivity(act.data);
        if (intr.success) setInterventions(intr.data);
        if (!act.success && !intr.success) {
            setLoadErr(
                /function|does not exist|schema cache/i.test(act.error)
                    ? "Müdahale altyapısı kurulu değil. supabase_admin_intervention_system.sql dosyasını SQL Editor'da çalıştırın."
                    : "İşlem geçmişi yüklenemedi."
            );
        }
        setLoading(false);
    }

    useEffect(() => {
        loadAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [companyId]);

    useEffect(() => {
        setRecordId(suggestedRecordId ?? "");
    }, [suggestedRecordId]);

    useEffect(() => {
        // Talep kategorisi değişince uygun ön ayara geç
        const next =
            INTERVENTION_PRESETS.find((p) => p.key === CATEGORY_TO_PRESET[defaultCategory ?? ""]) ??
            INTERVENTION_PRESETS[0];
        setPreset(next);
        setFieldValues({});
    }, [defaultCategory]);

    function buildChanges(): Record<string, unknown> | null {
        const changes: Record<string, unknown> = {};
        for (const f of preset.fields) {
            const raw = fieldValues[f.field];
            if (raw === undefined || raw === "") continue;
            if (f.type === "number") {
                const n = Number(raw);
                if (Number.isNaN(n)) {
                    setFormMsg({ kind: "err", text: `${f.label} sayısal olmalı.` });
                    return null;
                }
                changes[f.field] = n;
            } else if (f.field === "assigned_to" && raw.trim() === "") {
                changes[f.field] = null;
            } else {
                changes[f.field] = raw;
            }
        }
        // Montajcı atamasını kaldırma özel durumu: alan boş bırakıldıysa null gönder
        if (preset.key === "order_installer" && (fieldValues["assigned_to"] ?? "") === "") {
            changes["assigned_to"] = null;
        }
        return changes;
    }

    async function handleApply() {
        setFormMsg(null);
        if (!recordId.trim()) {
            setFormMsg({ kind: "err", text: `${preset.idLabel} girilmeli.` });
            return;
        }
        const changes = buildChanges();
        if (!changes) return;
        if (Object.keys(changes).length === 0) {
            setFormMsg({ kind: "err", text: "En az bir alan değiştirilmeli." });
            return;
        }
        if (!reason.trim()) {
            setFormMsg({ kind: "err", text: "Müdahale sebebi zorunludur (denetim için)." });
            return;
        }
        setSaving(true);
        const res = await applyIntervention({
            companyId,
            table: preset.table,
            recordId: recordId.trim(),
            changes,
            reason: reason.trim(),
            ticketId: ticketId ?? null,
        });
        setSaving(false);
        setConfirming(false);
        if (res.success) {
            setFormMsg({ kind: "ok", text: "Müdahale uygulandı ve loglandı." });
            setFieldValues({});
            setReason("");
            await loadAll();
        } else {
            setFormMsg({ kind: "err", text: res.error });
        }
    }

    async function handleRevert(id: string) {
        setRevertingId(id);
        const res = await revertIntervention(id);
        setRevertingId(null);
        if (res.success) {
            await loadAll();
        } else {
            alert(res.error);
        }
    }

    return (
        <div className="space-y-6">
            {/* Müdahale Formu */}
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-5 dark:border-indigo-900/40 dark:bg-indigo-950/20">
                <div className="mb-4 flex items-center gap-2">
                    <Wrench size={18} className="text-indigo-600" />
                    <h4 className="text-sm font-black uppercase tracking-widest text-indigo-700 dark:text-indigo-300">
                        Müşteri Adına Düzeltme
                    </h4>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase text-slate-400">İşlem Türü</label>
                        <div className="relative">
                            <select
                                value={preset.key}
                                onChange={(e) => {
                                    const p = INTERVENTION_PRESETS.find((x) => x.key === e.target.value);
                                    if (p) { setPreset(p); setFieldValues({}); setFormMsg(null); }
                                }}
                                className="w-full appearance-none rounded-xl border border-slate-200 bg-white p-3 pr-9 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
                            >
                                {INTERVENTION_PRESETS.map((p) => (
                                    <option key={p.key} value={p.key}>{p.label}</option>
                                ))}
                            </select>
                            <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase text-slate-400">{preset.idLabel}</label>
                        <input
                            value={recordId}
                            onChange={(e) => setRecordId(e.target.value)}
                            placeholder="UUID"
                            className="w-full rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs outline-none dark:border-slate-700 dark:bg-slate-900"
                        />
                    </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {preset.fields.map((f) => (
                        <div key={f.field} className="space-y-1">
                            <label className="text-[11px] font-bold uppercase text-slate-400">{f.label}</label>
                            {f.type === "select" ? (
                                <select
                                    value={fieldValues[f.field] ?? ""}
                                    onChange={(e) => setFieldValues((v) => ({ ...v, [f.field]: e.target.value }))}
                                    className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none dark:border-slate-700 dark:bg-slate-900"
                                >
                                    <option value="">Değiştirme</option>
                                    {f.options?.map((o) => (
                                        <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                </select>
                            ) : (
                                <input
                                    type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                                    value={fieldValues[f.field] ?? ""}
                                    onChange={(e) => setFieldValues((v) => ({ ...v, [f.field]: e.target.value }))}
                                    placeholder="Değiştirme = boş bırak"
                                    className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none dark:border-slate-700 dark:bg-slate-900"
                                />
                            )}
                        </div>
                    ))}
                </div>

                <div className="mt-3 space-y-1">
                    <label className="text-[11px] font-bold uppercase text-slate-400">Müdahale Sebebi (zorunlu)</label>
                    <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Örn: Müşteri siparişi yanlış durumda kalmış, düzeltildi."
                        className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none dark:border-slate-700 dark:bg-slate-900"
                    />
                </div>

                {formMsg && (
                    <div className={`mt-3 flex items-start gap-2 rounded-xl border p-3 text-xs font-medium ${
                        formMsg.kind === "ok"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                            : "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/20"
                    }`}>
                        {formMsg.kind === "ok" ? <CheckCircle2 size={15} className="shrink-0 mt-0.5" /> : <AlertTriangle size={15} className="shrink-0 mt-0.5" />}
                        <span>{formMsg.text}</span>
                    </div>
                )}

                {!confirming ? (
                    <button
                        type="button"
                        onClick={() => { setFormMsg(null); setConfirming(true); }}
                        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-black text-white hover:bg-indigo-700"
                    >
                        <Wrench size={16} /> Müdahaleyi Hazırla
                    </button>
                ) : (
                    <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
                        <div className="flex items-center gap-2 text-xs font-bold text-amber-800 dark:text-amber-200">
                            <ShieldAlert size={15} /> Müşteri verisini değiştiriyorsun. Onaylıyor musun?
                        </div>
                        <div className="mt-3 flex gap-2">
                            <button
                                type="button"
                                onClick={handleApply}
                                disabled={saving}
                                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-60"
                            >
                                {saving ? <Loader size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                                Onayla ve Uygula
                            </button>
                            <button
                                type="button"
                                onClick={() => setConfirming(false)}
                                disabled={saving}
                                className="rounded-xl px-4 py-2 text-sm font-bold text-slate-500"
                            >
                                Vazgeç
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {loadErr && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{loadErr}</div>
            )}

            {/* Geçmiş Müdahaleler + Geri Alma */}
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <Undo2 size={18} className="text-slate-500" />
                    <h4 className="text-sm font-black uppercase tracking-widest text-slate-400">Yapılan Müdahaleler</h4>
                </div>
                {loading ? (
                    <div className="text-sm text-slate-400">Yükleniyor...</div>
                ) : interventions.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-400 dark:border-slate-800">
                        Bu firmada henüz admin müdahalesi yok.
                    </div>
                ) : (
                    <div className="space-y-2">
                        {interventions.map((it) => (
                            <div key={it.id} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                                                it.action === "revert"
                                                    ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                                    : it.reverted
                                                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                                                        : "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                                            }`}>
                                                {it.action === "revert" ? "Geri Alma" : it.reverted ? "Geri Alındı" : "Müdahale"}
                                            </span>
                                            <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300">{it.table_name}</span>
                                            <span className="truncate font-mono text-[11px] text-slate-400">{it.record_id.slice(0, 8)}…</span>
                                        </div>
                                        <div className="mt-1.5 space-y-0.5">
                                            {it.changed_fields.map((field) => (
                                                <div key={field} className="text-xs">
                                                    <span className="font-bold text-slate-500">{field}:</span>{" "}
                                                    <span className="text-red-600 line-through">{fmt(it.old_values?.[field])}</span>{" "}
                                                    <span className="text-slate-400">→</span>{" "}
                                                    <span className="font-bold text-emerald-600">{fmt(it.new_values?.[field])}</span>
                                                </div>
                                            ))}
                                        </div>
                                        {it.reason && <div className="mt-1 text-[11px] italic text-slate-400">“{it.reason}”</div>}
                                        <div className="mt-1 text-[10px] font-bold uppercase text-slate-300">
                                            {format(new Date(it.created_at), "dd MMM yyyy HH:mm", { locale: tr })}
                                        </div>
                                    </div>
                                    {it.action === "update" && !it.reverted && (
                                        <button
                                            type="button"
                                            onClick={() => handleRevert(it.id)}
                                            disabled={revertingId === it.id}
                                            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300"
                                        >
                                            {revertingId === it.id ? <Loader size={13} className="animate-spin" /> : <Undo2 size={13} />}
                                            Geri Al
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Firma İşlem Geçmişi */}
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <History size={18} className="text-slate-500" />
                    <h4 className="text-sm font-black uppercase tracking-widest text-slate-400">Son İşlem Geçmişi</h4>
                </div>
                {loading ? (
                    <div className="text-sm text-slate-400">Yükleniyor...</div>
                ) : activity.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-400 dark:border-slate-800">
                        Kayıtlı işlem geçmişi yok.
                    </div>
                ) : (
                    <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                        {activity.map((a) => (
                            <div key={a.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/30">
                                <div className="min-w-0">
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{a.action}</span>
                                    {a.entity_type && <span className="ml-1.5 text-[11px] text-slate-400">{a.entity_type}</span>}
                                    {a.actor_name && a.actor_name !== "—" && (
                                        <span className="ml-1.5 text-[11px] text-slate-400">· {a.actor_name}</span>
                                    )}
                                </div>
                                <span className="shrink-0 text-[10px] font-bold uppercase text-slate-300">
                                    {format(new Date(a.created_at), "dd MMM HH:mm", { locale: tr })}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
