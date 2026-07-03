import { supabase } from "../supabaseClient";

// ============================================================
// Süper Admin müdahale (müşteri adına kayıt düzeltme) + geri alma
// SQL: supabase_admin_intervention_system.sql
// ============================================================

export type InterventionTable =
    | "orders"
    | "appointments"
    | "customers"
    | "payments"
    | "supplier_transactions"
    | "supplier_payments";

export interface AdminIntervention {
    id: string;
    company_id: string;
    super_admin_id: string | null;
    ticket_id: string | null;
    table_name: InterventionTable;
    record_id: string;
    action: "update" | "revert";
    changed_fields: string[];
    old_values: Record<string, unknown>;
    new_values: Record<string, unknown>;
    reason: string | null;
    reverted: boolean;
    reverted_at: string | null;
    reverted_by: string | null;
    revert_of: string | null;
    created_at: string;
}

export interface CompanyActivity {
    id: string;
    source: string;
    action: string;
    entity_type: string | null;
    entity_id: string | null;
    actor_name: string | null;
    details: Record<string, unknown> | null;
    created_at: string;
}

type Result<T> = { success: true; data: T } | { success: false; error: string };

function fail(e: any): { success: false; error: string } {
    return { success: false, error: e?.message || "Bilinmeyen hata" };
}

/** Müşteri adına bir kaydı düzelt — eski/yeni değer otomatik loglanır. */
export async function applyIntervention(params: {
    companyId: string;
    table: InterventionTable;
    recordId: string;
    changes: Record<string, unknown>;
    reason?: string;
    ticketId?: string | null;
}): Promise<Result<string>> {
    try {
        const { data, error } = await supabase.rpc("super_admin_apply_intervention", {
            p_company_id: params.companyId,
            p_table: params.table,
            p_record_id: params.recordId,
            p_changes: params.changes,
            p_reason: params.reason ?? null,
            p_ticket_id: params.ticketId ?? null,
        });
        if (error) throw error;
        return { success: true, data: data as string };
    } catch (e) {
        return fail(e);
    }
}

/** Yanlış müdahaleyi geri al — eski değerleri tekrar yazar. */
export async function revertIntervention(interventionId: string): Promise<Result<string>> {
    try {
        const { data, error } = await supabase.rpc("super_admin_revert_intervention", {
            p_intervention_id: interventionId,
        });
        if (error) throw error;
        return { success: true, data: data as string };
    } catch (e) {
        return fail(e);
    }
}

/** Bir firmanın müdahale kayıtları (en yeni önce). */
export async function getInterventions(
    companyId: string,
    opts: { ticketId?: string | null; limit?: number } = {}
): Promise<Result<AdminIntervention[]>> {
    try {
        let query = supabase
            .from("admin_data_interventions")
            .select("*")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
            .limit(opts.limit ?? 50);
        if (opts.ticketId) query = query.eq("ticket_id", opts.ticketId);
        const { data, error } = await query;
        if (error) throw error;
        return { success: true, data: (data ?? []) as AdminIntervention[] };
    } catch (e) {
        return fail(e);
    }
}

/** Firma işlem geçmişi (audit_logs) — süper admin köprü RPC'si üzerinden. */
export async function getCompanyActivity(
    companyId: string,
    limit = 50
): Promise<Result<CompanyActivity[]>> {
    try {
        const { data, error } = await supabase.rpc("get_company_activity", {
            p_company_id: companyId,
            p_limit: limit,
        });
        if (error) throw error;
        return { success: true, data: (data ?? []) as CompanyActivity[] };
    } catch (e) {
        return fail(e);
    }
}

// ------------------------------------------------------------
// Destek kategorisine göre müdahale ön ayarları (UI için)
// ------------------------------------------------------------
export interface FieldPreset {
    field: string;
    label: string;
    type: "select" | "text" | "number" | "date";
    options?: { value: string; label: string }[];
}

export interface InterventionPreset {
    key: string;
    label: string;
    table: InterventionTable;
    idLabel: string;       // kayıt ID'si için etiket
    fields: FieldPreset[];
}

const ORDER_STATUS_OPTIONS = [
    { value: "draft", label: "Teklif / Taslak" },
    { value: "approved", label: "Onaylandı" },
    { value: "production", label: "Üretimde" },
    { value: "montaja_hazir", label: "Montaja Hazır" },
    { value: "montaj_planlandi", label: "Montaj Planlandı" },
    { value: "montajda", label: "Montajda" },
    { value: "montaj_tamamlandi", label: "Montaj Tamamlandı" },
    { value: "installation_ready", label: "Kuruluma Hazır" },
    { value: "installation_completed", label: "Kurulum Tamamlandı" },
    { value: "completed", label: "Tamamlandı" },
    { value: "delivered_closed", label: "Teslim / Kapandı" },
    { value: "cancelled", label: "İptal" },
];

export const INTERVENTION_PRESETS: InterventionPreset[] = [
    {
        key: "order_status",
        label: "Sipariş Durumu",
        table: "orders",
        idLabel: "Sipariş ID",
        fields: [{ field: "status", label: "Yeni Durum", type: "select", options: ORDER_STATUS_OPTIONS }],
    },
    {
        key: "order_installer",
        label: "Montajcı Atama",
        table: "orders",
        idLabel: "Sipariş ID",
        fields: [{ field: "assigned_to", label: "Montajcı (user_id) — boş bırakırsan atama kalkar", type: "text" }],
    },
    {
        // payments tablosu: amount, payment_date, method, note (status YOK)
        key: "payment",
        label: "Ödeme / Tahsilat",
        table: "payments",
        idLabel: "Ödeme ID",
        fields: [
            { field: "amount", label: "Tutar", type: "number" },
            { field: "payment_date", label: "Ödeme Tarihi", type: "date" },
            { field: "method", label: "Yöntem (nakit/kart/havale)", type: "text" },
            { field: "note", label: "Not", type: "text" },
        ],
    },
    {
        // supplier_transactions: amount, transaction_type, description, transaction_date
        key: "supplier_cari",
        label: "Tedarikçi Cari",
        table: "supplier_transactions",
        idLabel: "Cari Hareket ID",
        fields: [
            { field: "amount", label: "Tutar", type: "number" },
            { field: "transaction_type", label: "Tür (debt/payment)", type: "text" },
            { field: "description", label: "Açıklama", type: "text" },
        ],
    },
    {
        // supplier_payments: amount, payment_method, payment_date, note
        key: "supplier_payment",
        label: "Tedarikçi Ödemesi",
        table: "supplier_payments",
        idLabel: "Tedarikçi Ödeme ID",
        fields: [
            { field: "amount", label: "Tutar", type: "number" },
            { field: "payment_date", label: "Tarih", type: "date" },
            { field: "note", label: "Not", type: "text" },
        ],
    },
    {
        // appointments: status, measurement_notes, note, start_at
        key: "measurement",
        label: "Hatalı Ölçü / Randevu",
        table: "appointments",
        idLabel: "Randevu/Ölçü ID",
        fields: [
            { field: "measurement_notes", label: "Ölçü Notu", type: "text" },
            { field: "note", label: "Not", type: "text" },
            { field: "status", label: "Durum", type: "text" },
        ],
    },
    {
        // customers: name, phone, email, address, note/notes
        key: "customer",
        label: "Müşteri Bilgisi",
        table: "customers",
        idLabel: "Müşteri ID",
        fields: [
            { field: "name", label: "Ad", type: "text" },
            { field: "phone", label: "Telefon", type: "text" },
            { field: "email", label: "E-posta", type: "text" },
            { field: "address", label: "Adres", type: "text" },
        ],
    },
];
