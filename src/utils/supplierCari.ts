// ============================================================================
// Tedarikçi Cari — borç (debt) oluşturma tek doğruluk kaynağı.
//
// NewOrder / Quotes / OrderDetail aynı mantığı buradan kullanır. Amaç: borç
// oluşturma kuralını tek noktada toplamak; davranış BİREBİR korunur.
//
// Parametrelerle üç mevcut akış da desteklenir:
//   - dedupeByOrderSupplier: aynı sipariş + tedarikçi için zaten 'debt' varsa
//     yeni kayıt oluşturmaz (NewOrder davranışı).
//   - orderItemId verilirse hareket kaleme bağlanır ve
//     order_items.supplier_transaction_id güncellenir (Quotes / OrderDetail).
//     Verilmezse sade insert yapılır (NewOrder).
//
// Hata FIRLATMAZ; sonucu döndürür ki her çağıran kendi uyarı/log davranışını
// (warning toplama / console.warn / sessiz geçme) aynen koruyabilsin.
//
// NOT: due_date (vade) ve allocation (ödeme-borç eşleştirme) bu aşamada
// KAPSAM DIŞIDIR — yalnızca borç oluşturma merkezileştirildi.
// ============================================================================
import { supabase } from "../supabaseClient";

export type PostSupplierDebtParams = {
  companyId: string;
  orderId: string;
  supplierId: string;
  amount: number;
  description: string;
  /** Verilirse hareket bu kaleme bağlanır + order_items.supplier_transaction_id güncellenir. */
  orderItemId?: string | null;
  /** true ise aynı sipariş+tedarikçi için mevcut 'debt' varsa atlanır. */
  dedupeByOrderSupplier?: boolean;
  /** Manuel vade tarihi (YYYY-MM-DD). supplierDueDays verilmezse bu kullanılır. */
  dueDate?: string | null;
  /** Tedarikçi varsayılan vadesi (gün). Verilirse vade = bugün + gün olarak hesaplanır ve dueDate'i geçersiz kılar. */
  supplierDueDays?: number | null;
};

export type PostSupplierDebtResult =
  | { status: "inserted"; id: string | null }
  | { status: "skipped" }
  | { status: "error"; message: string };

/**
 * Borç vade tarihini belirler (supplier_transactions.due_date — DATE kolonu).
 *   - Tedarikçi varsayılan vadesi (gün) varsa: bugün + gün → otomatik hesaplanır.
 *   - Yoksa: manuel girilen değer kullanılır.
 *   - İkisi de yoksa: null (vade yok; mevcut davranış).
 * Migration GEREKTİRMEZ; due_date kolonu mevcut.
 */
export function computeSupplierDueDate(
  supplierDueDays?: number | null,
  manualDueDate?: string | null,
): string | null {
  if (supplierDueDays != null && Number.isFinite(supplierDueDays)) {
    const d = new Date();
    d.setDate(d.getDate() + supplierDueDays);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  }
  return manualDueDate && manualDueDate.trim() ? manualDueDate : null;
}

export async function postSupplierDebt(params: PostSupplierDebtParams): Promise<PostSupplierDebtResult> {
  // Geçersiz girdi (tedarikçi yok / tutar yok) → sessizce atla.
  if (!params.supplierId || params.amount <= 0) return { status: "skipped" };

  if (params.dedupeByOrderSupplier) {
    const { data: existing } = await supabase
      .from("supplier_transactions")
      .select("id")
      .eq("order_id", params.orderId)
      .eq("supplier_id", params.supplierId)
      .eq("transaction_type", "debt")
      .maybeSingle();
    if (existing) return { status: "skipped" };
  }

  // Vade: tedarikçi varsayılanı varsa otomatik, yoksa manuel; ikisi de yoksa null.
  const effectiveDueDate = computeSupplierDueDate(params.supplierDueDays, params.dueDate);

  const row = {
    company_id: params.companyId,
    supplier_id: params.supplierId,
    order_id: params.orderId,
    transaction_date: new Date().toISOString(),
    transaction_type: "debt" as const,
    amount: params.amount,
    description: params.description,
    reference_no: params.orderId.slice(0, 8).toUpperCase(),
    ...(params.orderItemId ? { order_item_id: params.orderItemId } : {}),
    // Vade yokken alan hiç eklenmez → mevcut insert birebir korunur.
    ...(effectiveDueDate ? { due_date: effectiveDueDate } : {}),
  };

  // Kaleme bağlı akış: insert → id geri al → order_items'a bağla.
  if (params.orderItemId) {
    const { data, error } = await supabase
      .from("supplier_transactions")
      .insert(row)
      .select("id")
      .single();
    if (error) return { status: "error", message: error.message };
    if (data?.id) {
      await supabase.from("order_items").update({ supplier_transaction_id: data.id }).eq("id", params.orderItemId);
    }
    return { status: "inserted", id: data?.id ?? null };
  }

  // Sade insert (NewOrder): geri okuma/bağlama yok.
  const { error } = await supabase.from("supplier_transactions").insert(row);
  if (error) return { status: "error", message: error.message };
  return { status: "inserted", id: null };
}
