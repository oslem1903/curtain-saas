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
        return <div style={{ padding: 16 }}>Giriş ve firma yetkileri kontrol ediliyor... Mobil fix 2026-05-11-2</div>;
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
