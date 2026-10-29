import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

type RequestRow = { id: string; subject_user_id: string | null; email: string | null; status: string; requested_at: string; due_at: string; completed_at: string | null; completion_note: string | null };
export default function SuperAdminAccountDeletions() {
    const [rows, setRows] = useState<RequestRow[]>([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<string | null>(null);
    const [note, setNote] = useState("");
    const [confirm, setConfirm] = useState("");
    const [busy, setBusy] = useState(false);
    async function load() {
        setLoading(true); setError("");
        try {
            const { data, error: fetchError } = await supabase.from("account_deletion_requests")
                .select("id,subject_user_id,email,status,requested_at,due_at,completed_at,completion_note").order("requested_at", { ascending: false }).limit(200);
            if (fetchError) throw fetchError;
            setRows((data || []) as RequestRow[]);
        } catch { setError("Silme talepleri yüklenemedi. Hesap silme veritabanı kurulumunu ve bağlantıyı kontrol edin."); }
        finally { setLoading(false); }
    }
    useEffect(() => { void load(); }, []);
    async function complete(id: string) {
        if (busy || confirm !== "KALICI SILINDI" || note.trim().length < 3) return;
        setBusy(true); setError("");
        try {
            const { error: rpcError } = await supabase.rpc("complete_account_deletion_request", { p_id: id, p_confirm: confirm, p_retention_note: note.trim() });
            if (rpcError) throw rpcError;
            setSelected(null); setNote(""); setConfirm(""); await load();
        } catch { setError("Tamamlanma doğrulanamadı. Auth hesabı, profil, üyelik veya sahip olunan dosyalar hâlâ duruyor olabilir. Gerçek silme işlemi bitmeden talep tamamlanamaz."); }
        finally { setBusy(false); }
    }
    return <div className="mx-auto max-w-5xl space-y-5 p-4 pb-24 text-slate-900 dark:text-slate-100">
        <h1 className="text-2xl font-bold">Kalıcı hesap silme talepleri</h1>
        <p className="text-sm">Talepleri en geç 7 gün içinde işleyin. Kullanıcı bu süreyi ve işlem sonucunu uygulamada görür. Bu ekran hesabı veya işletmeyi otomatik silmez.</p>
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">Önce hedef kullanıcıyı ve ilişkili kişisel verilerini doğrulayın. Paylaşılan işletmeyi başka çalışanlarla birlikte silmeyin. Saklanması zorunlu kayıtları ve gerekçesini belirleyin; diğer kişisel verileri ve Storage dosyalarını temizleyin. Auth hesabını, profilini ve üyeliklerini kaldırdıktan sonra aşağıdan tamamlanmayı onaylayın. İşletme verisi temizliği için depodaki ACCOUNT_DELETION_OPERATIONS.md belgesini izleyin.</div>
        {error ? <p role="alert" className="text-red-700 dark:text-red-300">{error}</p> : null}
        <button type="button" onClick={() => void load()} disabled={loading || busy} className="rounded-xl border p-3">Listeyi yenile</button>
        {loading ? <p>Yükleniyor...</p> : rows.length === 0 ? <p>Silme talebi yok.</p> : rows.map(row => <section key={row.id} className="space-y-3 rounded-xl border p-4">
            <h2 className="break-all font-bold">{row.email || "Kimlik bilgileri temizlendi"}</h2>
            <p className="break-all text-xs">Talep: {row.id}{row.subject_user_id ? <><br />Hedef kullanıcı: {row.subject_user_id}</> : null}</p>
            <p className="text-sm">{row.status === "completed" ? "Tamamlandı" : "Kalıcı silme bekliyor"} · Son tarih: {new Date(row.due_at).toLocaleString("tr-TR")}</p>
            {row.status === "pending" ? selected === row.id ? <>
                <label className="block text-sm">Kullanıcıya gösterilecek tamamlanma ve yasal saklama açıklaması<textarea value={note} maxLength={1500} onChange={e => setNote(e.target.value)} className="mt-1 w-full rounded border p-3 dark:bg-slate-900" placeholder="Silinen verileri ve varsa saklanan kayıtların gerekçesini belirtin. Kişisel bilgi yazmayın." /></label>
                <label className="block text-sm">Gerçek silme bittiyse KALICI SILINDI yazın<input value={confirm} onChange={e => setConfirm(e.target.value)} className="mt-1 w-full rounded border p-3 dark:bg-slate-900" /></label>
                <button type="button" disabled={busy || confirm !== "KALICI SILINDI" || note.trim().length < 3} onClick={() => void complete(row.id)} className="rounded-xl bg-red-700 p-3 text-white disabled:opacity-50">Silme tamamlanmasını doğrula</button>
            </> : <button type="button" onClick={() => { setSelected(row.id); setNote(""); setConfirm(""); }} className="rounded-xl border p-3">Silme işlemi sonrası onay</button> : <p className="text-sm">{row.completion_note}</p>}
        </section>)}
    </div>;
}
