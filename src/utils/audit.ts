import { getEffectiveTenantContext, supabase } from "../supabaseClient";

/**
 * Denetim kaydı yazar. Kullanıcı işlemini ASLA bozmaz (hata yutulmaz ama fırlatılmaz);
 * başarısızlık console.error ile raporlanır (uzaktan hata raporlama bunu yakalar).
 * Şirket kimliği getEffectiveTenantContext'ten gelir — süper admin demo/işlem
 * modunda izlenen firmaya yazılır.
 */
export async function logAction(
    action: string,
    entityType: string,
    entityId: string,
    details: any = {}
) {
    try {
        const ctx = await getEffectiveTenantContext();
        if (!ctx.company_id) return;

        // Salt okunur demo oturumunda yazma zaten engelli; gereksiz hata üretme.
        if (ctx.isDemoTenant && ctx.readOnly) return;

        const { error } = await supabase.from("audit_logs").insert({
            company_id: ctx.company_id,
            user_id: ctx.user.id,
            action,
            entity_type: entityType,
            entity_id: entityId || null,
            details,
        });

        if (error) {
            console.error("Audit logging failed:", error.message || error.code || "bilinmeyen hata", { action, entityType });
        }
    } catch (err) {
        console.error("Audit logging failed:", err);
    }
}
