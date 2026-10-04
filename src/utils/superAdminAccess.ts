// ============================================================================
// Süper Admin — deneme süresi ve özel erişim yönetimi (migration 026 RPC'leri).
//
// Yetki SUNUCUDA doğrulanır: her RPC kendi içinde is_super_admin() kontrolü
// yapar (PERDEPRO_FORBIDDEN). İstemcideki rol bilgisi yalnızca ekranı gösterip
// göstermemek içindir; güvenlik kararı değildir.
// Tüm işlemler firma ADI ile değil firma ID'si ile yapılır (aynı adlı firmalar var).
// ============================================================================
import { supabase } from "../supabaseClient";
import { getErrorMessage } from "./errorMessage";

/** Türkiye sabit UTC+3 (yaz saati uygulaması yok). */
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;
const ISTANBUL_OFFSET_SUFFIX = "+03:00";

export type CompanyAdmin = {
    user_id: string;
    email: string | null;
    full_name: string | null;
    role: string;
    is_active: boolean;
    /** companies.owner_id bu kişiyi mi gösteriyor (bilgi amaçlı; sahiplik kanıtı değildir). */
    is_owner_id: boolean;
};

export type CompanyIdentity = {
    company_id: string;
    name: string | null;
    created_at: string | null;
    admins: CompanyAdmin[];
    owner_user_id: string | null;
    owner_email: string | null;
    owner_is_admin_member: boolean;
    active_member_count: number;
};

export type AccessSnapshot = {
    company_id: string;
    name: string | null;
    plan_status: string | null;
    subscription_status: string | null;
    subscription_plan: string | null;
    package_code: string | null;
    is_active: boolean | null;
    read_only: boolean | null;
    trial_started_at: string | null;
    trial_ends_at: string | null;
    license_expires_at: string | null;
    is_pilot: boolean;
    pilot_until: string | null;
    pilot_note: string | null;
    special_access_active: boolean;
    writable: boolean;
    signup_source: string | null;
    server_time: string;
};

export type AccessHistoryEntry = {
    created_at: string;
    action: string;
    actor_email: string | null;
    before: Partial<AccessSnapshot> | null;
    after: (Partial<AccessSnapshot> & { added_days?: number; calculated_from?: string }) | null;
    reason: string | null;
};

export type CompanyAccessDetail = AccessSnapshot & {
    admins: CompanyAdmin[];
    owner_email: string | null;
    owner_is_admin_member: boolean | null;
    free_trial_used: { source: string | null; trial_started_at: string | null; trial_ends_at: string | null } | null;
    history: AccessHistoryEntry[];
};

export type AccessChangeResult = { before: AccessSnapshot; after: AccessSnapshot };

export const ACCESS_ACTION_LABELS: Record<string, string> = {
    SUPER_ADMIN_TRIAL_END_SET: "Deneme bitişi değiştirildi",
    SUPER_ADMIN_TRIAL_DAYS_ADDED: "Deneme süresine gün eklendi",
    SUPER_ADMIN_TRIAL_ENDED_NOW: "Deneme hemen bitirildi",
    SUPER_ADMIN_SPECIAL_ACCESS_GRANTED: "Özel erişim verildi/güncellendi",
    SUPER_ADMIN_SPECIAL_ACCESS_REVOKED: "Özel erişim kaldırıldı",
};

/** 026 henüz çalıştırılmadıysa PostgREST "function not found" döner. */
export function isMissingRpcError(error: unknown): boolean {
    const e = (error ?? {}) as { code?: string; message?: string };
    const msg = String(e.message ?? "").toLowerCase();
    return e.code === "PGRST202" || e.code === "42883" || msg.includes("could not find the function");
}

export function accessErrorMessage(error: unknown, fallback = "İşlem yapılamadı."): string {
    if (isMissingRpcError(error)) {
        return "Sunucu güncellemesi (migration 026) henüz uygulanmamış. İşlem yapılmadı.";
    }
    return getErrorMessage(error, fallback);
}

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw error;
    if (data == null) throw new Error("Sunucudan yanıt alınamadı; işlem sonucu doğrulanamadı.");
    return data as T;
}

export async function listCompanyIdentities(): Promise<CompanyIdentity[]> {
    const { data, error } = await supabase.rpc("super_admin_list_company_identities");
    if (error) throw error;
    return ((data as CompanyIdentity[] | null) ?? []).map((row) => ({
        ...row,
        admins: Array.isArray(row.admins) ? row.admins : [],
    }));
}

export function getCompanyAccess(companyId: string): Promise<CompanyAccessDetail> {
    return callRpc<CompanyAccessDetail>("super_admin_get_company_access", { p_company_id: companyId });
}

export function setTrialEnd(companyId: string, endsAtIso: string, reason: string | null): Promise<AccessChangeResult> {
    return callRpc("super_admin_set_trial_end", { p_company_id: companyId, p_trial_ends_at: endsAtIso, p_reason: reason });
}

export function addTrialDays(companyId: string, days: number, reason: string | null): Promise<AccessChangeResult> {
    return callRpc("super_admin_add_trial_days", { p_company_id: companyId, p_days: days, p_reason: reason });
}

export function endTrialNow(companyId: string, confirmName: string, reason: string | null): Promise<AccessChangeResult> {
    return callRpc("super_admin_end_trial_now", { p_company_id: companyId, p_confirm_name: confirmName, p_reason: reason });
}

export function setSpecialAccess(
    companyId: string,
    enabled: boolean,
    untilIso: string | null,
    note: string | null,
): Promise<AccessChangeResult> {
    return callRpc("super_admin_set_special_access", {
        p_company_id: companyId,
        p_enabled: enabled,
        p_until: enabled ? untilIso : null,
        p_note: note,
    });
}

/** ISO an → <input type="datetime-local"> değeri (Türkiye saatiyle "YYYY-MM-DDTHH:mm"). */
export function isoToIstanbulInput(iso: string | null | undefined): string {
    if (!iso) return "";
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return "";
    return new Date(t + ISTANBUL_OFFSET_MS).toISOString().slice(0, 16);
}

/** <input type="datetime-local"> değeri (Türkiye saati) → ISO (+03:00). Geçersizse null. */
export function istanbulInputToIso(value: string): string | null {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
    const iso = `${value}:00${ISTANBUL_OFFSET_SUFFIX}`;
    return Number.isFinite(new Date(iso).getTime()) ? iso : null;
}

/** Gün eklemenin sunucudaki kuralının istemci önizlemesi (yalnızca bilgi; sunucu yeniden hesaplar). */
export function previewAddDays(trialEndsAt: string | null, days: number, now: number = Date.now()): { base: "mevcut_bitis" | "simdi"; newEnd: Date } {
    const current = trialEndsAt ? new Date(trialEndsAt).getTime() : NaN;
    const fromCurrent = Number.isFinite(current) && current > now;
    const base = fromCurrent ? current : now;
    return { base: fromCurrent ? "mevcut_bitis" : "simdi", newEnd: new Date(base + days * 86400000) };
}

/** Panoya kopyalama — Electron/Capacitor/eski tarayıcılar için yedekli. */
export async function copyText(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // yedek yönteme düş
    }
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}

/** Yöneticileri tek satırlık okunur metne çevirir (liste hücreleri için). */
export function describeAdmins(admins: CompanyAdmin[]): string {
    const active = admins.filter((a) => a.is_active);
    if (active.length === 0) return "Aktif yönetici yok";
    return active.map((a) => a.email || a.full_name || a.user_id.slice(0, 8)).join(", ");
}
