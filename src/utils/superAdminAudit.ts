import { supabase } from "../supabaseClient";

export async function logSuperAdminAction(
    action: string,
    details: Record<string, any> = {}
) {
    try {
        const { data: user } = await supabase.auth.getUser();
        if (!user?.user) return;

        // Get user's profile
        const { data: profile } = await supabase
            .from("profiles")
            .select("full_name, role")
            .eq("user_id", user.user.id)
            .maybeSingle();

        // Log to audit_logs
        const { error } = await supabase.from("audit_logs").insert({
            user_id: user.user.id,
            action: `SUPER_ADMIN_${action}`,
            entity_type: "SUPER_ADMIN_ACTION",
            details: {
                ...details,
                actor_role: profile?.role,
                actor_name: profile?.full_name,
                timestamp: new Date().toISOString(),
            },
        });

        if (error) console.error("Audit logging error:", error);
    } catch (e) {
        console.error("Audit logging failed:", e);
    }
}

export async function logDemoSessionStart(
    superAdminId: string,
    targetCompanyId: string,
    targetRole: string
) {
    return logSuperAdminAction("DEMO_SESSION_START", {
        target_company_id: targetCompanyId,
        target_role: targetRole,
        super_admin_id: superAdminId,
    });
}

export async function logDemoSessionEnd(
    superAdminId: string,
    targetCompanyId: string,
    durationMinutes: number
) {
    return logSuperAdminAction("DEMO_SESSION_END", {
        target_company_id: targetCompanyId,
        super_admin_id: superAdminId,
        duration_minutes: durationMinutes,
    });
}

export async function logRemoteAction(
    companyId: string,
    operationType: string,
    status: "started" | "completed" | "failed",
    details: Record<string, any> = {}
) {
    return logSuperAdminAction("REMOTE_ACTION", {
        company_id: companyId,
        operation_type: operationType,
        status,
        ...details,
    });
}

export async function logLicenseChange(
    companyId: string,
    changes: Record<string, any>
) {
    return logSuperAdminAction("LICENSE_CHANGE", {
        company_id: companyId,
        changes,
    });
}

export async function logVersionRelease(
    versionId: string,
    version: string,
    action: "created" | "published" | "rolled_back"
) {
    return logSuperAdminAction("VERSION_RELEASE", {
        version_id: versionId,
        version,
        action,
    });
}
