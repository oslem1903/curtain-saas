import { supabase } from "../supabaseClient";

export type SelfServiceTrialResult = {
    company_id: string;
    created: boolean;
    plan_status?: string | null;
    trial_started_at?: string | null;
    trial_ends_at?: string | null;
    trial_reused?: boolean;
};

/**
 * Oturumdaki (e-postası doğrulanmış) kullanıcı için bağımsız işletme, yönetici
 * üyeliği ve deneme süresini SUNUCUDA oluşturur. İdempotenttir: kullanıcı zaten
 * bir işletmeye bağlıysa yeni işletme/deneme oluşturmaz, mevcut olanı döndürür.
 */
export async function startSelfServiceTrial(companyName: string, fullName?: string | null): Promise<SelfServiceTrialResult> {
    const { data, error } = await supabase.rpc("start_self_service_trial", {
        p_company_name: companyName.trim(),
        p_full_name: fullName?.trim() || null,
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as SelfServiceTrialResult | null;
    if (!row?.company_id) throw new Error("İşletme oluşturulamadı.");
    return row;
}
