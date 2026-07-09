import { supabase } from "../supabaseClient";

export type RemoteActionType =
    | "cache_clear"
    | "sync_data"
    | "recalculate_orders"
    | "recalculate_payments"
    | "reset_notifications"
    | "reset_dashboard"
    | "renew_mobile_session"
    | "force_update_check"
    | "rebuild_indexes"
    | "verify_integrity";

export async function executeRemoteAction(
    companyId: string,
    operationType: RemoteActionType,
    parameters: Record<string, any> = {}
) {
    try {
        const { data, error } = await supabase.rpc("super_admin_execute_remote_action", {
            p_company_id: companyId,
            p_operation_type: operationType,
            p_parameters: parameters,
        });

        if (error) throw error;

        return {
            success: true,
            data,
        };
    } catch (e: any) {
        return {
            success: false,
            error: e?.message || "Unknown error",
        };
    }
}

export async function triggerHealthCheck(companyId: string) {
    try {
        const { data, error } = await supabase.rpc("trigger_company_database_health_check", {
            p_company_id: companyId,
        });

        if (error) throw error;

        return {
            success: true,
            data,
        };
    } catch (e: any) {
        return {
            success: false,
            error: e?.message || "Unknown error",
        };
    }
}

export async function startImpersonateSession(
    targetCompanyId: string,
    targetRole: "admin" | "accountant" | "installer" | "viewer" = "admin",
    durationMinutes: number = 5
) {
    try {
        const { data, error } = await supabase.rpc("super_admin_start_impersonate_session", {
            p_target_company_id: targetCompanyId,
            p_target_role: targetRole,
            p_duration_minutes: durationMinutes,
        });

        if (error) throw error;

        return {
            success: true,
            sessionId: data?.[0]?.session_id,
            expiresAt: data?.[0]?.expires_at,
        };
    } catch (e: any) {
        return {
            success: false,
            error: e?.message || "Unknown error",
        };
    }
}

export async function endImpersonateSession(sessionId: string) {
    try {
        const { data, error } = await supabase.rpc("super_admin_end_impersonate_session", {
            p_session_id: sessionId,
        });

        if (error) throw error;

        return {
            success: true,
            durationMinutes: data?.[0]?.duration_minutes,
        };
    } catch (e: any) {
        return {
            success: false,
            error: e?.message || "Unknown error",
        };
    }
}

export async function getRemoteMaintenanceLogs(companyId: string, limit: number = 50) {
    try {
        const { data, error } = await supabase
            .from("remote_maintenance_logs")
            .select("*")
            .eq("company_id", companyId)
            .order("started_at", { ascending: false })
            .limit(limit);

        if (error) throw error;

        return {
            success: true,
            logs: data || [],
        };
    } catch (e: any) {
        return {
            success: false,
            error: e?.message || "Unknown error",
            logs: [],
        };
    }
}

export async function getAdminSessions(companyId?: string, limit: number = 50) {
    try {
        let query = supabase.from("admin_sessions").select("*").order("session_start", { ascending: false }).limit(limit);

        if (companyId) {
            query = query.eq("target_company_id", companyId);
        }

        const { data, error } = await query;
        if (error) throw error;

        return {
            success: true,
            sessions: data || [],
        };
    } catch (e: any) {
        return {
            success: false,
            error: e?.message || "Unknown error",
            sessions: [],
        };
    }
}
