import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AuthShell, { AuthMessage, authInputClass, authLabelClass, authPrimaryButtonClass, authSecondaryButtonClass } from "../components/AuthShell";
import { readDeletionReceipt, refreshDeletionReceipt, requestAccountDeletion, saveDeletionReceipt, type DeletionReceipt } from "../utils/accountDeletion";

function date(value: string) { return new Date(value).toLocaleString("tr-TR"); }

export default function AccountDeletion() {
    const { user } = useAuth();
    return <AccountDeletionForm key={user?.id || "anonymous"} />;
}

function AccountDeletionForm() {
    const { user } = useAuth();
    const nav = useNavigate();
    const [receipt, setReceipt] = useState<DeletionReceipt | null>(() => readDeletionReceipt(user?.id));
    const [receiptCode, setReceiptCode] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [accepted, setAccepted] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const inFlight = useRef(false);

    const isConfirmed = confirmation.trim().toLocaleUpperCase("tr-TR").replaceAll("İ", "I") === "SIL";
    async function submit() {
        if (inFlight.current || !user || !isConfirmed || !accepted) return;
        inFlight.current = true; setBusy(true); setMessage("");
        try {
            const next = await requestAccountDeletion();
            const saved = saveDeletionReceipt(next, user.id);
            setReceipt(next);
            if (!saved) setMessage("Talebiniz kaydedildi. Bu cihazda takip bilgisi saklanamadı; aşağıdaki takip kodunu güvenli bir yere kaydedin.");
        } catch (error) { setMessage(error instanceof Error ? error.message : "Talep kaydedilemedi."); }
        finally { inFlight.current = false; setBusy(false); }
    }
    async function refresh() {
        if (!receipt || inFlight.current) return;
        inFlight.current = true; setBusy(true); setMessage("");
        try {
            const next = await refreshDeletionReceipt(receipt);
            setReceipt(next); saveDeletionReceipt(next, user?.id);
        } catch (error) { setMessage(error instanceof Error ? error.message : "Durum kontrol edilemedi."); }
        finally { inFlight.current = false; setBusy(false); }
    }
    async function importReceipt() {
        const [id, receipt_secret] = receiptCode.trim().split(":");
        const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
        if (!uuid.test(id || "") || !uuid.test(receipt_secret || "")) { setMessage("Geçerli bir takip kodu girin."); return; }
        if (inFlight.current) return;
        inFlight.current = true; setBusy(true); setMessage("");
        try {
            const next = await refreshDeletionReceipt({ id, receipt_secret } as DeletionReceipt);
            setReceipt(next); saveDeletionReceipt(next);
        } catch { setMessage("Takip kodu bulunamadı veya durum kontrol edilemedi."); }
        finally { inFlight.current = false; setBusy(false); }
    }
    return <AuthShell title="Hesabımı sil" subtitle="Hesabınızın ve ilişkili kişisel verilerinizin kalıcı olarak silinmesini buradan başlatabilirsiniz.">
        <div className="space-y-4">
            {receipt ? <>
                <AuthMessage tone="success">{receipt.status === "completed" ? "Hesabınızın kalıcı silme işlemi tamamlandı." : "Kalıcı hesap silme talebiniz alındı. Hesabınız henüz silinmedi."}</AuthMessage>
                <p className="text-sm text-slate-600 dark:text-slate-300">Talep tarihi: {date(receipt.requested_at)}<br />En geç tamamlanma: {date(receipt.due_at)}</p>
                {receipt.completed_at ? <p className="text-sm dark:text-slate-300">Tamamlanma: {date(receipt.completed_at)}<br />{receipt.completion_note}</p> : <p className="text-sm text-slate-600 dark:text-slate-300">İşlem 7 gün içinde tamamlanır. Bu ekrandan durumu kontrol edebilir, tamamlandığında onayını görebilirsiniz. Destek mesajı veya telefon görüşmesi gerekmez.</p>}
                <details className="text-xs text-slate-600 dark:text-slate-300"><summary>Takip kodunu göster</summary><p className="mt-2 break-all select-all">{receipt.id}:{receipt.receipt_secret}</p><p>Bu kodu bilen kişi yalnızca talebinizin durumunu görebilir. Güvenli saklayın.</p></details>
                <button type="button" disabled={busy} onClick={() => void refresh()} className={authPrimaryButtonClass}>{busy ? "Kontrol ediliyor..." : "Talebin durumunu kontrol et"}</button>
            </> : user ? <>
                <p className="break-all font-semibold text-slate-800 dark:text-slate-100">{user.email}</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">Bu talep hesabınızın ve ilişkili kişisel verilerinizin kalıcı silinmesi içindir; geçici hesap kapatma değildir. İşlem 7 gün içinde tamamlanır ve geri alınamaz.</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">Varsa gerekli verilerinizi önce dışa aktarın. Paylaşılan işletme kayıtları ve saklanması zorunlu kayıtlar incelenir; saklanan veri ve gerekçesi tamamlanma bilgisinde açıklanır. Silme işlemi ayrıca bir abonelik iptali veya ücret iadesi oluşturmaz.</p>
                <label className="flex gap-3 text-sm text-slate-700 dark:text-slate-200"><input type="checkbox" checked={accepted} disabled={busy} onChange={e => setAccepted(e.target.checked)} /><span>Hesabımın kalıcı olarak silinmesini istiyorum.</span></label>
                <label className="block"><span className={authLabelClass}>Onay için SİL yazın</span><input aria-label="Silme onayı" className={`${authInputClass} mt-2 pl-4`} value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} autoComplete="off" /></label>
                <button type="button" onClick={() => void submit()} disabled={busy || !accepted || !isConfirmed} className={`${authPrimaryButtonClass} bg-red-700 hover:bg-red-800`}>{busy ? "Talep kaydediliyor..." : "Kalıcı silme talebini gönder"}</button>
            </> : <AuthMessage>Silme talebi başlatmak için hesabınızla giriş yapın. Önceden kaydedilen talebiniz varsa takip koduyla durumunu sorgulayabilirsiniz.</AuthMessage>}
            {!receipt && !user ? <><label className="block"><span className={authLabelClass}>Takip kodu</span><input aria-label="Takip kodu" className={`${authInputClass} mt-2 pl-4`} value={receiptCode} onChange={e => setReceiptCode(e.target.value)} autoComplete="off" /></label><button type="button" disabled={busy} onClick={() => void importReceipt()} className={authPrimaryButtonClass}>Talebimi bul</button></> : null}
            {message ? <AuthMessage tone="error">{message}</AuthMessage> : null}
            <button type="button" className={authSecondaryButtonClass} onClick={() => nav(user ? "/" : "/login")}>Geri dön</button>
        </div>
    </AuthShell>;
}
