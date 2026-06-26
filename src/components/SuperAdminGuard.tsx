import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function SuperAdminGuard({ children }: { children: ReactNode }) {
    const { status, role } = useAuth();

    if (status === "loading") {
        return <div style={{ padding: 16 }}>Super admin yetkisi kontrol ediliyor...</div>;
    }

    if (status === "unauthenticated") return <Navigate to="/login" replace />;
    if (status === "locked") return <Navigate to="/locked" replace />;
    if (role !== "super_admin") return <Navigate to="/app/dashboard" replace />;

    return <>{children}</>;
}
