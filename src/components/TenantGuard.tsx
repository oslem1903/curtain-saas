import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

type TenantGuardMode = "any" | "super_admin" | "customer";

export default function TenantGuard({
    mode = "any",
    children,
}: {
    mode?: TenantGuardMode;
    children: ReactNode;
}) {
    const { status, role } = useAuth();
    const location = useLocation();

    if (status === "loading") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
                <div className="text-center">
                    <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-primary-600" />
                    <p className="text-sm font-medium text-slate-500">Lisans ve yetkiler kontrol ediliyor...</p>
                </div>
            </div>
        );
    }

    if (status === "unauthenticated") {
        return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    }

    if (status === "unauthorized") {
        return <Navigate to="/unauthorized" replace />;
    }

    if (status === "locked") {
        return <Navigate to="/locked" replace />;
    }

    if (role === "super_admin" && mode === "customer" && !localStorage.getItem("demo_company_id")) {
        return <Navigate to="/super-admin" replace />;
    }

    if (role !== "super_admin" && mode === "super_admin") {
        return <Navigate to="/app/dashboard" replace />;
    }

    return <>{children}</>;
}
