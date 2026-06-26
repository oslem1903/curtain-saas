import { supabase } from "../supabaseClient";

export async function logAction(
    action: string,
    entityType: string,
    entityId: string,
    details: any = {}
) {
    try {
        const { data: u } = await supabase.auth.getUser();
        if (!u?.user) return;

        // Company ID'yi company_members üzerinden çek
        const { data: cm } = await supabase
            .from("company_members")
            .select("company_id")
            .eq("user_id", u.user.id)
            .maybeSingle();

        if (!cm?.company_id) return;

        await supabase.from("audit_logs").insert({
            company_id: cm.company_id,
            user_id: u.user.id,
            action,
            entity_type: entityType,
            entity_id: entityId,
            details
        });
    } catch (err) {
        console.error("Audit logging failed:", err);
    }
}
