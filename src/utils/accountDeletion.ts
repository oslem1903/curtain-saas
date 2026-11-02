import { supabase } from "../supabaseClient";

export type DeletionReceipt = {
    id: string;
    receipt_secret: string;
    status: "pending" | "completed";
    requested_at: string;
    due_at: string;
    completed_at: string | null;
    completion_note: string | null;
};
const RECEIPT_KEY = "perdepro_account_deletion_receipt_v1";

export function readDeletionReceipt(userId?: string): DeletionReceipt | null {
    try {
        const value = JSON.parse(localStorage.getItem(userId ? `${RECEIPT_KEY}:${userId}` : RECEIPT_KEY) || "null");
        return value?.id && value?.receipt_secret ? value : null;
    } catch { return null; }
}

export function saveDeletionReceipt(receipt: DeletionReceipt, userId?: string): boolean {
    try {
        if (userId) localStorage.setItem(`${RECEIPT_KEY}:${userId}`, JSON.stringify(receipt));
        localStorage.setItem(RECEIPT_KEY, JSON.stringify(receipt)); return true;
    }
    catch { return false; }
}

export async function requestAccountDeletion(): Promise<DeletionReceipt> {
    const { data, error } = await supabase.rpc("request_my_account_deletion", { p_confirm: "HESABIMI SIL" });
    if (error) throw new Error("Silme talebiniz kaydedilemedi. Lütfen tekrar deneyin.");
    if (!data?.id || !data?.receipt_secret) throw new Error("Silme talebinin sonucu doğrulanamadı. Lütfen tekrar deneyin.");
    return data as DeletionReceipt;
}

export async function refreshDeletionReceipt(receipt: DeletionReceipt): Promise<DeletionReceipt> {
    const { data, error } = await supabase.rpc("get_account_deletion_receipt", { p_id: receipt.id, p_secret: receipt.receipt_secret });
    if (error || !data?.id) throw new Error("Talebinizin durumu kontrol edilemedi. Lütfen tekrar deneyin.");
    return data as DeletionReceipt;
}
